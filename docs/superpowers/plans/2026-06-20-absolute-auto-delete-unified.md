# Unified Absolute Auto-Delete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every room auto-delete at a fixed absolute deadline (`rooms.expires_at`) — free = 24h from creation (unchanged), Basic/Ultra = chosen interval from the moment of selection (not inactivity) — with one live `expires_at` countdown everywhere and the existing "auto-deleted → Re-create" notification applying to all rooms.

**Architecture:** Unify all deletion onto the existing absolute `expires_at` column + the existing tier-agnostic purge cron (jobid 5). A new `SECURITY DEFINER` RPC `set_room_auto_delete` sets `expires_at = now() + interval` (and stores the chosen `auto_delete_seconds` for UI state); the inactivity cron/function are dropped. The client drops the inactivity countdown helper and renders a single `expires_at` countdown.

**Tech Stack:** Supabase Postgres + pg_cron + RLS; the Supabase MCP `apply_migration`/`execute_sql` tools; React 18 + TS + Vite; vitest 2.

## Global Constraints

- No migration of existing rooms (0 currently use `auto_delete_seconds`/`expires_at`); never backfill `expires_at` outside creation/RPC; the free-fixed guard keeps free rooms' 24h immutable.
- Error contract unchanged: tier failure = SQLSTATE `QT004`, message `TIER_REQUIRED:basic` (mirrors `enforce_room_tier`).
- App UI copy = English. Dashboard deleted-card copy stays Greek (existing). Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- `expires_at` (free-fixed) vs paid-chosen signature: **free-fixed = `expires_at` set AND `auto_delete_seconds` null**; **paid-chosen = both set**; **off = both null**. Used identically in the RPC guard and the Room-info row.

---

## File Structure

- **DB migration `unified_absolute_auto_delete`** — create `set_room_auto_delete`, revoke direct `auto_delete_seconds` write, drop the `expire_rooms` cron + function.
- **`utils/roomLifecycle.ts` / `.test.ts`** — remove `inactivityExpiryLabel` (revert) ; keep `expiryShortLabel`/`isExpired`.
- **`services/supabase.ts`** — add `setRoomAutoDelete`.
- **`components/RoomExpiryModal.tsx`** — call the RPC; absolute copy; 2-arg `onUpdate`.
- **`components/ChatScreen.tsx`** — handler sets both states; single `expires_at` header pill.
- **`components/ChatHeader.tsx`** — drop the inactivity red pill + prop.
- **`components/DashboardScreen.tsx`** — single `expires_at` card pill; drop inactivity pill.
- **`components/RoomInfoModal.tsx`** — redefine `roomOnFreeTimer` to free-fixed only.

---

### Task 1: DB — `set_room_auto_delete` RPC, revoke direct write, drop inactivity path

**Files:** DB migration via `apply_migration` (name: `unified_absolute_auto_delete`).

**Interfaces:**
- Produces: `set_room_auto_delete(p_room_key text, p_seconds int) returns jsonb` (keys `expires_at`, `auto_delete_seconds`); raises `QT004 TIER_REQUIRED:basic` for free tier.

- [ ] **Step 1: Apply the migration.** Call `apply_migration` with name `unified_absolute_auto_delete` and this SQL:

```sql
-- Absolute auto-delete for all rooms, unified on rooms.expires_at.
create or replace function public.set_room_auto_delete(p_room_key text, p_seconds int)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := (select auth.uid())::text;
  v_expires timestamptz;
  v_seconds int;
  v_new_expires timestamptz;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_member(p_room_key) then raise exception 'NOT_A_MEMBER'; end if;
  -- Auto-delete is a Basic+ feature (mirror enforce_room_tier).
  if public.effective_tier((select auth.uid())) = 'free' then
    raise exception 'TIER_REQUIRED:basic' using errcode = 'QT004';
  end if;
  if p_seconds is not null and p_seconds < 60 then raise exception 'BAD_INTERVAL'; end if;

  select expires_at, auto_delete_seconds into v_expires, v_seconds
  from public.rooms where room_key = p_room_key;
  -- A free 24h room (expires_at set, no chosen interval) is immutable.
  if v_expires is not null and v_seconds is null then
    raise exception 'FREE_ROOM_FIXED';
  end if;

  v_new_expires := case when p_seconds is null then null
                        else now() + make_interval(secs => p_seconds) end;

  update public.rooms
     set auto_delete_seconds = p_seconds,
         expires_at = v_new_expires
   where room_key = p_room_key;

  return jsonb_build_object('expires_at', v_new_expires, 'auto_delete_seconds', p_seconds);
end;
$$;

grant execute on function public.set_room_auto_delete(text, int) to anon, authenticated;

-- The RPC is now the ONLY way to change auto-delete (it sets expires_at too).
-- Revoke the direct column write so a client can't desync auto_delete_seconds
-- from expires_at. (No table-level UPDATE grant exists to mask this.)
revoke update (auto_delete_seconds) on public.rooms from anon, authenticated;

-- Remove the inactivity deletion path (0 rooms use it).
select cron.unschedule('expire_rooms');
drop function if exists public.expire_rooms();
```

- [ ] **Step 2: Verify structurally** via `execute_sql` (run each; confirm expected):

```sql
-- RPC exists + SECURITY DEFINER:
select proname, prosecdef from pg_proc where proname='set_room_auto_delete';            -- 1 row, prosecdef=t
-- granted to anon+authenticated:
select grantee from information_schema.routine_privileges
 where routine_name='set_room_auto_delete' and grantee in ('anon','authenticated');     -- 2 rows
-- direct write revoked:
select grantee from information_schema.column_privileges
 where table_name='rooms' and column_name='auto_delete_seconds'
   and grantee in ('anon','authenticated');                                             -- 0 rows
-- inactivity cron + fn gone, purge cron stays:
select jobname from cron.job where jobname in ('expire_rooms','purge-expired-free-rooms') order by jobname; -- only purge-expired-free-rooms
select proname from pg_proc where proname='expire_rooms';                               -- 0 rows
-- interval math sanity:
select now() + make_interval(secs => 86400) > now() + interval '23 hours' as ok;        -- t
```

Expected: as annotated. If `message_ttl_seconds` direct write is still present (it must be), confirm it wasn't revoked: `select column_name from information_schema.column_privileges where table_name='rooms' and column_name='message_ttl_seconds' and grantee='authenticated';` → 1 row.

- [ ] **Step 3: Record the migration** in a short audit note `docs/superpowers/audits/2026-06-20-unified-auto-delete-migration.md` (migration name + the verification output) and commit it.

```bash
git add docs/superpowers/audits/2026-06-20-unified-auto-delete-migration.md
git commit -m "db(audit): unified absolute auto-delete migration record

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Remove the inactivity countdown helper (revert)

**Files:**
- Modify: `utils/roomLifecycle.ts`
- Modify: `utils/roomLifecycle.test.ts`

**Interfaces:**
- Produces: `roomLifecycle.ts` no longer exports `inactivityExpiryLabel`; `expiryShortLabel`/`isExpired` unchanged.

- [ ] **Step 1: Delete the `inactivityExpiryLabel` test block** in `utils/roomLifecycle.test.ts` — remove the entire `describe('inactivityExpiryLabel', () => { … });` block and drop `inactivityExpiryLabel` from the import so it reads:

```ts
import { parseRoomDeletedPayload, expiryShortLabel, isExpired } from './roomLifecycle';
```

- [ ] **Step 2: Delete the `inactivityExpiryLabel` function** in `utils/roomLifecycle.ts` (the whole `export function inactivityExpiryLabel(…) { … }` block). Keep `shortMsLabel`, `expiryShortLabel`, `isExpired`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run utils/roomLifecycle.test.ts`
Expected: PASS (11 tests — the original `expiryShortLabel`/`isExpired`/`parseRoomDeletedPayload` sets).

- [ ] **Step 4: Commit** (bundled with Task 3–6 at the end, or standalone — see final commit).

---

### Task 3: `setRoomAutoDelete` service + RoomExpiryModal calls the RPC

**Files:**
- Modify: `services/supabase.ts`
- Modify: `components/RoomExpiryModal.tsx`

**Interfaces:**
- Consumes: RPC `set_room_auto_delete` (Task 1).
- Produces: `setRoomAutoDelete(roomKey: string, seconds: number | null): Promise<{ data: { expires_at: string | null; auto_delete_seconds: number | null } | null; error: unknown }>`; `RoomExpiryModalProps.onUpdate: (seconds: number | null, expiresAt: string | null) => void`.

- [ ] **Step 1: Add the service wrapper** in `services/supabase.ts` (near `joinOrCreateRoom`):

```ts
// Set/clear a room's absolute auto-delete deadline (Basic+). The RPC sets
// rooms.expires_at = now()+seconds (or null) AND stores the chosen interval.
export async function setRoomAutoDelete(
  roomKey: string,
  seconds: number | null,
): Promise<{ data: { expires_at: string | null; auto_delete_seconds: number | null } | null; error: unknown }> {
  const { data, error } = await supabase.rpc('set_room_auto_delete', {
    p_room_key: roomKey,
    p_seconds: seconds,
  });
  return { data: (data as { expires_at: string | null; auto_delete_seconds: number | null } | null) ?? null, error };
}
```

- [ ] **Step 2: RoomExpiryModal — import + prop type.** In `components/RoomExpiryModal.tsx`, change the supabase import line to also import the wrapper, and update the prop type:

```ts
import { supabase, setRoomAutoDelete } from '../services/supabase';
```
```ts
  onUpdate: (seconds: number | null, expiresAt: string | null) => void;
```
(`supabase` import is still used elsewhere? If not, drop it — check: after Step 3 the only DB call is `setRoomAutoDelete`, so remove `supabase` from the import: `import { setRoomAutoDelete } from '../services/supabase';`.)

- [ ] **Step 3: RoomExpiryModal — call the RPC.** Replace the body of `choose` (the `try` block) so it calls the RPC and passes both values up:

```ts
  const choose = async (seconds: number | null) => {
    if (seconds === currentSeconds) { onClose(); return; }
    setSaving(seconds);
    try {
      const { data, error } = await setRoomAutoDelete(roomKey, seconds);
      if (error) throw error;
      if (!mountedRef.current || !openRef.current) return;
      onUpdate(seconds, data?.expires_at ?? null);
      onClose();
    } catch (e) {
      console.error(e);
      const tierErr = parseTierError(e);
      if (tierErr?.code === 'QT004' && onUpgrade) {
        onClose();
        onUpgrade('Auto-delete', tierErr.requiredTier);
      } else if (mountedRef.current && openRef.current) {
        alert('Failed to update auto-delete');
      }
    } finally {
      if (mountedRef.current) setSaving(undefined);
    }
  };
```

- [ ] **Step 4: RoomExpiryModal — absolute copy.** Change the description paragraph (currently "…after this period of inactivity") to:

```tsx
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">When on, the whole room — every message and shared file — is permanently deleted for everyone after this period, whether or not it's been used.</p>
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY at the `ChatScreen` call site of `RoomExpiryModal` (its `onUpdate` now needs 2 args) — fixed in Task 4. (If you run tsc after Task 4, expect clean.)

---

### Task 4: ChatScreen handler + single header countdown pill

**Files:**
- Modify: `components/ChatScreen.tsx`
- Modify: `components/ChatHeader.tsx`

**Interfaces:**
- Consumes: `RoomExpiryModal.onUpdate(seconds, expiresAt)` (Task 3); `expiryShortLabel` (existing).
- Produces: `ChatHeader` no longer has a `roomExpiryLabel` prop.

- [ ] **Step 1: ChatScreen — remove the inactivity import.** Change:
```ts
import { expiryShortLabel, inactivityExpiryLabel } from '../utils/roomLifecycle';
```
to:
```ts
import { expiryShortLabel } from '../utils/roomLifecycle';
```

- [ ] **Step 2: ChatScreen — header pill.** In the `<ChatHeader … />` element, delete the line:
```tsx
        roomExpiryLabel={inactivityExpiryLabel(roomExpiry, messages[messages.length - 1]?.createdAt, nowTick)}
```
Keep `roomFreeExpiryLabel={expiryShortLabel(roomExpiresAt, nowTick)}` (the single amber countdown, now covering all auto-delete rooms). `messageTtlLabel` stays.

- [ ] **Step 3: ChatScreen — RoomExpiry handler sets both states.** Replace the `onUpdate` on `<RoomExpiryModal>`:

```tsx
        onUpdate={(secs, expiresAt) => {
          setRoomExpiry(secs);
          setRoomExpiresAt(expiresAt);
          const label = formatTtl(secs);
          sendMessage(label ? `Auto-delete set to ${label} by ${config.username}` : `Auto-delete turned off by ${config.username}`, config, null, null, null, 'system');
        }}
```

- [ ] **Step 4: ChatHeader — drop the inactivity pill + prop.** In `components/ChatHeader.tsx`:
  - Remove `roomExpiryLabel?: string | null;` from `ChatHeaderProps`.
  - Remove `roomExpiryLabel,` from the destructured params.
  - Remove the entire `{roomExpiryLabel && ( … <Trash2 …/> … )}` pill block.
  - Keep the `{roomFreeExpiryLabel && ( … <Hourglass …/> … )}` block; update its tooltip to: `title={\`This room auto-deletes — ${roomFreeExpiryLabel} left\`}`.
  - If `Trash2` is now unused in ChatHeader, remove it from the `lucide-react` import (check: it was only used by that pill).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (RoomInfoModal still receives `roomExpiryLabel` — that's its own prop, unaffected).

---

### Task 5: Dashboard — single `expires_at` card countdown

**Files:**
- Modify: `components/DashboardScreen.tsx`

**Interfaces:**
- Consumes: `expiryShortLabel` (existing import).

- [ ] **Step 1: Remove the inactivity import.** Change the roomLifecycle import to drop `inactivityExpiryLabel`:
```ts
import { broadcastRoomDeleted, parseRoomDeletedPayload, expiryShortLabel, isExpired } from '../utils/roomLifecycle';
```

- [ ] **Step 2: Drop the inactivity pill in `RoomCardInner`.** Remove the line:
```tsx
  const ttl = inactivityExpiryLabel(room.auto_delete_seconds, overview?.lastAt ?? room.created_at, now);
```
and remove its render block:
```tsx
          {ttl && (
            <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-medium" title="Auto-deletes without activity — time remaining (resets when someone posts)">
              <Clock size={11} />{ttl}
            </span>
          )}
```
Keep the `expLabel` pill (the amber `Hourglass` `expiryShortLabel(room.expires_at, now)` countdown) — it now represents all auto-delete rooms.

- [ ] **Step 3: Remove the now-unused `Clock` import** from the `lucide-react` block IF `Clock` is unused elsewhere in the file. Verify: `grep -n "Clock" components/DashboardScreen.tsx`. (`Clock` is also used by the "Ephemeral 24h" button — if so, KEEP it.) Likewise confirm `now` is still used (the `expLabel` pill uses it) so it stays in props.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no `noUnusedLocals` errors).

---

### Task 6: Room-info — free-fixed vs paid-chosen row

**Files:**
- Modify: `components/RoomInfoModal.tsx`

**Interfaces:**
- Consumes: existing props `roomExpiresAt`, `roomExpiryLabel`.

- [ ] **Step 1: Redefine `roomOnFreeTimer` to free-fixed only.** The hero hint (`formatExpiryHint(roomExpiresAt)`) already shows a countdown for ANY `expires_at` (free + paid) — leave it. But `roomOnFreeTimer` currently equals `!!expiryHint`, which would wrongly treat a paid-chosen room (which now also has `expires_at`) as the immutable free timer. Change:

```ts
  const expiryHint = formatExpiryHint(roomExpiresAt);
  // Free-fixed = the room carries an expires_at but NO chosen interval (only free
  // creation does that). A paid-chosen room has BOTH, and must stay editable.
  const roomOnFreeTimer = !!roomExpiresAt && !roomExpiryLabel;
```

(Replace the existing `const roomOnFreeTimer = !!expiryHint;` line. `expiryHint` keeps its current definition/uses for the hero hint.)

- [ ] **Step 2: Typecheck + full test suite + build**

Run: `npx tsc --noEmit` → clean.
Run: `npm test` → all pass (75 tests: 79 minus the 4 removed inactivity tests).
Run: `npm run build` → succeeds.

- [ ] **Step 3: Commit Tasks 2–6** (client) together:

```bash
git add utils/roomLifecycle.ts utils/roomLifecycle.test.ts services/supabase.ts components/RoomExpiryModal.tsx components/ChatScreen.tsx components/ChatHeader.tsx components/DashboardScreen.tsx components/RoomInfoModal.tsx
git commit -m "feat(room): unified absolute auto-delete (countdown + recreate everywhere)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Manual verify** (after deploy): paid room → set "1 day" → header + card + Room-info hero show ~24h countdown that does NOT reset on new messages; Room-info row editable. Free room → header/card show 24h countdown, Room-info row read-only "Free room · 1 day". Set a room's `expires_at` to the past via SQL → cron purge (≤15 min) → in-room "Room deleted" toast + dashboard "auto-deleted → Re-create" card.

---

## Self-Review

**Spec coverage:**
- Unified `expires_at` deadline + tier-agnostic purge → Task 1 (RPC + keep cron 5). ✅
- Paid deadline from choice (`now()+interval`) → Task 1 RPC `make_interval`. ✅
- Drop inactivity → Task 1 (unschedule + drop `expire_rooms`). ✅
- Free 24h immutable (free-fixed guard) → Task 1 RPC guard + Task 6 `roomOnFreeTimer`. ✅
- Single countdown everywhere → Task 4 (header), Task 5 (card), Task 6 (Room-info hero already covers paid). ✅
- "Deleted → recreate" notification for all rooms → automatic (deleted-card + tombstones key on `expires_at`); no task needed — noted. ✅
- RPC tier gate QT004 `TIER_REQUIRED:basic` → Task 1 (mirrors `enforce_room_tier`); client path unchanged (RoomExpiryModal catch). ✅
- Revert inactivity helper → Task 2. ✅

**Placeholder scan:** none — exact SQL + exact old→new snippets throughout.

**Type consistency:** `setRoomAutoDelete(roomKey, seconds)` → `{ data: { expires_at, auto_delete_seconds } | null, error }` consistent between Task 3 def and RoomExpiryModal use. `onUpdate(seconds, expiresAt)` consistent between RoomExpiryModal prop (Task 3) and ChatScreen call (Task 4). `roomOnFreeTimer` redefinition (Task 6) uses `roomExpiresAt`+`roomExpiryLabel` (existing props). `inactivityExpiryLabel` removed in Task 2 and all its call sites removed in Tasks 4–5 (no dangling references).
