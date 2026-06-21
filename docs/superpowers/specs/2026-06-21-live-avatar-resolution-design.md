# Live Avatar Resolution — Design

**Date:** 2026-06-21
**Status:** Approved (approach + design)

## Problem

A Google user with **no** Google photo (Google still serves a default-avatar URL,
`lh3.googleusercontent.com/a/...`, rendering a colored initial) uploads a custom
photo. The photo **persists correctly** (`auth.users.user_metadata.custom_avatar`
= the uploaded storage URL — confirmed live), but it does **not** appear in:

1. text messages,
2. the tap-user modal (tap an avatar on a message),
3. Room info → Members,
4. participants.

### Root cause

Avatars are **baked in at the moment of an action**, never resolved live:

- **Messages** store `avatar_url` at send time → old messages keep the old avatar forever.
- **`room_members` RPC** derives each member's avatar from their **latest message**
  (`select m.avatar_url ... order by created_at desc limit 1`) → stale until the user
  sends a *new* message.
- **Participants** use the presence payload's `avatar` = `config.avatarURL` from join time.
- There is **no per-user "current avatar"** that other members can read
  (`subscribers` has no avatar column; `custom_avatar` lives in `auth.users`
  metadata, which other clients cannot read).

Secondary confirmed bug: `App.tsx` session-restore reads
`localStorage.chatAvatarURL || user_metadata.avatar_url` and **ignores
`custom_avatar`** — inconsistent with `DashboardScreen` (which prefers
`custom_avatar`). So a restored session can re-bake the Google default into new
messages.

## Goal

A user's avatar resolves to their **current** profile photo everywhere — messages
(old + new), tap-user modal, participants, members — including **offline** users.
Changing the photo propagates without re-sending messages.

## Architecture: single source of truth = current avatar

The current avatar (`custom_avatar`, falling back to Google `picture`/`avatar_url`,
falling back to a generated placeholder) is mirrored into two readable places:

1. **`subscribers.avatar_url`** — a new column, so any member can read any other
   member's current avatar via the membership-gated `room_members` RPC.
2. **Live presence** (`config.avatarURL`) — already broadcast; freshest for online users.

At display time the client overlays presence (online, freshest) on top of the
roster (covers offline users + old messages).

### DB changes (one migration, applied live; behavioral checks self-roll-back)

1. `ALTER TABLE public.subscribers ADD COLUMN avatar_url text;`
2. **One-time backfill** so existing members don't regress to initials:
   ```sql
   UPDATE public.subscribers s
   SET avatar_url = (
     SELECT m.avatar_url FROM public.messages m
     WHERE m.room_key = s.room_key AND m.uid = s.uid AND m.avatar_url IS NOT NULL
     ORDER BY m.created_at DESC LIMIT 1)
   WHERE s.avatar_url IS NULL;
   ```
3. New RPC **`set_my_avatar(p_avatar text)`** — `SECURITY DEFINER`, gated on
   `auth.uid()`, updates **all** of the caller's `subscribers` rows so a photo
   change propagates to every room at once. `GRANT EXECUTE ... TO authenticated`.
4. **`room_members`** returns `COALESCE(s.avatar_url, <latest-message subquery>)`
   — current avatar first, message-derived value as a safety fallback (so a member
   whose `avatar_url` is still NULL never shows worse than today).

**Safety:** does NOT touch `rooms.expires_at`; no auto-lock; the backfill only
reads `messages` → writes `subscribers`. `join_or_create_room` signature is **not**
changed (avoids a PostgREST overload-ambiguity risk for stale PWA clients); avatar
propagation rides on the separate `set_my_avatar` RPC instead.

### Client changes

- **`services/supabase.ts`** — `setMyAvatar(url: string)` wrapper around the RPC
  (fire-and-forget; swallow errors — a failed propagation just leaves the safety
  fallback in place).
- **`utils/avatars.ts`** (new, pure, unit-tested):
  - `buildLiveAvatars(members, participants): Map<string,string>` — seed from member
    rows (offline coverage), then overlay participant presence avatars (online,
    freshest). Only non-empty https-or-any-truthy strings are stored.
  - `resolveDisplayAvatar(uid, bakedAvatar, liveAvatars): string` — `liveAvatars`
    value if present & non-empty, else the baked message avatar, else `''`.
- **`DashboardScreen.handleSaveProfile`** — after `updateUser` succeeds, call
  `setMyAvatar(tempAvatarUrl)` (non-blocking).
- **After each successful join** (ChatScreen join, Dashboard join/recreate) — call
  `setMyAvatar(config.avatarURL)` (non-blocking) so the membership row carries the
  joiner's current avatar. This is what makes the fix **self-healing** for users
  who saved a photo before this shipped: their next room entry writes it.
- **`ChatScreen`**:
  - Load `room_members` once when the room is ready → `memberAvatarRows` state.
  - `liveAvatars = useMemo(buildLiveAvatars(memberAvatarRows, participants))`, keyed
    on a **stable signature string** of `uid=avatar` pairs so the Map's reference is
    stable across keystrokes (preserving `React.memo` on `MessageList`/`MessageItem`).
  - Pass `liveAvatars` to `MessageList`.
  - `handleUserClick` resolves `avatar` via `resolveDisplayAvatar`.
- **`MessageList` / `MessageItem`**: accept `liveAvatars`; for each message compute
  `displayAvatar = resolveDisplayAvatar(msg.uid, msg.avatarURL, liveAvatars)` and pass
  it to `MessageItem` as a **primitive string prop** (memo-safe — only that user's
  rows re-render when their avatar changes). Use `displayAvatar` in the avatar `src`
  and both `onUserClick` calls.
- **`MembersHistoryModal`**: no change — it reads `room_members`, which now returns
  the current avatar automatically.
- **`App.tsx:69`**: `localStorage.chatAvatarURL || meta.custom_avatar || meta.avatar_url`.

### Data flow after the fix

1. User changes photo → `custom_avatar` updated **and** `set_my_avatar` updates all
   their `subscribers` rows → (on next presence track / re-entry) presence updates.
2. Any member opens/refreshes the room → ChatScreen loads `room_members` → `liveAvatars`
   holds everyone's current avatar → all messages (old + new), the tap-modal, members,
   and (for online users) participants render the current photo.
3. Offline users render their current photo from `subscribers.avatar_url`.

## Testing

- **Unit (vitest)** — `utils/avatars.ts`: presence overrides roster; roster covers
  offline; empty/whitespace ignored; baked fallback when uid absent.
- **DB (self-rolling-back)** — in a `BEGIN; ... ROLLBACK;` transaction: `set_my_avatar`
  updates only the caller's rows; `room_members` returns `COALESCE` value; backfill
  populates NULLs without overwriting.
- **Manual** — the exact scenario: Google-no-photo user uploads a photo, re-enters a
  room, and a second member sees it on her old messages, the tap-modal, Members, and
  participants.

## Out of scope (YAGNI)

- Live push of an avatar change to peers who already have the room open and never
  see the changer come online again (covered on their next room open / refresh).
- Username staleness in the roster (same baked-at-join issue) — not part of this report.
