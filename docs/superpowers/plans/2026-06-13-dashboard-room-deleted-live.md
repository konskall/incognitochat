# Dashboard live "room deleted" state — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a room is deleted, every other logged-in member's dashboard shows — without a refresh — a "deleted" state on that room's card, with **Ξανα-δημιούργησε** (re-create in place) and **Απόρριψη** (dismiss) actions.

**Architecture:** Reuse the existing `room_status:${roomKey}` Realtime lifecycle channel that ChatScreen already broadcasts `room_deleted` on when a room is deleted (it uses this to kick in-room members). The dashboard subscribes to `room_status` for its top-15 rooms and marks the matching card deleted on that broadcast. Re-create calls the existing `joinOrCreateRoom` RPC; dismiss is a local-only card removal (the user's `subscribers` row is already cascade-gone).

**Tech Stack:** React 18 + TypeScript, Supabase Realtime (`@supabase/supabase-js` broadcast channels), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-dashboard-room-deleted-live-design.md`

---

## File structure

- **Create `utils/roomLifecycle.ts`** — `broadcastRoomDeleted(roomKey, deletedBy, existing?)` (best-effort `room_status` broadcast) + `parseRoomDeletedPayload(payload)` (defensive parse of the untrusted broadcast payload).
- **Create `utils/roomLifecycle.test.ts`** — unit tests for `parseRoomDeletedPayload`.
- **Modify `components/ChatScreen.tsx`** — enrich the existing `room_deleted` broadcast payload with `{ deletedBy: config.username }` (1 line).
- **Modify `components/DashboardScreen.tsx`** — `deletedRooms` state + `roomStatusChannelsRef`; a new `room_status` subscription effect; deleted-card UI in `RoomCardInner` (+3 props); `recreateRoom` + `dismissDeletedRoom` handlers; wire `cardPropsFor`; broadcast in `deleteRoomByKey`.

No DB / migration / edge-function changes.

---

## Task 1: `utils/roomLifecycle.ts` — broadcast helper + payload parser

**Files:**
- Create: `utils/roomLifecycle.ts`
- Test: `utils/roomLifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `utils/roomLifecycle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseRoomDeletedPayload } from './roomLifecycle';

describe('parseRoomDeletedPayload', () => {
  it('extracts a string deletedBy', () => {
    expect(parseRoomDeletedPayload({ deletedBy: 'Kostas' })).toEqual({ deletedBy: 'Kostas' });
  });
  it('returns {} for missing / non-string / non-object payloads', () => {
    expect(parseRoomDeletedPayload({})).toEqual({});
    expect(parseRoomDeletedPayload({ deletedBy: 42 })).toEqual({});
    expect(parseRoomDeletedPayload(null)).toEqual({});
    expect(parseRoomDeletedPayload(undefined)).toEqual({});
    expect(parseRoomDeletedPayload('x')).toEqual({});
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- roomLifecycle`
Expected: FAIL — `Failed to resolve import "./roomLifecycle"` (module not created yet).

- [ ] **Step 3: Create the implementation**

Create `utils/roomLifecycle.ts`:

```ts
import { supabase } from '../services/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface RoomDeletedPayload { deletedBy?: string; }

// Defensive parse of an untrusted `room_deleted` broadcast payload (it originates
// from another client). Only a string `deletedBy` is accepted; anything else → {}.
export function parseRoomDeletedPayload(payload: unknown): RoomDeletedPayload {
  if (
    payload && typeof payload === 'object' &&
    typeof (payload as { deletedBy?: unknown }).deletedBy === 'string'
  ) {
    return { deletedBy: (payload as { deletedBy: string }).deletedBy };
  }
  return {};
}

// Best-effort: broadcast that a room was deleted on its room_status lifecycle
// channel (the same channel + event ChatScreen emits on an in-room delete), so
// other members' dashboards and any in-room clients react live. If `existing`
// (a channel already subscribed to room_status:<roomKey>) is supplied, send on
// it directly; otherwise open a short-lived channel. NEVER throws into the
// delete flow — a missed broadcast just falls back to a dashboard refresh.
export async function broadcastRoomDeleted(
  roomKey: string,
  deletedBy: string,
  existing?: RealtimeChannel | null,
): Promise<void> {
  const message = { type: 'broadcast' as const, event: 'room_deleted', payload: { deletedBy } };
  try {
    if (existing) {
      await existing.send(message);
      return;
    }
    const ch = supabase.channel(`room_status:${roomKey}`);
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      ch.subscribe((status) => { if (status === 'SUBSCRIBED') finish(); });
      // Don't hang the delete flow if realtime is unavailable.
      setTimeout(finish, 1500);
    });
    await ch.send(message);
    supabase.removeChannel(ch);
  } catch {
    /* best-effort */
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- roomLifecycle`
Expected: PASS (1 file, 2 tests).

- [ ] **Step 5: Commit**

```bash
git add utils/roomLifecycle.ts utils/roomLifecycle.test.ts
git commit -m "feat(dashboard): room_status broadcast helper + payload parser for live room-deleted"
```

---

## Task 2: ChatScreen — enrich the existing room_deleted payload

**Files:**
- Modify: `components/ChatScreen.tsx` (the `roomStatusChannelRef.current?.send` call in `handleDeleteChat`, ~line 930)

- [ ] **Step 1: Make the change**

In `handleDeleteChat`, change the existing broadcast payload from `{}` to carry the deleter's name. Find:

```ts
               await roomStatusChannelRef.current?.send({ type: 'broadcast', event: 'room_deleted', payload: {} });
```

Replace with:

```ts
               await roomStatusChannelRef.current?.send({ type: 'broadcast', event: 'room_deleted', payload: { deletedBy: config.username } });
```

(The in-room recipient at `ChatScreen.tsx:765` ignores the payload, so this is backward-compatible; the dashboard will read `deletedBy`.)

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/ChatScreen.tsx
git commit -m "feat(chat): include deletedBy in the room_deleted broadcast payload"
```

---

## Task 3: DashboardScreen — deletedRooms state + room_status subscription

**Files:**
- Modify: `components/DashboardScreen.tsx` (imports; state near the other `useState`s; new effect after the presence effect ~line 582)

- [ ] **Step 1: Add imports**

At the top of `components/DashboardScreen.tsx`, add the helper import and the `RealtimeChannel` type. Find the existing services import:

```ts
import { supabase, joinOrCreateRoom } from '../services/supabase';
```

Add immediately below it (only `parseRoomDeletedPayload` for now — `broadcastRoomDeleted` is added in Task 5 when first used, to avoid a `noUnusedLocals` error):

```ts
import type { RealtimeChannel } from '@supabase/supabase-js';
import { parseRoomDeletedPayload } from '../utils/roomLifecycle';
```

- [ ] **Step 2: Add state + ref**

Inside the `DashboardScreen` component, next to the other `useState` declarations (near `const [rooms, setRooms] = useState<Room[]>([]);`), add:

```ts
  // Rooms that were deleted live (room_status broadcast) while on the dashboard —
  // shown as a deleted card with Re-create / Dismiss instead of being navigable.
  const [deletedRooms, setDeletedRooms] = useState<Map<string, { deletedBy?: string }>>(new Map());
  // The room_status channels we subscribe for the top-15 rooms, so a dashboard-
  // initiated delete can broadcast on the channel it already holds.
  const roomStatusChannelsRef = useRef<Map<string, RealtimeChannel>>(new Map());
```

- [ ] **Step 3: Add the room_status subscription effect**

Immediately AFTER the existing presence `useEffect` (the one that ends with `}, [presenceKeys, user.uid]);` around line 582), add a new effect that reuses the same `presenceKeys` top-15 key set:

```ts
  // Live "room deleted" signal. Subscribe each top-15 room's room_status channel
  // (the lifecycle channel ChatScreen broadcasts `room_deleted` on the instant a
  // room is deleted) and mark the card deleted in place — no refresh. Realtime
  // postgres_changes DELETE can't do this: `rooms` uses the default replica
  // identity (room_key only) and the member's subscribers row is cascade-gone, so
  // the RLS SELECT re-check fails — see the design doc.
  useEffect(() => {
    const keys = presenceKeys ? presenceKeys.split('|') : [];
    // Drop deleted-markers for rooms no longer in the window.
    setDeletedRooms(prev => {
      const next = new Map<string, { deletedBy?: string }>();
      for (const [k, v] of prev) if (keys.includes(k)) next.set(k, v);
      return next;
    });
    if (keys.length === 0) return;
    const map = roomStatusChannelsRef.current;
    const created = keys.map((key) => {
      const ch = supabase.channel(`room_status:${key}`);
      ch.on('broadcast', { event: 'room_deleted' }, ({ payload }) => {
        const info = parseRoomDeletedPayload(payload);
        setDeletedRooms(prev => { const next = new Map(prev); next.set(key, info); return next; });
      }).subscribe();
      map.set(key, ch);
      return { key, ch };
    });
    return () => {
      created.forEach(({ key, ch }) => { supabase.removeChannel(ch); map.delete(key); });
    };
  }, [presenceKeys]);
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: errors only for the not-yet-added `recreateRoom` / `dismissDeletedRoom` / `deletedInfo` references IF you already touched `cardPropsFor` — but you haven't yet, so expect NO new errors here. (`broadcastRoomDeleted` is imported-but-unused at this point; `noUnusedLocals` will flag it — that's expected and resolved in Task 5. If the build blocks on it, proceed to Task 5 before running the full build.)

- [ ] **Step 5: Commit**

```bash
git add components/DashboardScreen.tsx
git commit -m "feat(dashboard): subscribe room_status channels + deletedRooms state"
```

---

## Task 4: DashboardScreen — deleted-card UI in RoomCardInner

**Files:**
- Modify: `components/DashboardScreen.tsx` (`RoomCardProps` ~line 46; `RoomCardInner` destructure ~line 196; the bottom action block ~lines 269-277)

- [ ] **Step 1: Extend `RoomCardProps`**

Find the `RoomCardProps` type (~line 46) and add three members before the closing `}`:

```ts
type RoomCardProps = {
  room: Room; userUid: string;
  unread: number; muted: boolean; archived: boolean; overview?: Overview;
  revealed: boolean; isFavorite: boolean;
  selectMode: boolean; selected: boolean; online?: Presence[];
  deletedInfo?: { deletedBy?: string };
  onJoin: (r: Room) => void;
  onOpenActions: (r: Room) => void;
  onTogglePin: (e: React.MouseEvent, key: string) => void;
  onToggleFav: (e: React.MouseEvent, key: string) => void;
  onToggleSelect: (key: string) => void;
  onRecreate: (r: Room) => void;
  onDismissDeleted: (key: string) => void;
};
```

- [ ] **Step 2: Destructure the new props in `RoomCardInner`**

Find the `RoomCardInner` definition (~line 196) and add `deletedInfo, onRecreate, onDismissDeleted` to the destructured props:

```ts
const RoomCardInner = React.memo(({ room, userUid, unread, muted, archived, overview, revealed, isFavorite, selectMode, selected, online, deletedInfo, onJoin, onOpenActions, onTogglePin, onToggleFav, onRecreate, onDismissDeleted }: RoomCardProps) => {
```

- [ ] **Step 3: Render the deleted state in the bottom action block**

Find the bottom action block (~lines 269-277):

```tsx
      {selectMode ? (
        <div className="w-full py-2.5 font-semibold rounded-xl flex items-center justify-center gap-2 text-sm border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400">
          {selected ? <><Check size={16} className="text-blue-500" />Selected</> : 'Tap to select'}
        </div>
      ) : (
        <button onPointerDown={stop} onClick={() => onJoin(room)} className={`w-full py-2.5 font-semibold rounded-xl transition flex items-center justify-center gap-2 z-10 ${showUnread ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30 group-hover:bg-red-500 group-hover:text-white group-hover:border-red-500' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 group-hover:bg-blue-600 group-hover:text-white dark:group-hover:bg-blue-600 dark:group-hover:text-white'}`}>
          Enter Room <ArrowRight size={16} />
        </button>
      )}
```

Replace it with (adds the `deletedInfo ?` branch FIRST; the rest is unchanged):

```tsx
      {deletedInfo ? (
        <div className="flex flex-col gap-2 relative z-10">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
            <AlertCircle size={14} className="shrink-0" />
            <span className="truncate">{deletedInfo.deletedBy ? `Διαγράφηκε από ${deletedInfo.deletedBy}` : 'Το δωμάτιο διαγράφηκε'}</span>
          </div>
          <div className="flex gap-2">
            <button onPointerDown={stop} onClick={(e) => { e.stopPropagation(); onRecreate(room); }} className="flex-1 py-2 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition flex items-center justify-center gap-1.5 active:scale-95">
              <RefreshCw size={14} /> Ξανα-δημιούργησε
            </button>
            <button onPointerDown={stop} onClick={(e) => { e.stopPropagation(); onDismissDeleted(room.room_key); }} className="flex-1 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition active:scale-95">
              Απόρριψη
            </button>
          </div>
        </div>
      ) : selectMode ? (
        <div className="w-full py-2.5 font-semibold rounded-xl flex items-center justify-center gap-2 text-sm border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400">
          {selected ? <><Check size={16} className="text-blue-500" />Selected</> : 'Tap to select'}
        </div>
      ) : (
        <button onPointerDown={stop} onClick={() => onJoin(room)} className={`w-full py-2.5 font-semibold rounded-xl transition flex items-center justify-center gap-2 z-10 ${showUnread ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30 group-hover:bg-red-500 group-hover:text-white group-hover:border-red-500' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 group-hover:bg-blue-600 group-hover:text-white dark:group-hover:bg-blue-600 dark:group-hover:text-white'}`}>
          Enter Room <ArrowRight size={16} />
        </button>
      )}
```

Note: `AlertCircle` and `RefreshCw` are already imported in this file (used by `RoomDeleteToast` and the profile "Random" avatar button). No import change needed. `stop` is the existing `(e) => e.stopPropagation()` pointer handler so the buttons don't start a card drag.

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: errors that `cardPropsFor` does not provide `deletedInfo` / `onRecreate` / `onDismissDeleted` (RoomCardProps now requires the two callbacks). These are resolved in Task 5. Do not commit until Task 5 makes it green.

---

## Task 5: DashboardScreen — handlers, cardPropsFor wiring, delete broadcast

**Files:**
- Modify: `components/DashboardScreen.tsx` (import line; handlers near `deleteRoomByKey` ~line 837; the owner branch of `deleteRoomByKey` ~line 798; `cardPropsFor` ~line 1013)

- [ ] **Step 0: Add the `broadcastRoomDeleted` import**

Extend the Task 3 import to also pull in `broadcastRoomDeleted` (now used in Step 2). Find:

```ts
import { parseRoomDeletedPayload } from '../utils/roomLifecycle';
```

Replace with:

```ts
import { broadcastRoomDeleted, parseRoomDeletedPayload } from '../utils/roomLifecycle';
```

- [ ] **Step 1: Add `recreateRoom` + `dismissDeletedRoom` handlers**

Immediately AFTER the `deleteRoomByKey` `useCallback` (after its closing `}, [user.uid]);` ~line 837), add:

```ts
  // Re-create a room deleted live (same name+PIN). The room reappears empty on the
  // dashboard; the user stays here. joinOrCreateRoom defaults createIfMissing:true.
  const recreateRoom = useCallback(async (room: Room) => {
    try {
      const { data, error } = await joinOrCreateRoom({
        roomKey: room.room_key, roomName: room.room_name, pin: room.pin,
        username: displayName, createIfMissing: true,
      });
      if (error || !data) { alert('Could not re-create the room. Please try again.'); return; }
      // Clear the session "joined" flag so a later in-room re-entry creates fresh.
      sessionStorage.removeItem(`joined_${room.room_key}`);
      setDeletedRooms(prev => { const next = new Map(prev); next.delete(room.room_key); return next; });
      // The re-created room is empty — drop any stale overview so the card shows
      // "No messages yet" instead of the pre-deletion preview.
      setOverview(prev => { const next = new Map(prev); next.delete(room.room_key); return next; });
    } catch {
      alert('Could not re-create the room. Please try again.');
    }
  }, [displayName]);

  // Dismiss a live-deleted room from the dashboard. The room (and the user's
  // subscribers/room_settings/push rows) are already cascade-gone server-side, so
  // this is local-only cleanup — no DB call.
  const dismissDeletedRoom = useCallback((key: string) => {
    setDeletedRooms(prev => { const next = new Map(prev); next.delete(key); return next; });
    setRooms(prev => prev.filter(r => r.room_key !== key));
    setFavorites(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev); next.delete(key);
      try { localStorage.setItem(`roomFav_${user.uid}`, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
    setSettings(prev => { if (!prev.has(key)) return prev; const next = new Map(prev); next.delete(key); return next; });
    try { localStorage.removeItem(`lastRead_${key}`); localStorage.removeItem(`joined_${key}`); } catch { /* ignore */ }
  }, [user.uid]);
```

- [ ] **Step 2: Broadcast on a dashboard-initiated owner delete**

In `deleteRoomByKey`, inside the owner branch, right AFTER the own-subscriber-row delete (the line `await supabase.from('subscribers').delete().eq('room_key', key); // own row (RLS-scoped)`, ~line 798), add:

```ts
        // Tell other members' dashboards / in-room clients live (same room_status
        // broadcast ChatScreen emits on an in-room delete). Reuse the channel we
        // already hold for a top-15 room; a room beyond the window opens a
        // short-lived one inside the helper. Best-effort.
        void broadcastRoomDeleted(key, displayName, roomStatusChannelsRef.current.get(key) ?? null);
```

Then add `displayName` to `deleteRoomByKey`'s dependency array so the broadcast uses the current name. Find:

```ts
  }, [user.uid]);
```

at the end of `deleteRoomByKey` (the one immediately before the `recreateRoom` you added in Step 1) and change it to:

```ts
  }, [user.uid, displayName]);
```

- [ ] **Step 3: Wire the new props in `cardPropsFor`**

Find `cardPropsFor` (~line 1013) and add the three entries to the returned object:

```ts
  const cardPropsFor = (room: Room): Omit<RoomCardProps, 'room'> => ({
    userUid: user.uid,
    unread: overview.get(room.room_key)?.unread || 0,
    muted: !!settings.get(room.room_key)?.muted,
    archived: !!settings.get(room.room_key)?.archived,
    overview: overview.get(room.room_key),
    revealed: revealedPins.has(room.room_key),
    isFavorite: favorites.has(room.room_key),
    selectMode,
    selected: selected.has(room.room_key),
    online: online.get(room.room_key),
    deletedInfo: deletedRooms.get(room.room_key),
    onJoin: handleJoin,
    onOpenActions: setActionsRoom,
    onTogglePin: togglePinVisibility,
    onToggleFav: toggleFavorite,
    onToggleSelect: toggleSelect,
    onRecreate: recreateRoom,
    onDismissDeleted: dismissDeletedRoom,
  });
```

- [ ] **Step 4: Verify the whole app compiles + existing tests still pass**

Run: `npm run build`
Expected: `tsc` + `vite build` succeed, no errors (the `broadcastRoomDeleted` import is now used).

Run: `npm test`
Expected: all test files pass (including `roomLifecycle` from Task 1).

- [ ] **Step 5: Commit**

```bash
git add components/DashboardScreen.tsx
git commit -m "feat(dashboard): live deleted-room card with re-create / dismiss"
```

---

## Task 6: Manual verification + push

**Files:** none (verification only)

- [ ] **Step 1: Build + test green (final gate)**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 2: Manual two-client test (required — realtime can't be unit-tested)**

This needs the deployed/preview build with two clients (the deleting user can be in-room OR on the dashboard). Verify each:

1. **In-room delete → other user's dashboard.** User A (owner) opens room R from the dashboard and deletes it from inside the room. User B has R on their dashboard (top-15) and is NOT in the room. **Expected:** B's R card flips to the deleted state live ("Διαγράφηκε από A"), no refresh.
2. **Dashboard delete → other user's dashboard.** User A deletes R from the dashboard action sheet. **Expected:** same live deleted card on B's dashboard.
3. **Re-create.** B taps **Ξανα-δημιούργησε** on the deleted card. **Expected:** R reappears as a normal empty card ("No messages yet"); B stays on the dashboard; entering R works.
4. **Dismiss.** Trigger the deleted state again, B taps **Απόρριψη**. **Expected:** the card disappears; a manual refresh does not bring it back (membership is gone).
5. **Beyond top-15 (documented limitation).** With >15 rooms, delete a room ranked >15 in another client. **Expected:** no live signal on B; it clears on refresh (acceptable, matches the online-badge cap).
6. **Deleter's own dashboard.** The user who deleted does NOT see a deleted card (the card was removed locally; broadcast `self` is off).

- [ ] **Step 3: Push**

```bash
git push origin main
```

CI (npm ci → test → build → Pages deploy) runs on push.

---

## Self-review notes (author)

- **Spec coverage:** detection (Task 3), in-place deleted card + message + 2 actions (Task 4), re-create restores in place (Task 5 `recreateRoom`), dismiss local-only (Task 5 `dismissDeletedRoom`), sender signal (Task 2 in-room + Task 5 dashboard), top-15 limitation (Task 3 key set + Task 6 step 5). All covered.
- **Type consistency:** `deletedRooms: Map<string, { deletedBy?: string }>`, `deletedInfo?: { deletedBy?: string }`, `parseRoomDeletedPayload → { deletedBy?: string }`, `broadcastRoomDeleted(roomKey, deletedBy, existing?)`, `roomStatusChannelsRef: Map<string, RealtimeChannel>` — consistent across tasks.
- **No DB / edge-function changes** — purely client + Realtime broadcast on an existing channel.
