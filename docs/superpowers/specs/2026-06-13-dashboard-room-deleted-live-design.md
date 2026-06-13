# Dashboard: live "room deleted" state — design

**Date:** 2026-06-13
**Status:** approved (design)

## Goal

When a room is deleted by any member, every other logged-in user who has that
room on their dashboard sees — **without a refresh** — that the room was deleted,
on that specific room card, with two actions: **Re-create** or **Dismiss**.

## Problem / why

Today the dashboard learns about a deletion only on the next full `initData`
(page refresh / re-login). The deleted room lingers as a normal card; clicking it
would try to re-create it implicitly. We want an explicit, live, in-place state.

A Supabase Realtime `postgres_changes` DELETE subscription on `rooms` does **not**
work here: Realtime applies the table's RLS `SELECT` policy
(`is_member(room_key) OR created_by = auth.uid()`) to the OLD record at delivery
time, but (a) the member's `subscribers` row is already cascade-deleted, so
`is_member` is false, and (b) `created_by` is not in the table's replica identity
(default = PK `room_key` only), so it is NULL in the DELETE payload. The event is
therefore not delivered to other members. → We use **Realtime broadcast** instead.

## Architecture

**Mechanism: broadcast `room_deleted` on the existing `room_status:${roomKey}`
lifecycle channel.** (Refined during planning — supersedes the initial
"presence channel" idea.) ChatScreen ALREADY opens `room_status:${roomKey}` and
ALREADY broadcasts `event: 'room_deleted'` on it the moment the owner deletes a
room (to kick in-room members — `ChatScreen.tsx:759,930`). We reuse that exact
event: the dashboard subscribes to `room_status:${roomKey}` for its top-15 rooms
and listens for `room_deleted`. No RLS/DB-state dependency, no global room_key
leak (only watchers of that room subscribe), and minimal new send-side code
(ChatScreen's in-room delete already emits it). This also avoids the
same-topic-subscription hazard of the presence approach: ChatScreen is already
subscribed to `presence:${roomKey}` via `useRoomPresence`, so a transient send on
that topic risks a duplicate-subscription conflict — `room_status` has a
dedicated owner ref (`roomStatusChannelRef`) ChatScreen sends on directly.

**Coverage limitation (accepted):** the dashboard subscribes `room_status` for
its top-15 rooms (mirroring the existing online-badge presence cap). Rooms beyond
#15 fall back to the current behavior (clear on refresh). Broadcast send is
best-effort; a missed broadcast also falls back to refresh.

## Data flow

1. **Delete (sender).**
   - `ChatScreen.handleDeleteChat` ALREADY broadcasts `room_deleted` on its
     `roomStatusChannelRef` right after the delete (line ~930). The ONLY change:
     enrich the payload from `{}` to `{ deletedBy: config.username }` (in-room
     recipients ignore the payload, so this is backward-compatible).
   - `DashboardScreen.deleteRoomByKey` (owner branch) currently does NOT signal —
     add a `broadcastRoomDeleted(key, displayName, existingChannel?)` call after a
     successful delete so other members learn of a dashboard-initiated deletion.
   Both fire AFTER the DB delete resolves so we never signal a non-deletion.

2. **Receive (dashboard).** A NEW `useEffect` (parallel to the presence effect,
   same top-15 key set) subscribes one `room_status:${roomKey}` channel per room
   with `ch.on('broadcast', { event: 'room_deleted' }, ({ payload }) => …)`, and
   stores the channels in `roomStatusChannelsRef: Map<roomKey, RealtimeChannel>`
   (so the dashboard-delete sender can reuse an existing channel — see below).
   On receipt it records the room in new state
   `deletedRooms: Map<string /*roomKey*/, { deletedBy?: string }>`.
   (Sender does not echo to itself — the deleter already removed the card locally.)

3. **Render (card).** When `deletedRooms.has(room.room_key)`, the room card renders
   a deleted-state variant instead of the normal clickable card:
   - message: `Το δωμάτιο διαγράφηκε` (+ ` από {deletedBy}` when present);
   - **Ξανα-δημιούργησε** button → `recreateRoom(room)`;
   - **Απόρριψη** button → `dismissDeletedRoom(room.room_key)`.
   The card is NOT navigable while in this state (clicking it does nothing).

4. **Re-create.** `recreateRoom(room)`:
   - `joinOrCreateRoom({ roomKey, roomName: room.room_name, pin: room.pin,
     username: <display name>, createIfMissing: true })`;
   - on success: `sessionStorage.removeItem('joined_' + roomKey)`, delete the key
     from `deletedRooms`, and refresh that room's overview (it is now empty);
     the card returns to a normal (empty) room. User stays on the dashboard.
   - on error: toast/inline error; the card stays in the deleted state.

5. **Dismiss.** `dismissDeletedRoom(roomKey)`:
   - remove the room from `rooms` state and from `deletedRooms`;
   - local cleanup only (favorites / order / `joined_`/`lastRead_` localStorage for
     that key) — **no DB call**, because the user's `subscribers` row was already
     removed by the deletion cascade.

## Components / files

- **New `utils/roomLifecycle.ts`** — `broadcastRoomDeleted(roomKey, deletedBy,
  existing?)`. If `existing` (a `RealtimeChannel` already subscribed to
  `room_status:${roomKey}`) is passed, it sends on it directly. Otherwise it opens
  a short-lived `room_status:${roomKey}` channel (subscribe → send → `removeChannel`,
  with a ~1.5s safety timeout so a down realtime never hangs the delete flow).
  Best-effort: never throws. The `existing` param lets the dashboard reuse the
  channel it already holds for a top-15 room, sidestepping any same-topic
  duplicate-subscription concern; a room beyond #15 has no existing channel, so the
  transient path runs (no conflict — that topic isn't otherwise subscribed).
- **`components/DashboardScreen.tsx`** —
  - `deletedRooms` state (`Map<string, { deletedBy?: string }>`) and
    `roomStatusChannelsRef` (`Map<roomKey, RealtimeChannel>`);
  - a NEW `room_status` subscription `useEffect` (mirrors the presence effect's
    top-15 key set) that listens for `room_deleted` and prunes `deletedRooms` to
    the current key set;
  - deleted-card variant in `RoomCardInner` (new `deletedInfo` + `onRecreate` +
    `onDismissDeleted` props, wired in `cardPropsFor`);
  - `recreateRoom` + `dismissDeletedRoom` handlers;
  - call `broadcastRoomDeleted(key, displayName, roomStatusChannelsRef.current.get(key))`
    after the owner delete in `deleteRoomByKey`.
- **`components/ChatScreen.tsx`** — single change: in `handleDeleteChat`, enrich the
  existing `roomStatusChannelRef.current?.send` payload from `{}` to
  `{ deletedBy: config.username }`.

## Error handling

- Broadcast send: best-effort; wrapped so a failure only logs (delete already
  succeeded; refresh remains the fallback).
- Re-create: surfaces errors via the existing toast/`flashToast` pattern; the
  deleted card persists so the user can retry or dismiss.
- A late new-message overview INSERT for a re-created room is harmless (resolved by
  re-create/dismiss); we do not special-case it (YAGNI).

## Testing

- **Unit (Vitest):** extract the dismiss/local-cleanup key predicate (which
  localStorage keys to purge for a room) as a small pure function and test it; test
  the `deletedRooms` prune-to-current-keys logic if extracted.
- **Manual (required):** two clients in the same room (one owner). Owner deletes →
  the other user's dashboard shows the deleted-card live (no refresh). Verify
  Re-create restores an empty room in place, and Dismiss removes the card; verify a
  room outside the top-15 window still needs a refresh (documented limitation).

## Out of scope

- In-room deletion UX (ChatScreen already has its own `roomDeleted` handling).
- Live signal for rooms outside the top-15 presence window (refresh covers them).
- Notifying about room *creation* or *rename* live (deletion only).
