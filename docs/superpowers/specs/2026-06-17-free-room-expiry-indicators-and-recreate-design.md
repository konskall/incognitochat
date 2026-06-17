# Free-room 24h expiry: indicators + delete/recreate flow — Design

**Date:** 2026-06-17
**Status:** Approved direction (countdown labels; Option B tombstones), pending spec review.

## Goal

Make the free-tier 24h room lifetime (`rooms.expires_at`) **visible and honest** everywhere a room appears, and stop expired rooms from silently resurrecting.

Four changes:
1. **In-room header pill** — live countdown of the 24h expiry, matching the two existing header pills.
2. **Dashboard card pill** — same countdown on each room card.
3. **Auto-delete → "deleted" card on the dashboard** — when a free room expires, show the existing "deleted" card (Re-create / Dismiss), including after the server cron has purged it (local tombstones).
4. **Bug fix — phantom resurrection** — reopening a tab on an expired room must NOT silently re-create it.

## Background (current state, verified)

- The **free 24h timer** is `rooms.expires_at` (set by `join_or_create_room` for free creators; purged by pg_cron `purge-expired-free-rooms`, runs every 15 min). It is **distinct** from `rooms.auto_delete_seconds` (configurable inactivity TTL, cron `expire_rooms`) and from `rooms.message_ttl_seconds` (disappearing messages). All three must stay visually distinct.
- **Header** (`components/ChatHeader.tsx:130-139`) already renders two pills: orange `messageTtlLabel` (disappearing, `Timer` icon) and red `roomExpiryLabel` (inactivity auto-delete, `Trash2` icon). No pill exists for `expires_at`.
- `ChatScreen` already holds `roomExpiresAt` state (fetched once after room-ready + kept fresh via the `room_status` realtime handler).
- **Dashboard card** (`components/DashboardScreen.tsx`) already shows a `Clock` pill for `auto_delete_seconds` (`ttlLabel`). No pill for `expires_at`. The `Room` type (`types.ts`) has `auto_delete_seconds` but **not** `expires_at`.
- **Dashboard "deleted" card** (`DashboardScreen.tsx:279-293`, the `deletedInfo` block) already implements "Το δωμάτιο διαγράφηκε" + **Ξανα-δημιούργησε / Απόρριψη**, with `recreateRoom` and `dismissDeletedRoom` handlers. It is triggered **only** by the live `room_deleted` broadcast (manual deletes), never by cron auto-expiry.
- **Bug #4 root cause:** `ChatScreen.initRoom` (`ChatScreen.tsx:581-588`) computes `createIfMissing: !alreadyJoined`, where `alreadyJoined` reads `sessionStorage['joined_<roomKey>']`. sessionStorage is wiped on tab close, so reopening a tab (or the App.tsx auto-route from `localStorage.chatPin/chatRoomName`) reports "never joined" → the RPC re-creates the purged room (free → fresh 24h; paid reopener → permanent). The rest of the codebase already treats `joined_<key>` as a **localStorage** key (logout sweep `App.tsx:249`; `dismissDeletedRoom` `DashboardScreen.tsx:964`) — sessionStorage is the inconsistency.

## Architecture

### Shared helper — `utils/roomLifecycle.ts` (existing file)

Add two pure functions (no new dependencies; `now` injected for testability and to avoid `Date.now()` in render hot paths where a tick value is already available):

```ts
// Short countdown label for the free 24h expiry. null = no expiry set, or already past.
export function expiryShortLabel(iso?: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins >= 1440) { const d = Math.round(mins / 1440); return `~${d}d`; }
  if (mins >= 60)   { const h = Math.round(mins / 60);   return `~${h}h`; }
  return `~${Math.max(1, mins)}m`;
}

// True only when an expiry is set AND has passed.
export function isExpired(iso?: string | null, now: number = Date.now()): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= now;
}
```

`RoomInfoModal.formatExpiryHint` (the long "Auto-deletes in ~Xh" hero hint) is left as-is — different surface, different copy.

### Part 1 — Header pill (`ChatScreen` → `ChatHeader`)

- `ChatScreen`: add a `nowTick` state updated by a 60s `setInterval`, **gated** so the interval only runs while `roomExpiresAt` is set and not yet past (no always-on timer otherwise). Compute `roomFreeExpiryLabel = expiryShortLabel(roomExpiresAt, nowTick)`.
- Pass `roomFreeExpiryLabel` into `<ChatHeader>` (alongside the existing `messageTtlLabel` / `roomExpiryLabel`).
- `ChatHeader`: new optional prop `roomFreeExpiryLabel?: string | null`. Render a third pill **after** the `roomExpiryLabel` pill, only when truthy:
  - icon `Hourglass` (lucide-react), amber palette (`text-amber-600 bg-amber-500/10`) to stay distinct from the orange (disappearing) and red (inactivity) pills,
  - `title="This free room auto-deletes — {label} left"`.
- When expiry passes in-room, the label becomes `null` (pill disappears). Room removal itself is already handled by the existing focus/visibility `checkRoomStatus` + realtime → `RoomDeletedToast`. No new kick-out logic.

### Part 2 — Dashboard card pill (`DashboardScreen`)

- `types.ts`: add `expires_at?: string | null;` to `interface Room` (the dashboard already `select('*')`, so the value is present at runtime).
- `DashboardScreen`: add a `nowTick` state (60s interval; dashboard is foreground, always-on is fine). Pass `now={nowTick}` into each `RoomCardInner`.
- `RoomCardProps`: add `now: number`.
- `RoomCardInner`: compute `expLabel = expiryShortLabel(room.expires_at, now)` and render an amber `Hourglass` pill next to the existing red `Clock` (`ttl`) pill.

### Part 3 — Auto-delete "deleted" card + tombstones (`DashboardScreen`)

**(a) Present-but-expired (live flip + on-load):**
- Extend the deleted-card trigger so a card renders in its "deleted" state when **either** there is a live `deletedRooms` entry **or** the room is present in `rooms` with `isExpired(room.expires_at, nowTick)`.
- Extend the deleted payload shape to `{ deletedBy?: string; reason?: 'deleted' | 'expired' }`. For `reason: 'expired'` the card text is **"Διαγράφηκε αυτόματα (όριο 24ωρου)"**; otherwise the existing "Διαγράφηκε από {x}" / "Το δωμάτιο διαγράφηκε".
- The 60s `nowTick` provides the live flip while the user watches (no per-room timers).

**(b) Tombstones (survive cron purge while away) — Option B:**
- localStorage key `roomTombstones_<uid>` → `{ [room_key]: { room_name, pin, created_by, expires_at, name } }` (`name` = display_name||room_name).
- **Write/refresh:** after a **successful** rooms fetch in `initData`, upsert a tombstone for every fetched room that has `expires_at` set (captures the data needed to render + recreate after the row is gone). Helper `utils/roomTombstones.ts` wraps read/write/remove with try/catch (corrupt-JSON safe), keyed by uid.
- **Surface:** after the same successful fetch, diff: any tombstone whose `room_key` is **not** in the fetched set **and** whose `expires_at` `isExpired` → it was purged by the cron while away → add to a `tombstoneDeleted` Map state. Render one **non-navigable** "deleted" card (reason `'expired'`) per entry, built from a synthetic `Room` (`{ room_key, room_name, pin, created_by, expires_at, display_name: name, id: '', created_at: '' }`).
- **Guard against false positives:** the diff runs **only** when the fetch succeeded (a `fetchOk` flag) — a transient network/RLS error must never surface every tombstone as "deleted". Rooms missing for non-expiry reasons are not surfaced because the diff requires `isExpired(expires_at)`.
- **Clear:**
  - `dismissDeletedRoom(key)` → also remove the tombstone + drop from `tombstoneDeleted`.
  - `deleteRoomByKey(key,…)` (manual delete/leave) → also remove the tombstone.
  - `recreateRoom(room)` → on success, drop from `tombstoneDeleted` (room is live again; its tombstone is refreshed on next load with the new `expires_at`). Works for both real expired cards and synthetic tombstone cards (all needed fields are present).

**Rendering:** synthetic tombstone cards render via the **non-sortable** `StaticRoomCard` path (never inside the `SortableContext` drag grid — they aren't real `rooms` and must not participate in reorder/persistOrder). They appear in a dedicated block at the top of the list (above live rooms) so the "deleted" notice is seen. Present-but-expired rooms (case a) stay in their normal grid position but render their deleted state.

**Recreate/Dismiss wiring:** synthetic tombstone cards reuse the existing `onRecreate`/`onDismissDeleted` paths unchanged (they already operate on `Room` + `room_key`).

### Part 4 — Phantom-resurrection fix (`ChatScreen`)

Switch the `joined_<roomKey>` flag from sessionStorage to **localStorage** (3 sites), making "have I been in this room before" durable across tab close:
- `initRoom` read (`~581`): `localStorage.getItem('joined_'+roomKey)`.
- the setter effect (`~682-686`): `localStorage.getItem/setItem`.
- `handleRecreate` (`~652`): `localStorage.removeItem`.
- Update the adjacent comments to say the flag is durable.

Result: reopening a tab / App.tsx auto-route on an expired room → `alreadyJoined === true` → `createIfMissing: false` → RPC raises `ROOM_DELETED` → existing `RoomDeletedToast` (Re-create / Exit) shows instead of silent resurrection. Genuine first creation (room never joined → no flag) still creates. Consistent with the existing logout/dismiss cleanup that already targets localStorage `joined_` keys.

## Data flow summary

- **Server source of truth unchanged.** No DB/RPC/cron changes. `expires_at` is read where the dashboard/room already read room data.
- **Client clock** is used only for *display* (countdown) and *optimistic* expiry flip; recreate always round-trips through `join_or_create_room` (authoritative tier/room-limit checks).

## Error handling

- localStorage access (tombstones, `joined_` flag) wrapped in try/catch — corrupt/blocked storage degrades to "no tombstones / treat as not-joined" without throwing.
- Tombstone diff gated on a successful fetch (`fetchOk`) to avoid false "deleted" cards on transient errors.
- `Date.parse` guarded (`Number.isFinite`) so a malformed `expires_at` yields no pill and `isExpired === false` (fail-safe: never falsely mark a room deleted).

## Testing

- Unit (vitest, matches existing `*.test.ts`): `expiryShortLabel` (null when absent/past; `~Nm`/`~Nh`/`~Nd` boundaries at 59m/60m/1439m/1440m) and `isExpired` (absent → false; future → false; past → true; malformed → false). Tombstone helper read/write/remove + corrupt-JSON tolerance.
- Manual: (1) free room header shows countdown, ticks down; (2) dashboard card shows same; (3) let a free room pass expiry while on dashboard → card flips to "deleted (24h)"; (4) reopen a tab on an expired room → "deleted" toast, NOT a resurrected room; (5) be away past expiry + cron purge, reopen dashboard → tombstone "deleted" card with working Re-create/Dismiss; (6) manual delete/leave/dismiss leaves no stray tombstone card.

## Out of scope / known limits

- **Cross-device resurrection:** a fresh device with no `joined_` flag typing a name+PIN equal to an expired room will still create a new room — inherent to the deterministic name+PIN = room identity model; closing it needs server-side tombstones (not in scope).
- No change to the purge crons or to `expires_at` semantics. Never backfill `expires_at` / never auto-lock existing rooms.
