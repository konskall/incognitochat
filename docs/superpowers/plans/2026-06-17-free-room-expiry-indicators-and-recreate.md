# Free-room 24h Expiry Indicators + Delete/Recreate Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the free-tier 24h room lifetime (`rooms.expires_at`) visible (live countdown pill in the chat header + on the dashboard card), show a "deleted (24h)" card with Re-create/Dismiss when a free room expires (including after the server cron purged it, via local tombstones), and stop expired rooms from silently resurrecting on tab reopen.

**Architecture:** Two pure helpers in `utils/roomLifecycle.ts` (`expiryShortLabel`, `isExpired`) feed display + optimistic-expiry decisions; a small localStorage helper `utils/roomTombstones.ts` remembers free rooms so the dashboard can show "auto-deleted" even after the cron removed the row. UI changes are additive in `ChatHeader`/`ChatScreen`/`DashboardScreen`. The resurrection bug is fixed by moving the `joined_<roomKey>` flag from sessionStorage to localStorage. No DB/RPC/cron changes.

**Tech Stack:** React 18 + TypeScript + Vite, Tailwind, lucide-react icons, vitest 2.1.9 (`npm test` → `vitest run`), Supabase JS.

## Global Constraints

- No DB / RPC / pg_cron changes. The server stays source of truth; client clock is display + optimistic only.
- Never backfill `rooms.expires_at`; never auto-lock existing rooms.
- App UI copy is English **except** the dashboard deleted-card copy, which is Greek to match the existing strings in that card ("Το δωμάτιο διαγράφηκε", "Ξανα-δημιούργησε", "Απόρριψη").
- `expires_at` (free fixed 24h) is distinct from `auto_delete_seconds` (inactivity TTL) and `message_ttl_seconds` (disappearing). Keep the three pills visually distinct: disappearing = orange `Timer`, inactivity = red `Trash2`, free-24h = amber `Hourglass`.
- Tests use `import { describe, it, expect } from 'vitest';` and import pure functions directly (see `hooks/useDragResize.test.ts`).
- Commit footer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **`utils/roomLifecycle.ts`** (modify) — add `expiryShortLabel` + `isExpired` pure helpers next to the existing broadcast helpers.
- **`utils/roomLifecycle.test.ts`** (create) — unit tests for the two helpers.
- **`utils/roomTombstones.ts`** (create) — localStorage read/upsert/remove for per-user free-room tombstones.
- **`utils/roomTombstones.test.ts`** (create) — unit tests with an in-memory localStorage stub.
- **`components/ChatHeader.tsx`** (modify) — new amber `Hourglass` countdown pill.
- **`components/ChatScreen.tsx`** (modify) — `nowTick` ticker, pass the label to the header; resurrection fix (sessionStorage → localStorage).
- **`types.ts`** (modify) — add `expires_at?: string | null` to `Room`.
- **`components/DashboardScreen.tsx`** (modify) — card pill, present-but-expired deleted card, tombstone wiring.

---

### Task 1: Lifecycle helpers (`expiryShortLabel`, `isExpired`)

**Files:**
- Modify: `utils/roomLifecycle.ts`
- Test: `utils/roomLifecycle.test.ts` (create)

**Interfaces:**
- Produces: `expiryShortLabel(iso?: string | null, now?: number): string | null` and `isExpired(iso?: string | null, now?: number): boolean`.

- [ ] **Step 1: Write the failing test** — create `utils/roomLifecycle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { expiryShortLabel, isExpired } from './roomLifecycle';

const NOW = 1_700_000_000_000; // fixed reference instant
const inMin = (m: number) => new Date(NOW + m * 60000).toISOString();

describe('expiryShortLabel', () => {
  it('returns null when no timestamp', () => {
    expect(expiryShortLabel(null, NOW)).toBeNull();
    expect(expiryShortLabel(undefined, NOW)).toBeNull();
  });
  it('returns null when already past or malformed', () => {
    expect(expiryShortLabel(inMin(-1), NOW)).toBeNull();
    expect(expiryShortLabel('not-a-date', NOW)).toBeNull();
  });
  it('formats minutes under an hour', () => {
    expect(expiryShortLabel(inMin(30), NOW)).toBe('~30m');
    expect(expiryShortLabel(inMin(59), NOW)).toBe('~59m');
  });
  it('formats hours from 60 minutes up to a day', () => {
    expect(expiryShortLabel(inMin(60), NOW)).toBe('~1h');
    expect(expiryShortLabel(inMin(23 * 60), NOW)).toBe('~23h');
  });
  it('formats days at/over 1440 minutes', () => {
    expect(expiryShortLabel(inMin(1440), NOW)).toBe('~1d');
  });
});

describe('isExpired', () => {
  it('false when absent', () => {
    expect(isExpired(null, NOW)).toBe(false);
    expect(isExpired(undefined, NOW)).toBe(false);
  });
  it('false when in the future', () => {
    expect(isExpired(inMin(1), NOW)).toBe(false);
  });
  it('true when in the past', () => {
    expect(isExpired(inMin(-1), NOW)).toBe(true);
  });
  it('false when malformed', () => {
    expect(isExpired('garbage', NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run utils/roomLifecycle.test.ts`
Expected: FAIL — `expiryShortLabel`/`isExpired` are not exported from `./roomLifecycle`.

- [ ] **Step 3: Write minimal implementation** — append to `utils/roomLifecycle.ts` (after the existing `broadcastRoomDeleted` function):

```ts
// Short countdown label for the free 24h expiry (rooms.expires_at). Returns null
// when no expiry is set, the timestamp is malformed, or it has already passed.
export function expiryShortLabel(iso?: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins >= 1440) { const d = Math.round(mins / 1440); return `~${d}d`; }
  if (mins >= 60)   { const h = Math.round(mins / 60);   return `~${h}h`; }
  return `~${Math.max(1, mins)}m`;
}

// True only when an expiry timestamp is set AND has passed. Absent/malformed → false
// (fail-safe: never falsely mark a room deleted).
export function isExpired(iso?: string | null, now: number = Date.now()): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= now;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run utils/roomLifecycle.test.ts`
Expected: PASS (14 assertions across 9 tests).

- [ ] **Step 5: Commit**

```bash
git add utils/roomLifecycle.ts utils/roomLifecycle.test.ts
git commit -m "feat(room): expiryShortLabel + isExpired lifecycle helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Tombstone storage helper

**Files:**
- Create: `utils/roomTombstones.ts`
- Test: `utils/roomTombstones.test.ts` (create)

**Interfaces:**
- Produces: `interface RoomTombstone { room_key; room_name; pin; created_by; expires_at; name }` (all `string`); `readTombstones(uid): Record<string, RoomTombstone>`; `upsertTombstone(uid, t): void`; `removeTombstone(uid, roomKey): void`.

- [ ] **Step 1: Write the failing test** — create `utils/roomTombstones.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readTombstones, upsertTombstone, removeTombstone, type RoomTombstone } from './roomTombstones';

// Minimal in-memory localStorage so the test is independent of the test env.
function installStorage() {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

const T: RoomTombstone = {
  room_key: 'rk1', room_name: 'Room', pin: '1234',
  created_by: 'u1', expires_at: '2026-01-01T00:00:00.000Z', name: 'Room',
};

describe('roomTombstones', () => {
  beforeEach(() => { installStorage(); });

  it('returns {} when none stored', () => {
    expect(readTombstones('u1')).toEqual({});
  });
  it('upserts and reads back by room_key', () => {
    upsertTombstone('u1', T);
    expect(readTombstones('u1')).toEqual({ rk1: T });
  });
  it('scopes by uid', () => {
    upsertTombstone('u1', T);
    expect(readTombstones('u2')).toEqual({});
  });
  it('removes an entry', () => {
    upsertTombstone('u1', T);
    removeTombstone('u1', 'rk1');
    expect(readTombstones('u1')).toEqual({});
  });
  it('tolerates corrupt JSON', () => {
    localStorage.setItem('roomTombstones_u1', '{not json');
    expect(readTombstones('u1')).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run utils/roomTombstones.test.ts`
Expected: FAIL — module `./roomTombstones` does not exist.

- [ ] **Step 3: Write minimal implementation** — create `utils/roomTombstones.ts`:

```ts
// Local "tombstones" for free rooms (rooms.expires_at). The free 24h purge cron
// hard-deletes the room and cascades the member's subscribers row, leaving NO
// server trace. To still show "this room auto-deleted — recreate?" on the
// dashboard after the user was away, we cache the minimum needed to render +
// recreate, per user, in localStorage. Display-only; the server stays source of
// truth. Cleared on dismiss / delete / logout.

export interface RoomTombstone {
  room_key: string;
  room_name: string;
  pin: string;
  created_by: string;
  expires_at: string; // ISO 24h deadline
  name: string;       // display label (display_name || room_name)
}

const keyFor = (uid: string) => `roomTombstones_${uid}`;

export function readTombstones(uid: string): Record<string, RoomTombstone> {
  try {
    const raw = localStorage.getItem(keyFor(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, RoomTombstone>) : {};
  } catch { return {}; }
}

export function upsertTombstone(uid: string, t: RoomTombstone): void {
  try {
    const all = readTombstones(uid);
    all[t.room_key] = t;
    localStorage.setItem(keyFor(uid), JSON.stringify(all));
  } catch { /* storage blocked/full — display-only, safe to skip */ }
}

export function removeTombstone(uid: string, roomKey: string): void {
  try {
    const all = readTombstones(uid);
    if (!(roomKey in all)) return;
    delete all[roomKey];
    localStorage.setItem(keyFor(uid), JSON.stringify(all));
  } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run utils/roomTombstones.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add utils/roomTombstones.ts utils/roomTombstones.test.ts
git commit -m "feat(room): per-user localStorage tombstones for expired free rooms

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: In-room header countdown pill

**Files:**
- Modify: `components/ChatHeader.tsx`
- Modify: `components/ChatScreen.tsx`

**Interfaces:**
- Consumes: `expiryShortLabel` (Task 1).
- Produces: `ChatHeader` prop `roomFreeExpiryLabel?: string | null`.

- [ ] **Step 1: Add the prop + pill to `ChatHeader.tsx`.**

In the lucide import (line 2), add `Hourglass`:

```tsx
import { Users, Settings, Vibrate, VibrateOff, Volume2, VolumeX, Bell, BellOff, Sun, Moon, LogOut, Timer, Trash2, Hourglass } from 'lucide-react';
```

In `interface ChatHeaderProps`, after `roomExpiryLabel?: string | null;` (line 23) add:

```tsx
  roomFreeExpiryLabel?: string | null; // free-tier 24h expiry countdown (rooms.expires_at)
```

In the destructured props (after `roomExpiryLabel,` at line 48) add:

```tsx
  roomFreeExpiryLabel,
```

Immediately after the existing `{roomExpiryLabel && ( … )}` pill block (ends line 139), add:

```tsx
            {roomFreeExpiryLabel && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full" title={`This free room auto-deletes — ${roomFreeExpiryLabel} left`}>
                <Hourglass size={11} /> {roomFreeExpiryLabel}
              </span>
            )}
```

- [ ] **Step 2: Add the ticker + wire the label in `ChatScreen.tsx`.**

Add the import (near the other util imports, e.g. after the `getRoomBackgroundStyle` import at line 27 — if a `../utils/roomLifecycle` import already exists, merge into it):

```tsx
import { expiryShortLabel } from '../utils/roomLifecycle';
```

Right after the `roomExpiresAt` state declaration (line 213, `const [roomExpiresAt, setRoomExpiresAt] = useState<string | null>(null);`) add:

```tsx
  // Drives the live countdown of the free-tier 24h expiry pill. Only ticks while
  // an expiry is actually set, so there's no always-on timer otherwise.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!roomExpiresAt) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, [roomExpiresAt]);
```

In the `<ChatHeader … />` element, after `roomExpiryLabel={formatTtl(roomExpiry)}` (line 1421) add:

```tsx
        roomFreeExpiryLabel={expiryShortLabel(roomExpiresAt, nowTick)}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verify**

Run `npm run dev`, open a free-tier room. The header shows an amber `Hourglass` pill like `~23h` next to the room name, distinct from the orange/red pills. Leave it open a minute — the value stays current (recomputed each tick).

- [ ] **Step 5: Commit**

```bash
git add components/ChatHeader.tsx components/ChatScreen.tsx
git commit -m "feat(room): header countdown pill for free 24h expiry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Fix phantom room resurrection (durable joined flag)

**Files:**
- Modify: `components/ChatScreen.tsx`

**Interfaces:** none new (behavioral fix only).

- [ ] **Step 1: Switch the read in `initRoom` (line 581).**

Replace:

```tsx
      const alreadyJoined = !!sessionStorage.getItem(`joined_${config.roomKey}`);
```

with:

```tsx
      // Durable (localStorage, not sessionStorage): "have I been in this room
      // before?" must survive a tab close, or reopening a tab on an expired room
      // re-creates it silently (createIfMissing). Consistent with the logout
      // sweep + dashboard dismiss, which already target localStorage joined_ keys.
      const alreadyJoined = !!localStorage.getItem(`joined_${config.roomKey}`);
```

- [ ] **Step 2: Switch `handleRecreate` (line 652).**

Replace:

```tsx
      sessionStorage.removeItem(`joined_${config.roomKey}`);
```

with:

```tsx
      localStorage.removeItem(`joined_${config.roomKey}`);
```

- [ ] **Step 3: Switch the setter effect (lines 682-688).**

Replace the body of the effect:

```tsx
      if (isRoomReady && user && config.roomKey && !roomDeleted) {
          const sessionKey = `joined_${config.roomKey}`;
          if (!sessionStorage.getItem(sessionKey)) {
              sessionStorage.setItem(sessionKey, 'true');
          }
      }
```

with:

```tsx
      if (isRoomReady && user && config.roomKey && !roomDeleted) {
          const joinedKey = `joined_${config.roomKey}`;
          if (!localStorage.getItem(joinedKey)) {
              localStorage.setItem(joinedKey, 'true');
          }
      }
```

- [ ] **Step 4: Verify no stray sessionStorage `joined_` references remain.**

Run: `grep -n "sessionStorage.*joined_" components/ChatScreen.tsx`
Expected: no output (all three converted).
Then: `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Manual verify**

`npm run dev`: create a free room, then in DB set its `expires_at` to the past (`update rooms set expires_at = now() - interval '1 min' where room_key = '<key>'`) and run the purge (`select … ` or wait), or simply delete the room row. Close the tab, reopen the app (it auto-routes back via localStorage). Expected: the in-room **"Room deleted"** toast (Re-create / Exit) appears — the room is NOT silently re-created. Creating a brand-new room (never joined) still works normally.

- [ ] **Step 6: Commit**

```bash
git add components/ChatScreen.tsx
git commit -m "fix(room): durable joined flag stops expired-room resurrection on tab reopen

joined_<key> was in sessionStorage (wiped on tab close) so reopening a tab
auto-routed back into a purged room and createIfMissing silently re-created
it (free -> fresh 24h, paid -> permanent). Move to localStorage, matching the
logout sweep + dashboard dismiss that already target localStorage joined_ keys.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `Room.expires_at` type + dashboard card countdown pill

**Files:**
- Modify: `types.ts`
- Modify: `components/DashboardScreen.tsx`

**Interfaces:**
- Consumes: `expiryShortLabel` (Task 1).
- Produces: `Room.expires_at?: string | null`; `RoomCardProps.now: number`.

- [ ] **Step 1: Add the type field.** In `types.ts`, inside `interface Room`, after `auto_delete_seconds?: number | null; // Ephemeral rooms: auto-delete after inactivity` (line 121) add:

```ts
  expires_at?: string | null; // Free-tier rooms: fixed 24h auto-delete deadline (ISO)
```

- [ ] **Step 2: Import the helper + `Hourglass` in `DashboardScreen.tsx`.**

Change the roomLifecycle import (line 7) to:

```tsx
import { broadcastRoomDeleted, parseRoomDeletedPayload, expiryShortLabel, isExpired } from '../utils/roomLifecycle';
```

In the lucide import block (lines 16-23), add `Hourglass` to the list (e.g. next to `Clock`).

- [ ] **Step 3: Add `now` to `RoomCardProps`.** In the `type RoomCardProps = { … }` block (lines 53-66), add a field:

```tsx
  now: number;
```

- [ ] **Step 4: Render the pill in `RoomCardInner`.**

Add `now` to the destructured props (line 206 parameter list — add `now,` alongside the others).

After `const ttl = ttlLabel(room.auto_delete_seconds);` (line 211) add:

```tsx
  const expLabel = expiryShortLabel(room.expires_at, now);
```

After the existing `{ttl && ( … )}` pill block (ends line 258) add:

```tsx
          {expLabel && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500 font-medium" title="This free room auto-deletes (24h)">
              <Hourglass size={11} />{expLabel}
            </span>
          )}
```

- [ ] **Step 5: Add the `nowTick` ticker + pass it.**

After the `const [isDark, setIsDark] = useState(…)` block (ends ~line 402) add:

```tsx
  // Live clock for the expiry countdown pill + optimistic expiry flip. Dashboard
  // is foreground while mounted, so an always-on 60s tick is fine.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
```

In `cardPropsFor` (lines 1142-1161), add to the returned object:

```tsx
    now: nowTick,
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verify**

`npm run dev`, dashboard: a free room card shows an amber `Hourglass` pill (`~23h`) next to the existing red `Clock` (inactivity) pill, if present. Paid/permanent rooms show no expiry pill.

- [ ] **Step 8: Commit**

```bash
git add types.ts components/DashboardScreen.tsx
git commit -m "feat(dashboard): expires_at on Room + 24h countdown pill on room cards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Dashboard "auto-deleted" card for present-but-expired rooms

**Files:**
- Modify: `components/DashboardScreen.tsx`

**Interfaces:**
- Consumes: `isExpired` (Task 1); `nowTick` (Task 5).
- Produces: deleted payload shape extended to `{ deletedBy?: string; reason?: 'deleted' | 'expired' }`.

- [ ] **Step 1: Extend the `deletedInfo` prop type.** In `type RoomCardProps` (line 58) replace:

```tsx
  deletedInfo?: { deletedBy?: string };
```

with:

```tsx
  deletedInfo?: { deletedBy?: string; reason?: 'deleted' | 'expired' };
```

- [ ] **Step 2: Update the deleted-card copy in `RoomCardInner`.** In the `deletedInfo ? ( … )` block, replace the message line (lines 282-284):

```tsx
            <AlertCircle size={14} className="shrink-0" />
            <span className="truncate">{deletedInfo.deletedBy ? `Διαγράφηκε από ${deletedInfo.deletedBy}` : 'Το δωμάτιο διαγράφηκε'}</span>
```

with:

```tsx
            <AlertCircle size={14} className="shrink-0" />
            <span className="truncate">{
              deletedInfo.reason === 'expired'
                ? 'Διαγράφηκε αυτόματα (όριο 24ώρου)'
                : deletedInfo.deletedBy ? `Διαγράφηκε από ${deletedInfo.deletedBy}` : 'Το δωμάτιο διαγράφηκε'
            }</span>
```

- [ ] **Step 3: Trigger the deleted state for present-but-expired rooms.** In `cardPropsFor` (line 1153) replace:

```tsx
    deletedInfo: deletedRooms.get(room.room_key),
```

with:

```tsx
    deletedInfo: deletedRooms.get(room.room_key) ?? (isExpired(room.expires_at, nowTick) ? { reason: 'expired' as const } : undefined),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verify**

`npm run dev`, dashboard. In DB set a free room's `expires_at` to ~1 minute in the future (`update rooms set expires_at = now() + interval '1 min' where room_key = '<key>'`). Reload the dashboard; within ~60s of the deadline passing, the card flips to "Διαγράφηκε αυτόματα (όριο 24ώρου)" with **Ξανα-δημιούργησε / Απόρριψη** instead of "Enter Room". Re-create rebuilds it; Dismiss removes it.

- [ ] **Step 6: Commit**

```bash
git add components/DashboardScreen.tsx
git commit -m "feat(dashboard): expired free rooms render as auto-deleted cards (live flip)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Tombstones — show "auto-deleted" after the cron purged the room

**Files:**
- Modify: `components/DashboardScreen.tsx`

**Interfaces:**
- Consumes: `readTombstones`/`upsertTombstone`/`removeTombstone`/`RoomTombstone` (Task 2); `isExpired` (Task 1); `cardPropsFor`/`StaticRoomCard` (existing); `recreateRoom`/`dismissDeletedRoom`/`deleteRoomByKey` (existing).

- [ ] **Step 1: Import the tombstone helpers.** Add near the other util imports (after line 7):

```tsx
import { readTombstones, upsertTombstone, removeTombstone, type RoomTombstone } from '../utils/roomTombstones';
```

- [ ] **Step 2: Add tombstone state + a synthetic-room builder.** After the `deletedRooms` state declaration (line 375) add:

```tsx
  // Free rooms the cron already purged while the user was away (no server trace
  // left): surfaced as non-navigable "auto-deleted" cards from localStorage.
  const [tombstoneDeleted, setTombstoneDeleted] = useState<Map<string, RoomTombstone>>(new Map());
```

After `cardPropsFor` (after line 1161) add the builder:

```tsx
  // Display-only Room from a tombstone (its expires_at is in the past, so
  // cardPropsFor's isExpired check renders it as an "auto-deleted" card).
  const tombstoneToRoom = (t: RoomTombstone): Room => ({
    id: '', room_key: t.room_key, room_name: t.room_name, pin: t.pin,
    created_by: t.created_by, created_at: '', expires_at: t.expires_at, display_name: t.name,
  } as Room);
```

- [ ] **Step 3: Write + diff tombstones on a successful fetch.** In `initData`, inside the `try` block right after `setRooms(allRooms); loadOverview(allRooms);` (line 537), add:

```tsx
        // Refresh tombstones for every free room we can still see (captures
        // name+pin so we can render + recreate after the row is gone), then
        // surface any tombstone whose room is gone AND whose 24h deadline passed
        // (purged by the cron while away). Runs only here — i.e. after a
        // SUCCESSFUL fetch — so a transient error never flips rooms to "deleted".
        allRooms.forEach((r) => {
          if (r.expires_at) upsertTombstone(user.uid, {
            room_key: r.room_key, room_name: r.room_name, pin: r.pin,
            created_by: r.created_by, expires_at: r.expires_at, name: r.display_name || r.room_name,
          });
        });
        const liveKeys = new Set(allRooms.map((r) => r.room_key));
        const stored = readTombstones(user.uid);
        const purged = new Map<string, RoomTombstone>();
        for (const k in stored) {
          const t = stored[k];
          if (!liveKeys.has(k) && isExpired(t.expires_at)) purged.set(k, t);
        }
        setTombstoneDeleted(purged);
```

- [ ] **Step 4: Render the tombstone cards (non-sortable block above the list).** Locate the rooms-area conditional that begins with `{loadingRooms ? (` (around line 1470). Immediately **before** that `{loadingRooms ? (` expression, inside the same parent container, insert:

```tsx
                        {tombstoneDeleted.size > 0 && (
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 mb-4">
                                {[...tombstoneDeleted.values()].map((t) => {
                                    const room = tombstoneToRoom(t);
                                    return <StaticRoomCard key={room.room_key} room={room} {...cardPropsFor(room)} />;
                                })}
                            </div>
                        )}
```

- [ ] **Step 5: Clear the tombstone on dismiss.** In `dismissDeletedRoom` (lines 954-965), after the existing `setDeletedRooms(prev => …)` line add:

```tsx
    setTombstoneDeleted(prev => { if (!prev.has(key)) return prev; const next = new Map(prev); next.delete(key); return next; });
    removeTombstone(user.uid, key);
```

- [ ] **Step 6: Clear the tombstone on manual delete/leave.** In `deleteRoomByKey`, inside the final local-cleanup section (after the `setRooms(prev => prev.filter(...))` at line 907) add:

```tsx
    removeTombstone(user.uid, key);
    setTombstoneDeleted(prev => { if (!prev.has(key)) return prev; const next = new Map(prev); next.delete(key); return next; });
```

- [ ] **Step 7: Make `recreateRoom` rebuild the live card from the fresh row + clear the tombstone.** Replace the whole `recreateRoom` callback (lines 929-949) with:

```tsx
  // Re-create a deleted/expired room (same name+PIN). Works for both a live-
  // deleted room (still in `rooms`) and a tombstone (synthetic, not in `rooms`):
  // after the RPC succeeds we read the fresh row so the card reflects the NEW
  // expiry/created_at (the RPC payload omits expires_at). The user stays here.
  const recreateRoom = useCallback(async (room: Room) => {
    try {
      const { data, error } = await joinOrCreateRoom({
        roomKey: room.room_key, roomName: room.room_name, pin: room.pin,
        username: displayName, createIfMissing: true,
      });
      if (error?.code === 'ROOM_LIMIT') {
        setUpgradePrompt({ featureLabel: 'Another room', requiredTier: tier === 'free' ? 'basic' : 'ultra' });
        return;
      }
      if (error || !data) { alert('Could not re-create the room. Please try again.'); return; }
      // Durable joined flag is localStorage now (see ChatScreen) — clear it so a
      // later in-room entry treats this as a fresh, existing room.
      localStorage.removeItem(`joined_${room.room_key}`);
      const { data: freshRow } = await supabase.from('rooms').select('*').eq('room_key', room.room_key).maybeSingle();
      const fresh = freshRow as Room | null;
      setDeletedRooms(prev => { const next = new Map(prev); next.delete(room.room_key); return next; });
      setTombstoneDeleted(prev => { if (!prev.has(room.room_key)) return prev; const next = new Map(prev); next.delete(room.room_key); return next; });
      // The re-created room is empty — drop any stale overview so the card shows
      // "No messages yet" instead of the pre-deletion preview.
      setOverview(prev => { const next = new Map(prev); next.delete(room.room_key); return next; });
      if (fresh) {
        setRooms(prev => prev.some(r => r.room_key === fresh.room_key)
          ? prev.map(r => (r.room_key === fresh.room_key ? fresh : r))
          : [fresh, ...prev]);
        if (fresh.expires_at) upsertTombstone(user.uid, {
          room_key: fresh.room_key, room_name: fresh.room_name, pin: fresh.pin,
          created_by: fresh.created_by, expires_at: fresh.expires_at, name: fresh.display_name || fresh.room_name,
        });
        else removeTombstone(user.uid, fresh.room_key);
      }
    } catch {
      alert('Could not re-create the room. Please try again.');
    }
  }, [displayName, tier, user.uid]);
```

- [ ] **Step 8: Typecheck + full test run**

Run: `npx tsc --noEmit` → no errors.
Run: `npm test` → all tests pass (Tasks 1 & 2 suites green).

- [ ] **Step 9: Manual verify**

`npm run dev`. (1) Have a free room on the dashboard so a tombstone is written. (2) In DB delete that room row outright (simulating the cron purge): `delete from rooms where room_key = '<key>'` (cascades subscribers/messages). (3) Reload the dashboard. Expected: a non-draggable "Διαγράφηκε αυτόματα (όριο 24ώρου)" card appears at the top with **Ξανα-δημιούργησε / Απόρριψη**. Re-create rebuilds a live card with a fresh countdown pill; Dismiss removes the card and leaves no stray tombstone (reload → it stays gone). Manually deleting/leaving a room leaves no tombstone card.

- [ ] **Step 10: Commit**

```bash
git add components/DashboardScreen.tsx
git commit -m "feat(dashboard): local tombstones surface cron-purged free rooms as recreatable

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Header pill (spec Part 1) → Task 3. ✅
- Dashboard card pill (Part 2) → Task 5. ✅
- Auto-delete deleted card, present + live flip (Part 3a) → Task 6; tombstones for purged-while-away (Part 3b) → Task 7. ✅
- Phantom resurrection fix (Part 4) → Task 4. ✅
- Shared helpers `expiryShortLabel`/`isExpired` → Task 1; tombstone helper → Task 2. ✅
- Distinct pill styles (amber Hourglass) → Tasks 3, 5. ✅
- `fetchOk` guard (no false deletes on transient error) → Task 7 Step 3 (diff runs only in the success `try` path after the `throw` guards). ✅
- Non-sortable tombstone rendering → Task 7 Step 4 (`StaticRoomCard`, own block above the grid). ✅

**Placeholder scan:** none — every code step shows full code; manual steps give exact SQL/commands.

**Type consistency:** `expiryShortLabel(iso?, now?)` and `isExpired(iso?, now?)` used identically in Tasks 3/5/6/7. `RoomTombstone` fields match between Task 2 (definition), Task 7 (upsert/build). `deletedInfo` shape `{ deletedBy?; reason? }` consistent between Task 6 Step 1 (type) and Step 2/3 (usage). `Room.expires_at` added in Task 5 before first use in Tasks 5/6/7. `now` prop added to `RoomCardProps` (Task 5) before use in Task 6. `recreateRoom` deps include `user.uid` (added) since it now calls `upsertTombstone/removeTombstone(user.uid, …)`.
