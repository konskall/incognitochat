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

**Mechanism: broadcast on the per-room presence channel `presence:${roomKey}`.**
The dashboard already subscribes to that channel for its top-15 rooms (the
"who's online" feature). We piggyback a `room_deleted` broadcast on the same
channel — no new sockets, no RLS/DB-state dependency, and only clients already
watching that room receive it (no global room_key leak).

**Coverage limitation (accepted):** only rooms inside the dashboard's top-15
presence window get the live signal — identical to the existing online-badge cap.
Rooms beyond #15 fall back to the current behavior (appear/clear on refresh).
Broadcast send is best-effort; a failed/missed broadcast also falls back to refresh.

## Data flow

1. **Delete (sender).** After a *successful* room delete:
   - `ChatScreen.handleDeleteChat` (in-room delete), and
   - `DashboardScreen.deleteRoomByKey` (owner branch, dashboard delete)

   call `broadcastRoomDeleted(roomKey, deletedBy)`. `deletedBy` is the deleter's
   display name (`config.username` in ChatScreen; the user's display name in the
   dashboard). The broadcast fires AFTER the DB delete resolves so we never signal
   a deletion that didn't happen.

2. **Receive (dashboard).** The presence `useEffect` adds, per channel:
   `ch.on('broadcast', { event: 'room_deleted' }, ({ payload }) => …)`.
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

- **New `utils/roomLifecycle.ts`** — `broadcastRoomDeleted(roomKey, deletedBy)`.
  Sends one `room_deleted` broadcast on `presence:${roomKey}` via a short-lived
  subscribed channel (subscribe → send → `removeChannel`). Best-effort: never
  throws into the delete flow. Note: `supabase.channel('presence:'+roomKey)`
  returns a DISTINCT channel instance even if `useRoomPresence` already holds one
  for that topic (supabase-js v2 does not dedupe by topic), and `removeChannel`
  tears down only this transient instance — so the sender's broadcast never
  disturbs the in-room presence subscription. Sender doesn't need `self` echo.
- **`components/DashboardScreen.tsx`** —
  - `deletedRooms` state (`Map<string, { deletedBy?: string }>`);
  - broadcast listener in the existing presence `useEffect` (added before
    `.subscribe()`), plus prune `deletedRooms` to the current key set alongside the
    existing online-map prune;
  - deleted-card variant in the room-card render;
  - `recreateRoom` + `dismissDeletedRoom` handlers;
  - call `broadcastRoomDeleted` after the owner delete in `deleteRoomByKey`.
- **`components/ChatScreen.tsx`** — call `broadcastRoomDeleted(config.roomKey,
  config.username)` after the successful delete in `handleDeleteChat`.

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
