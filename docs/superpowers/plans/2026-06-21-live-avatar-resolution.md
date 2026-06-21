# Live Avatar Resolution — Implementation Plan

> Implements `docs/superpowers/specs/2026-06-21-live-avatar-resolution-design.md`.

**Goal:** Avatars resolve to the user's current profile photo everywhere (messages,
tap-modal, participants, members), including offline users, without re-sending messages.

**Global constraints (verbatim):** Never touch `rooms.expires_at`; no auto-lock; do
NOT change `join_or_create_room`'s signature; behavioral DB checks self-roll-back;
UI copy English; commit footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Pure avatar-merge utilities (TDD)

**Files:** Create `utils/avatars.ts`, `utils/avatars.test.ts`.

- `buildLiveAvatars(members: {uid:string; avatar_url?:string|null}[], participants: {uid:string; avatar?:string|null}[]): Map<string,string>`
  — seed from members (non-empty trimmed), then overlay participants (non-empty trimmed) so presence wins.
- `resolveDisplayAvatar(uid: string, baked: string|null|undefined, live: Map<string,string>): string`
  — `live.get(uid)` if non-empty, else `baked || ''`.

Tests: presence overrides roster; roster covers offline (uid not in participants);
whitespace/empty ignored (falls through to baked); uid absent everywhere → baked; baked null → ''.

Verify: `npx vitest run utils/avatars.test.ts`, then `npx tsc --noEmit`.

### Task 2: DB migration (apply_migration) + self-rolling-back verification

Migration `live_avatar_resolution`:
1. `ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS avatar_url text;`
2. Backfill NULLs from latest-message avatar (see spec).
3. `CREATE OR REPLACE FUNCTION public.set_my_avatar(p_avatar text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ UPDATE public.subscribers SET avatar_url = p_avatar WHERE uid = (select auth.uid())::text; $$;`
   `GRANT EXECUTE ON FUNCTION public.set_my_avatar(text) TO authenticated;`
4. `CREATE OR REPLACE FUNCTION public.room_members(...)` — same body but
   `COALESCE(s.avatar_url, <existing latest-message subquery>)`.

Verify (separate `execute_sql`, `BEGIN; ... ROLLBACK;`):
- backfill query populates a known NULL row from its latest message;
- `room_members` returns COALESCE (set a subscribers.avatar_url, confirm it wins over message);
- confirm `set_my_avatar` body updates only matching uid (dry check via UPDATE ... RETURNING in the txn).

### Task 3: Service wrapper

**File:** `services/supabase.ts` — add near `joinOrCreateRoom`:
```ts
export async function setMyAvatar(url: string): Promise<void> {
  try { await supabase.rpc('set_my_avatar', { p_avatar: url }); } catch { /* best-effort */ }
}
```
Verify: `npx tsc --noEmit`.

### Task 4: Propagate on save + on join

- `DashboardScreen.handleSaveProfile`: after `setAvatarUrl(tempAvatarUrl)` →
  `void setMyAvatar(tempAvatarUrl);` (import added).
- `DashboardScreen.handleJoin` (~796) and recreate join (~1086): after a successful
  join, `void setMyAvatar(avatarUrl)` / `void setMyAvatar(displayName ? avatarUrl : avatarUrl)`
  — i.e. the avatar passed to `onJoinRoom`. (Place where `data`/room is confirmed.)
- `ChatScreen` join block (~627 `if (room)`): `void setMyAvatar(config.avatarURL);`

Verify: `npx tsc --noEmit`.

### Task 5: ChatScreen live-avatar map + load members

**File:** `components/ChatScreen.tsx`
- State: `const [memberAvatarRows, setMemberAvatarRows] = useState<{uid:string; avatar_url:string|null}[]>([]);`
- Effect (deps `[isRoomReady, config.roomKey]`): when ready, `supabase.rpc('room_members', { p_room_key: config.roomKey })` → `setMemberAvatarRows((data||[]).map(r => ({uid:r.uid, avatar_url:r.avatar_url})))`.
- `const liveAvatarsSig = useMemo(...)` building a sorted `uid=avatar` signature from `memberAvatarRows` + `participants`.
- `const liveAvatars = useMemo(() => buildLiveAvatars(memberAvatarRows, participants), [liveAvatarsSig]);` (eslint-disable exhaustive-deps on this line).
- `handleUserClick`: `avatar = resolveDisplayAvatar(uid, avatar, liveAvatars)` before building `userToDisplay`.
- Pass `liveAvatars={liveAvatars}` to `<MessageList>`.

Verify: `npx tsc --noEmit`.

### Task 6: MessageList / MessageItem display avatar

**File:** `components/MessageList.tsx`
- `MessageListProps`: add `liveAvatars?: Map<string,string>`.
- `MessageItem` props: add `displayAvatar: string`.
- Both `.map` render sites: compute `const displayAvatar = resolveDisplayAvatar(msg.uid, msg.avatarURL, liveAvatars ?? EMPTY_MAP);` and pass `displayAvatar={displayAvatar}`. (Define a module-level `const EMPTY_AVATARS = new Map<string,string>();` for the default.)
- In `MessageItem`, replace the three `msg.avatarURL` avatar usages (img `src`, two `onUserClick`) with `displayAvatar`.

Verify: `npx tsc --noEmit`, `npm run build`.

### Task 7: App.tsx custom_avatar fallback

**File:** `App.tsx:69` — `const storedAvatar = localStorage.getItem('chatAvatarURL') || session?.user?.user_metadata?.custom_avatar || session?.user?.user_metadata?.avatar_url;`

Verify: `npx tsc --noEmit`.

### Task 8: Full verify + commit

`npx vitest run`, `npx tsc --noEmit`, `npm run build`. Commit. Push only after user confirmation (push = live deploy).
