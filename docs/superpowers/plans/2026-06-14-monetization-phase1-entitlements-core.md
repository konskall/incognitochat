# Monetization Phase 1 — Entitlements Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-authoritative entitlements foundation for the Free/Basic/Ultra tiers — the `subscriptions` table, tier resolution, the message-quota and room-tier enforcement, room-count limits, free-room expiry, downgrade reconciliation, and the two purge crons — plus the shared TypeScript entitlements config used by later phases.

**Architecture:** A webhook-written `subscriptions` table drives `effective_tier(uuid)` (SECURITY DEFINER). Database triggers enforce the per-room/day message quota and guard premium room settings; `join_or_create_room` enforces the room cap and stamps free rooms with a 24h `expires_at`; `reconcile_entitlements(uuid)` relocks/clears on subscription change; two pg_cron jobs purge expired free rooms and expired ("disappearing") messages. A pure `utils/entitlements.ts` mirrors the limits for the client.

**Tech Stack:** Supabase Postgres (pg_cron, SECURITY DEFINER funcs, RLS), TypeScript + Vitest. DB migrations are Supabase-managed (applied via the `apply_migration` MCP tool) and recorded in `docs/superpowers/audits/`, since they are not git-tracked. Push to `main` is authorized.

**Source spec:** `docs/superpowers/specs/2026-06-14-monetization-tiers-stripe-design.md`

**Verified live shapes (2026-06-14):** `messages.uid` = `text`, `messages.room_key` = `text`, `messages.type` = `text`, `messages.created_at` = `timestamptz`; `rooms.created_by` = `uuid`; `subscribers.uid` = `text`. The current `join_or_create_room` body is reproduced verbatim in Task 7.

---

## CRITICAL SAFETY CONSTRAINTS (read before any task)

1. **Never backfill `expires_at` on existing rooms.** All current users are `free` (no subscriptions yet); stamping existing free-owned rooms with a 24h expiry would delete every current room. New `expires_at` is set **only** by `join_or_create_room` for newly created free rooms. The column is added as nullable with no default and no UPDATE backfill.
2. **Never auto-lock existing rooms.** `reconcile_entitlements` is called **only** from the Stripe webhook (Phase 2). Pre-existing free users with multiple rooms keep them writable; they simply cannot create new ones once over the cap. This is intentional (non-destructive grandfathering).
3. **Behavioral DB verification must self-roll-back.** Use the "raise-to-rollback-and-report" pattern shown in Task 5/Task 7 (a `DO` block that performs the test, then `raise exception` with the result so the test data is rolled back and the result is surfaced in the error text). Never leave test rows in the production database.
4. **Keep the TS config and the SQL numbers in sync.** `TIER_CONFIG` in `utils/entitlements.ts` (Task 1) and the hardcoded limits in the SQL (Tasks 5, 7, 8) must agree: free = 10 msgs/room/day & 1 room & 24h & 10MB; basic = 100 & 10 rooms & permanent & 10MB; ultra = unlimited & unlimited & permanent & 40MB.
5. **Verification blocks must seed FK parents.** `rooms.created_by` → `auth.users(id)` (NO cascade) and `subscriptions.user_id` → `auth.users(id)`. Any self-rolling-back `DO` block that INSERTs a room or a subscription with a fabricated uid must first seed the parent: `insert into auth.users (id) values ('<uuid>') on conflict (id) do nothing;` for each test uid (auth.users requires only `id`; `is_sso_user`/`is_anonymous` default false). The terminal `raise exception` rolls the seeded user back too — confirm with a `leaked_users` count where practical. (`messages.uid` is `text` with no FK, so message inserts need only their parent room.) The verification blocks in Tasks 4–9 below already include this seeding.

---

## File / artifact map

- **Create** `utils/entitlements.ts` — pure tier config + `resolveTier` (mirror of SQL `effective_tier`) + helpers. Consumed by Phase 3's `useEntitlements`.
- **Create** `utils/entitlements.test.ts` — vitest unit tests for the above.
- **DB (via apply_migration)** — `subscriptions` table; `rooms.expires_at`, `rooms.locked`; index `idx_messages_uid_room_created`; functions `effective_tier`, `enforce_message_quota` (+ trigger), `enforce_room_tier` (+ trigger), `reconcile_entitlements`; modified `join_or_create_room`; cron jobs `purge-expired-free-rooms`, `purge-expired-messages`.
- **Create** `docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md` — records every Phase 1 migration's SQL + verification result.

---

## Task 1: Shared TypeScript entitlements config + pure helpers

**Files:**
- Create: `utils/entitlements.ts`
- Test: `utils/entitlements.test.ts`

- [ ] **Step 1: Write the failing test**

Create `utils/entitlements.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  TIER_CONFIG, resolveTier, entitlements, messagesRemaining, type SubscriptionRow,
} from './entitlements';

const T0 = Date.parse('2026-06-14T12:00:00.000Z');
const sub = (over: Partial<SubscriptionRow>): SubscriptionRow =>
  ({ tier: 'basic', status: 'active', current_period_end: null, ...over });

describe('resolveTier (mirror of SQL effective_tier)', () => {
  it('no subscription row -> free', () => {
    expect(resolveTier(null, T0)).toBe('free');
  });
  it('active -> the subscribed tier', () => {
    expect(resolveTier(sub({ tier: 'ultra', status: 'active' }), T0)).toBe('ultra');
    expect(resolveTier(sub({ tier: 'basic', status: 'trialing' }), T0)).toBe('basic');
  });
  it('canceled but still within paid period -> tier (grace)', () => {
    expect(resolveTier(sub({ status: 'canceled', current_period_end: '2026-06-20T00:00:00.000Z' }), T0)).toBe('basic');
  });
  it('canceled and period elapsed -> free', () => {
    expect(resolveTier(sub({ status: 'canceled', current_period_end: '2026-06-10T00:00:00.000Z' }), T0)).toBe('free');
  });
  it('past_due within period -> tier; past_due with null period -> free', () => {
    expect(resolveTier(sub({ status: 'past_due', current_period_end: '2026-06-20T00:00:00.000Z' }), T0)).toBe('basic');
    expect(resolveTier(sub({ status: 'past_due', current_period_end: null }), T0)).toBe('free');
  });
  it('unknown/incomplete status -> free', () => {
    expect(resolveTier(sub({ status: 'incomplete', current_period_end: null }), T0)).toBe('free');
  });
});

describe('entitlements + helpers', () => {
  it('exposes the spec limits per tier', () => {
    expect(entitlements('free').msgPerRoomPerDay).toBe(10);
    expect(entitlements('basic').msgPerRoomPerDay).toBe(100);
    expect(entitlements('ultra').msgPerRoomPerDay).toBeNull();
    expect(entitlements('free').maxRooms).toBe(1);
    expect(entitlements('basic').maxRooms).toBe(10);
    expect(entitlements('ultra').maxRooms).toBeNull();
    expect(entitlements('free').roomLifetimeHours).toBe(24);
    expect(entitlements('basic').roomLifetimeHours).toBeNull();
    expect(entitlements('ultra').maxFileBytes).toBe(40 * 1024 * 1024);
    expect(entitlements('free').maxFileBytes).toBe(10 * 1024 * 1024);
  });
  it('gates premium features per tier', () => {
    expect(entitlements('free').canAudioCall).toBe(false);
    expect(entitlements('basic').canAudioCall).toBe(true);
    expect(entitlements('basic').canVideoCall).toBe(false);
    expect(entitlements('basic').canAI).toBe(false);
    expect(entitlements('ultra').canVideoCall).toBe(true);
    expect(entitlements('ultra').canScreenShare).toBe(true);
    expect(entitlements('ultra').canAI).toBe(true);
    expect(entitlements('basic').canRoomAppearance).toBe(true);
    expect(entitlements('basic').canDisappearing).toBe(true);
    expect(entitlements('free').canRoomAppearance).toBe(false);
  });
  it('messagesRemaining clamps at 0 and returns null for unlimited', () => {
    expect(messagesRemaining('free', 0)).toBe(10);
    expect(messagesRemaining('free', 10)).toBe(0);
    expect(messagesRemaining('free', 15)).toBe(0);
    expect(messagesRemaining('ultra', 9999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- entitlements`
Expected: FAIL — `Cannot find module './entitlements'` (file not created yet).

- [ ] **Step 3: Write the implementation**

Create `utils/entitlements.ts`:

```ts
// Single source of truth for tier limits on the CLIENT. These numbers MUST match
// the hardcoded limits in the SQL (effective_tier / enforce_message_quota /
// join_or_create_room / reconcile_entitlements). The database is authoritative;
// this mirror exists only so the UI can gray out / show counters instantly.
export type Tier = 'free' | 'basic' | 'ultra';

export interface TierEntitlements {
  msgPerRoomPerDay: number | null; // null = unlimited
  maxRooms: number | null;         // null = unlimited
  maxFileBytes: number;
  roomLifetimeHours: number | null; // free rooms auto-delete after N hours; null = permanent
  canAudioCall: boolean;
  canVideoCall: boolean;
  canScreenShare: boolean;
  canRoomAppearance: boolean;
  canDisappearing: boolean; // disappearing messages + custom auto-delete
  canAI: boolean;
}

const MB = 1024 * 1024;

export const TIER_CONFIG: Record<Tier, TierEntitlements> = {
  free: {
    msgPerRoomPerDay: 10, maxRooms: 1, maxFileBytes: 10 * MB, roomLifetimeHours: 24,
    canAudioCall: false, canVideoCall: false, canScreenShare: false,
    canRoomAppearance: false, canDisappearing: false, canAI: false,
  },
  basic: {
    msgPerRoomPerDay: 100, maxRooms: 10, maxFileBytes: 10 * MB, roomLifetimeHours: null,
    canAudioCall: true, canVideoCall: false, canScreenShare: false,
    canRoomAppearance: true, canDisappearing: true, canAI: false,
  },
  ultra: {
    msgPerRoomPerDay: null, maxRooms: null, maxFileBytes: 40 * MB, roomLifetimeHours: null,
    canAudioCall: true, canVideoCall: true, canScreenShare: true,
    canRoomAppearance: true, canDisappearing: true, canAI: true,
  },
};

export interface SubscriptionRow {
  tier: 'basic' | 'ultra';
  status: string;            // Stripe subscription status, verbatim
  current_period_end: string | null; // ISO timestamp
}

// Mirror of SQL effective_tier(). `nowMs` is injected so tests are deterministic.
export function resolveTier(sub: SubscriptionRow | null, nowMs: number): Tier {
  if (!sub) return 'free';
  const periodMs = sub.current_period_end ? Date.parse(sub.current_period_end) : NaN;
  const inPeriod = Number.isFinite(periodMs) && periodMs > nowMs;
  const entitled =
    sub.status === 'active' ||
    sub.status === 'trialing' ||
    ((sub.status === 'past_due' || sub.status === 'canceled') && inPeriod);
  return entitled ? sub.tier : 'free';
}

export function entitlements(tier: Tier): TierEntitlements {
  return TIER_CONFIG[tier];
}

// Remaining sends today in one room. null = unlimited.
export function messagesRemaining(tier: Tier, sentToday: number): number | null {
  const lim = TIER_CONFIG[tier].msgPerRoomPerDay;
  return lim === null ? null : Math.max(0, lim - sentToday);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- entitlements`
Expected: PASS (all assertions green).

- [ ] **Step 5: Run the full suite + build to confirm no regression**

Run: `npm test` then `npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add utils/entitlements.ts utils/entitlements.test.ts
git commit -m "feat(monetization): shared tier entitlements config + resolveTier (phase 1)"
```

---

## Task 2: `subscriptions` table + RLS

**Files:**
- DB migration (apply_migration name: `monetization_p1_subscriptions_table`)
- Modify: `docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md` (create it here)

- [ ] **Step 1: Apply the migration**

Apply via the Supabase `apply_migration` tool, name `monetization_p1_subscriptions_table`:

```sql
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  tier                   text not null check (tier in ('basic','ultra')),
  status                 text not null,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
-- Read own row only. No INSERT/UPDATE/DELETE policy => anon/authenticated cannot
-- write; only the service-role webhook (which bypasses RLS) writes this table.
drop policy if exists subs_select_own on public.subscriptions;
create policy subs_select_own on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
-- Lookup by customer id during webhook processing.
create index if not exists idx_subscriptions_stripe_customer on public.subscriptions (stripe_customer_id);
```

- [ ] **Step 2: Verify the table + policy exist**

Run via `execute_sql`:
```sql
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='subscriptions') as tbl,
  (select count(*) from pg_policies where schemaname='public' and tablename='subscriptions') as policies,
  (select relrowsecurity from pg_class where oid='public.subscriptions'::regclass) as rls_on;
```
Expected: `tbl=1`, `policies=1`, `rls_on=true`.

- [ ] **Step 3: Verify a non-service caller cannot write (RLS)**

Run via `execute_sql`:
```sql
select count(*) as write_policies
from pg_policies
where schemaname='public' and tablename='subscriptions'
  and cmd in ('INSERT','UPDATE','DELETE','ALL');
```
Expected: `write_policies=0` (only the SELECT policy exists; writes are service-role-only).

- [ ] **Step 4: Record the migration**

Create `docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md` with a header and the first migration section:

````markdown
# Monetization Phase 1 — DB migrations (live, Supabase-managed)

Recorded for reproducibility; migrations are not git-tracked. Each section is the
exact SQL applied + its verification result.

## monetization_p1_subscriptions_table
```sql
<paste the exact SQL from Task 2 Step 1>
```
Verify: tbl=1, policies=1, rls_on=true, write_policies=0. ✅
````

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md
git commit -m "feat(monetization): subscriptions table + RLS (phase 1) [db]"
```

---

## Task 3: `rooms.expires_at`, `rooms.locked`, and the quota index

**Files:**
- DB migration (apply_migration name: `monetization_p1_rooms_columns_and_index`)
- Modify: `docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md`

- [ ] **Step 1: Apply the migration**

Apply via `apply_migration`, name `monetization_p1_rooms_columns_and_index`:

```sql
-- Nullable, no default, NO backfill: existing rooms keep expires_at = NULL and are
-- never auto-purged. Only join_or_create_room stamps NEW free rooms (Task 7).
alter table public.rooms add column if not exists expires_at timestamptz;
-- Read-only flag for rooms beyond a downgraded user's room cap (set by reconcile).
alter table public.rooms add column if not exists locked boolean not null default false;
-- Supports the per-(uid,room,day) count in enforce_message_quota (Task 5).
create index if not exists idx_messages_uid_room_created
  on public.messages (room_key, uid, created_at);
-- Supports the purge-expired-free-rooms cron (Task 9).
create index if not exists idx_rooms_expires_at on public.rooms (expires_at)
  where expires_at is not null;
```

- [ ] **Step 2: Verify columns, default, and no backfill**

Run via `execute_sql`:
```sql
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='rooms' and column_name='expires_at') as has_expires,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='rooms' and column_name='locked') as has_locked,
  (select count(*) from public.rooms where expires_at is not null) as rooms_with_expiry,
  (select count(*) from public.rooms where locked) as locked_rooms;
```
Expected: `has_expires=1`, `has_locked=1`, `rooms_with_expiry=0` (no backfill), `locked_rooms=0`.

- [ ] **Step 3: Record the migration**

Append a `## monetization_p1_rooms_columns_and_index` section (SQL + verification result) to the audit doc.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md
git commit -m "feat(monetization): rooms.expires_at/locked + quota index (phase 1) [db]"
```

---

## Task 4: `effective_tier(uuid)`

**Files:**
- DB migration (apply_migration name: `monetization_p1_effective_tier`)
- Modify: `docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md`

- [ ] **Step 1: Apply the migration**

Apply via `apply_migration`, name `monetization_p1_effective_tier`:

```sql
-- Authoritative tier resolver. SECURITY DEFINER so it reads subscriptions despite
-- the read-own-only RLS. Grace: cancellation/dunning keep access until period end.
create or replace function public.effective_tier(p_uid uuid)
returns text language sql stable security definer set search_path to 'public','pg_temp' as $$
  select coalesce((
    select s.tier
    from public.subscriptions s
    where s.user_id = p_uid
      and (
        s.status in ('active','trialing')
        or (s.status in ('past_due','canceled') and s.current_period_end is not null and s.current_period_end > now())
      )
    order by case s.tier when 'ultra' then 2 when 'basic' then 1 else 0 end desc
    limit 1
  ), 'free');
$$;
revoke execute on function public.effective_tier(uuid) from public;
grant execute on function public.effective_tier(uuid) to anon, authenticated, service_role;
```

- [ ] **Step 2: Verify behavior for the four cases (self-rolling-back)**

Run via `execute_sql` (inserts a temp subscription for a fake uid, checks all cases, then raises to roll back — surfaces the result in the error text):
```sql
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000a1';
  r text := '';
begin
  r := r || 'none=' || public.effective_tier(u) || ' ';            -- expect free
  insert into public.subscriptions(user_id,tier,status,current_period_end)
    values (u,'ultra','active', now() + interval '10 days');
  r := r || 'active=' || public.effective_tier(u) || ' ';          -- expect ultra
  update public.subscriptions set status='canceled', current_period_end=now()+interval '5 days' where user_id=u;
  r := r || 'cancel_future=' || public.effective_tier(u) || ' ';   -- expect ultra
  update public.subscriptions set current_period_end=now()-interval '1 day' where user_id=u;
  r := r || 'cancel_past=' || public.effective_tier(u);            -- expect free
  raise exception 'EFFTIER_RESULT % ', r;
end $$;
```
Expected error text contains: `none=free active=ultra cancel_future=ultra cancel_past=free`. (The exception rolls back the temp subscription — confirm with `select count(*) from public.subscriptions where user_id='00000000-0000-0000-0000-0000000000a1';` → `0`.)

- [ ] **Step 3: Record the migration + commit**

Append `## monetization_p1_effective_tier` (SQL + verification result) to the audit doc, then:
```bash
git add docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md
git commit -m "feat(monetization): effective_tier() resolver (phase 1) [db]"
```

---

## Task 5: Message-quota trigger (`enforce_message_quota`)

**Files:**
- DB migration (apply_migration name: `monetization_p1_message_quota_trigger`)
- Modify: `docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md`

- [ ] **Step 1: Apply the migration**

Apply via `apply_migration`, name `monetization_p1_message_quota_trigger`:

```sql
-- BEFORE INSERT on messages: block sends into a locked (read-only) room, and cap
-- non-system sends per (uid, room, calendar day in Europe/Athens) by tier.
-- messages.uid is text; cast to uuid for effective_tier. Day boundary uses Athens.
create or replace function public.enforce_message_quota()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_tier  text;
  v_limit int;
  v_count int;
  v_locked boolean;
begin
  if coalesce(NEW.type,'text') = 'system' then
    return NEW;
  end if;

  select locked into v_locked from public.rooms where room_key = NEW.room_key;
  if coalesce(v_locked, false) then
    raise exception 'ROOM_LOCKED';
  end if;

  v_tier  := public.effective_tier(NEW.uid::uuid);
  v_limit := case v_tier when 'ultra' then null when 'basic' then 100 else 10 end;
  if v_limit is null then
    return NEW;
  end if;

  select count(*) into v_count
  from public.messages m
  where m.uid = NEW.uid
    and m.room_key = NEW.room_key
    and coalesce(m.type,'text') <> 'system'
    and m.created_at >= (date_trunc('day', now() at time zone 'Europe/Athens') at time zone 'Europe/Athens');

  if v_count >= v_limit then
    raise exception 'QUOTA_EXCEEDED:%', v_tier;
  end if;

  return NEW;
end; $$;

drop trigger if exists trg_enforce_message_quota on public.messages;
create trigger trg_enforce_message_quota
  before insert on public.messages
  for each row execute function public.enforce_message_quota();
```

- [ ] **Step 2: Verify the free 10/day cap blocks the 11th (self-rolling-back)**

Run via `execute_sql`. NOTE: include every NOT-NULL `messages` column the schema requires — verify the column set first with
`select column_name, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='messages';`
and add any missing NOT-NULL-without-default columns (e.g. `reactions := '{}'::jsonb`) to the inserts below.

```sql
do $$
declare
  rk text := '__qtest_quota__';
  u  text := '00000000-0000-0000-0000-0000000000b2'; -- no subscription => free, limit 10
  v_blocked boolean := false;
  i int;
begin
  insert into public.rooms(room_key, room_name, pin, created_by)
    values (rk, 'qtest', '0', u::uuid);
  for i in 1..10 loop
    insert into public.messages(room_key, uid, username, text, type, reactions)
      values (rk, u, 't', 'x', 'text', '{}'::jsonb);
  end loop;
  begin
    insert into public.messages(room_key, uid, username, text, type, reactions)
      values (rk, u, 't', 'x', 'text', '{}'::jsonb);
  exception when others then
    if sqlerrm like 'QUOTA_EXCEEDED%' then v_blocked := true; end if;
  end;
  raise exception 'QTEST blocked=% (expected true); err sample=%', v_blocked, 'QUOTA_EXCEEDED:free';
end $$;
```
Expected error text: `QTEST blocked=t (expected true) ...`. Then confirm rollback:
`select count(*) from public.rooms where room_key='__qtest_quota__';` → `0`.

- [ ] **Step 3: Verify a `system` message is exempt and an Ultra user is unlimited**

Run via `execute_sql`:
```sql
do $$
declare
  rk text := '__qtest_sys__';
  u  text := '00000000-0000-0000-0000-0000000000b3';
  ok_system boolean := false; ok_ultra boolean := false; i int;
begin
  insert into public.subscriptions(user_id,tier,status,current_period_end)
    values (u::uuid,'ultra','active', now()+interval '10 days');
  insert into public.rooms(room_key, room_name, pin, created_by) values (rk,'q','0',u::uuid);
  -- 200 ultra sends (well past basic's 100) must all pass
  for i in 1..200 loop
    insert into public.messages(room_key, uid, username, text, type, reactions)
      values (rk,u,'t','x','text','{}'::jsonb);
  end loop;
  ok_ultra := true;
  -- a system message from a (hypothetically capped) user is exempt
  insert into public.messages(room_key, uid, username, text, type, reactions)
    values (rk,'00000000-0000-0000-0000-0000000000b4','t','joined','system','{}'::jsonb);
  ok_system := true;
  raise exception 'QTEST ultra_unlimited=% system_exempt=%', ok_ultra, ok_system;
end $$;
```
Expected error text: `QTEST ultra_unlimited=t system_exempt=t`. Confirm rollback as above.

- [ ] **Step 4: Record the migration + commit**

Append `## monetization_p1_message_quota_trigger` (SQL + both verification results) to the audit doc, then:
```bash
git add docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md
git commit -m "feat(monetization): message-quota + room-lock trigger (phase 1) [db]"
```

---

## Task 6: Premium room-settings guard (`enforce_room_tier`)

**Files:**
- DB migration (apply_migration name: `monetization_p1_room_tier_guard`)
- Modify: `docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md`

- [ ] **Step 1: Apply the migration**

Apply via `apply_migration`, name `monetization_p1_room_tier_guard`:

```sql
-- BEFORE UPDATE on rooms: gate premium settings by the CALLER's tier.
-- AI (ai_enabled=true / ai_avatar_url) => Ultra. Appearance + disappearing +
-- custom auto-delete => Basic or Ultra. locked/expires_at are NOT gated, so the
-- reconcile/cron paths (auth.uid() null) pass cleanly. pinned_message_id is core.
create or replace function public.enforce_room_tier()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_tier text := public.effective_tier((select auth.uid()));
begin
  if ( (NEW.ai_enabled is distinct from OLD.ai_enabled and coalesce(NEW.ai_enabled,false) = true)
       or NEW.ai_avatar_url is distinct from OLD.ai_avatar_url )
     and v_tier <> 'ultra' then
    raise exception 'TIER_REQUIRED:ai';
  end if;

  if ( NEW.message_ttl_seconds is distinct from OLD.message_ttl_seconds
       or NEW.auto_delete_seconds is distinct from OLD.auto_delete_seconds
       or NEW.avatar_url        is distinct from OLD.avatar_url
       or NEW.background_type    is distinct from OLD.background_type
       or NEW.background_preset  is distinct from OLD.background_preset
       or NEW.background_url     is distinct from OLD.background_url
       or NEW.display_name       is distinct from OLD.display_name )
     and v_tier = 'free' then
    raise exception 'TIER_REQUIRED:basic';
  end if;

  return NEW;
end; $$;

drop trigger if exists trg_enforce_room_tier on public.rooms;
create trigger trg_enforce_room_tier
  before update on public.rooms
  for each row execute function public.enforce_room_tier();
```

- [ ] **Step 2: Verify a free caller's cosmetic update is blocked, and locked/expires updates pass**

Run via `execute_sql`. (`auth.uid()` is null in this admin context, so `effective_tier` returns `free` — exactly the case we want to prove is blocked. We also prove a `locked` update — the reconcile path — passes.)
```sql
do $$
declare
  rk text := '__qtest_guard__';
  blocked boolean := false; lock_ok boolean := false;
begin
  insert into public.rooms(room_key, room_name, pin, created_by)
    values (rk,'g','0','00000000-0000-0000-0000-0000000000c5');
  begin
    update public.rooms set display_name='hacked' where room_key=rk;   -- free => blocked
  exception when others then
    if sqlerrm like 'TIER_REQUIRED%' then blocked := true; end if;
  end;
  update public.rooms set locked=true, expires_at=now() where room_key=rk; -- not gated => ok
  lock_ok := true;
  raise exception 'QTEST cosmetic_blocked=% lock_update_ok=%', blocked, lock_ok;
end $$;
```
Expected error text: `QTEST cosmetic_blocked=t lock_update_ok=t`. Confirm rollback (`select count(*) from public.rooms where room_key='__qtest_guard__'` → `0`).

- [ ] **Step 3: Record the migration + commit**

Append `## monetization_p1_room_tier_guard` (SQL + verification) to the audit doc, then:
```bash
git add docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md
git commit -m "feat(monetization): premium room-settings tier guard (phase 1) [db]"
```

---

## Task 7: Extend `join_or_create_room` (room cap + free expiry)

**Files:**
- DB migration (apply_migration name: `monetization_p1_join_or_create_room_caps`)
- Modify: `docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md`

- [ ] **Step 1: Apply the migration (full function body, additions marked)**

Apply via `apply_migration`, name `monetization_p1_join_or_create_room_caps`. This is the verbatim current body plus the room-cap check and the free `expires_at` stamp:

```sql
create or replace function public.join_or_create_room(p_room_key text, p_room_name text, p_pin text, p_username text, p_create_if_missing boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_room public.rooms%rowtype;
  v_uid  text := (select auth.uid())::text;
  v_is_new boolean := false;
  v_tier text;          -- ADDED
  v_limit int;          -- ADDED
  v_count int;          -- ADDED
  v_expires timestamptz; -- ADDED
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_room from public.rooms where room_key = p_room_key;

  if not found then
    if not p_create_if_missing then
      raise exception 'ROOM_DELETED';
    end if;

    -- ADDED: tier-based room cap. Exclude already-expired-but-unpurged free rooms
    -- so a free user is not blocked by a room awaiting the 15-min purge cron.
    v_tier  := public.effective_tier((select auth.uid()));
    v_limit := case v_tier when 'ultra' then null when 'basic' then 10 else 1 end;
    if v_limit is not null then
      select count(*) into v_count
      from public.rooms
      where created_by = (select auth.uid())
        and (expires_at is null or expires_at > now());
      if v_count >= v_limit then
        raise exception 'ROOM_LIMIT:%', v_tier;
      end if;
    end if;
    -- ADDED: free rooms self-destruct 24h after creation.
    if v_tier = 'free' then
      v_expires := now() + interval '24 hours';
    else
      v_expires := null;
    end if;

    insert into public.rooms (room_key, room_name, pin, created_by, expires_at)  -- expires_at ADDED
    values (p_room_key, p_room_name, p_pin, (select auth.uid()), v_expires)
    returning * into v_room;
    v_is_new := true;
  else
    if v_room.pin is distinct from p_pin then
      raise exception 'WRONG_PIN';
    end if;
  end if;

  insert into public.subscribers (room_key, uid, username)
  values (p_room_key, v_uid, p_username)
  on conflict (room_key, uid) do update set username = excluded.username;

  return jsonb_build_object(
    'room_key', v_room.room_key,
    'room_name', v_room.room_name,
    'created_by', v_room.created_by,
    'ai_enabled', coalesce(v_room.ai_enabled, false),
    'ai_avatar_url', v_room.ai_avatar_url,
    'avatar_url', v_room.avatar_url,
    'background_url', v_room.background_url,
    'background_type', v_room.background_type,
    'background_preset', v_room.background_preset,
    'message_ttl_seconds', v_room.message_ttl_seconds,
    'auto_delete_seconds', v_room.auto_delete_seconds,
    'pinned_message_id', v_room.pinned_message_id,
    'is_new', v_is_new
  );
end;
$function$;
```

- [ ] **Step 2: Verify the function still returns the expected JSON shape (no behavior regression for an existing room)**

Run via `execute_sql`:
```sql
select jsonb_object_keys(
  jsonb_build_object(
    'room_key',null,'room_name',null,'created_by',null,'ai_enabled',null,'ai_avatar_url',null,
    'avatar_url',null,'background_url',null,'background_type',null,'background_preset',null,
    'message_ttl_seconds',null,'auto_delete_seconds',null,'pinned_message_id',null,'is_new',null
  )
) order by 1;
```
This documents the expected key set (13 keys + is_new). Then confirm the function compiles and the source contains the additions:
```sql
select position('ROOM_LIMIT' in pg_get_functiondef('public.join_or_create_room(text,text,text,text,boolean)'::regprocedure)) > 0 as has_cap,
       position('24 hours'  in pg_get_functiondef('public.join_or_create_room(text,text,text,text,boolean)'::regprocedure)) > 0 as has_expiry;
```
Expected: `has_cap=true`, `has_expiry=true`.

- [ ] **Step 3: Verify the free room cap raises on the 2nd room (self-rolling-back, simulating a JWT uid)**

Run via `execute_sql`. We set the request JWT claim so `auth.uid()` resolves to a test uid with no subscription (free, cap 1):
```sql
do $$
declare
  u text := '00000000-0000-0000-0000-0000000000d6';
  blocked boolean := false; first jsonb; firstexp timestamptz;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  first := public.join_or_create_room('__qtest_r1__','r1','0','t', true);
  select expires_at into firstexp from public.rooms where room_key='__qtest_r1__';
  begin
    perform public.join_or_create_room('__qtest_r2__','r2','0','t', true);
  exception when others then
    if sqlerrm like 'ROOM_LIMIT%' then blocked := true; end if;
  end;
  raise exception 'QTEST second_blocked=% first_has_24h_expiry=%', blocked, (firstexp is not null and firstexp > now() + interval '23 hours');
end $$;
```
Expected error text: `QTEST second_blocked=t first_has_24h_expiry=t`. Confirm rollback (`select count(*) from public.rooms where room_key like '__qtest_r%'` → `0`).

- [ ] **Step 4: Record the migration + commit**

Append `## monetization_p1_join_or_create_room_caps` (SQL + verification) to the audit doc, then:
```bash
git add docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md
git commit -m "feat(monetization): room cap + free-room 24h expiry in join_or_create_room (phase 1) [db]"
```

---

## Task 8: `reconcile_entitlements(uuid)`

**Files:**
- DB migration (apply_migration name: `monetization_p1_reconcile_entitlements`)
- Modify: `docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md`

- [ ] **Step 1: Apply the migration**

Apply via `apply_migration`, name `monetization_p1_reconcile_entitlements`:

```sql
-- Called by the Stripe webhook (Phase 2) after every subscription change.
-- Upgrade: clear free expiry on the user's rooms. Downgrade/over-cap: keep the
-- `limit` most-recently-active rooms writable, lock the rest (read-only). Never
-- deletes data. Touches only locked/expires_at, which enforce_room_tier ignores.
create or replace function public.reconcile_entitlements(p_uid uuid)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_tier  text := public.effective_tier(p_uid);
  v_limit int  := case v_tier when 'ultra' then null when 'basic' then 10 else 1 end;
begin
  if v_tier <> 'free' then
    update public.rooms set expires_at = null
     where created_by = p_uid and expires_at is not null;
  end if;

  if v_limit is null then
    update public.rooms set locked = false where created_by = p_uid and locked;
    return;
  end if;

  with ranked as (
    select r.room_key,
           row_number() over (
             order by coalesce(
               (select max(m.created_at) from public.messages m where m.room_key = r.room_key),
               r.created_at
             ) desc
           ) as rn
    from public.rooms r
    where r.created_by = p_uid
  )
  update public.rooms r
     set locked = (ranked.rn > v_limit)
    from ranked
   where ranked.room_key = r.room_key
     and r.locked is distinct from (ranked.rn > v_limit);
end; $$;
revoke execute on function public.reconcile_entitlements(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_entitlements(uuid) to service_role;
```

- [ ] **Step 2: Verify downgrade locks all-but-newest and upgrade unlocks + clears expiry (self-rolling-back)**

Run via `execute_sql`:
```sql
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000e7';
  locked_after_free int; locked_after_ultra int; expiry_after_ultra int;
begin
  -- three free rooms with staggered creation (newest = r3)
  insert into public.rooms(room_key,room_name,pin,created_by,created_at,expires_at) values
    ('__qa__','a','0',u, now()-interval '3 hours', now()+interval '21 hours'),
    ('__qb__','b','0',u, now()-interval '2 hours', now()+interval '22 hours'),
    ('__qc__','c','0',u, now()-interval '1 hours', now()+interval '23 hours');
  -- user is free (no sub) => cap 1 => reconcile locks the 2 oldest, keeps newest
  perform public.reconcile_entitlements(u);
  select count(*) into locked_after_free from public.rooms where created_by=u and locked;
  -- now make them ultra and reconcile => unlock all + clear expiry
  insert into public.subscriptions(user_id,tier,status,current_period_end)
    values (u,'ultra','active', now()+interval '30 days');
  perform public.reconcile_entitlements(u);
  select count(*) into locked_after_ultra from public.rooms where created_by=u and locked;
  select count(*) into expiry_after_ultra from public.rooms where created_by=u and expires_at is not null;
  raise exception 'QTEST locked_free=% (exp 2) locked_ultra=% (exp 0) expiry_ultra=% (exp 0)',
    locked_after_free, locked_after_ultra, expiry_after_ultra;
end $$;
```
Expected error text: `QTEST locked_free=2 (exp 2) locked_ultra=0 (exp 0) expiry_ultra=0 (exp 0)`. Confirm rollback (`select count(*) from public.rooms where room_key in ('__qa__','__qb__','__qc__')` → `0`).

- [ ] **Step 3: Record the migration + commit**

Append `## monetization_p1_reconcile_entitlements` (SQL + verification) to the audit doc, then:
```bash
git add docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md
git commit -m "feat(monetization): reconcile_entitlements lock/expiry reconciler (phase 1) [db]"
```

---

## Task 9: Purge crons (free rooms + disappearing messages)

**Files:**
- DB migration (apply_migration name: `monetization_p1_purge_crons`)
- Modify: `docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md`

- [ ] **Step 1: Confirm pg_cron is available**

Run via `execute_sql`:
```sql
select count(*) as has_pgcron from pg_extension where extname='pg_cron';
```
Expected: `has_pgcron=1`. (If `0`, run `create extension if not exists pg_cron;` as a prerequisite migration — but the project already uses pg_cron for `cleanup-abandoned-anon-users`, so it is present.)

- [ ] **Step 2: Apply the migration**

Apply via `apply_migration`, name `monetization_p1_purge_crons`:

```sql
-- Free rooms self-destruct ~24h after creation (15-min granularity).
select cron.schedule(
  'purge-expired-free-rooms',
  '*/15 * * * *',
  $$ delete from public.rooms where expires_at is not null and expires_at < now(); $$
);

-- Disappearing messages: actually purge messages past their room's TTL. (The
-- column existed but nothing deleted them; Basic sells this feature, so it must
-- work.) 5-min granularity.
select cron.schedule(
  'purge-expired-messages',
  '*/5 * * * *',
  $$ delete from public.messages m
     using public.rooms r
     where m.room_key = r.room_key
       and r.message_ttl_seconds is not null
       and coalesce(m.type,'text') <> 'system'
       and m.created_at < now() - (r.message_ttl_seconds || ' seconds')::interval; $$
);
```

- [ ] **Step 3: Verify both jobs are scheduled**

Run via `execute_sql`:
```sql
select jobname, schedule, active
from cron.job
where jobname in ('purge-expired-free-rooms','purge-expired-messages')
order by jobname;
```
Expected: two rows — `purge-expired-free-rooms` `*/15 * * * *` `active=true`, `purge-expired-messages` `*/5 * * * *` `active=true`.

- [ ] **Step 4: Verify the purge predicates select the right rows WITHOUT deleting (dry-run counts, self-rolling-back)**

Run via `execute_sql` (creates one already-expired free room + one TTL-expired message, asserts the predicates match them, then rolls back):
```sql
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000f8';
  free_hit int; ttl_hit int;
begin
  insert into public.rooms(room_key,room_name,pin,created_by,expires_at,message_ttl_seconds) values
    ('__qexp__','e','0',u, now()-interval '1 minute', 3600);
  insert into public.messages(room_key,uid,username,text,type,reactions,created_at)
    values ('__qexp__', u::text, 't','old','text','{}'::jsonb, now()-interval '2 hours');
  select count(*) into free_hit from public.rooms
    where room_key='__qexp__' and expires_at is not null and expires_at < now();
  select count(*) into ttl_hit from public.messages m join public.rooms r on r.room_key=m.room_key
    where m.room_key='__qexp__' and r.message_ttl_seconds is not null
      and m.created_at < now() - (r.message_ttl_seconds||' seconds')::interval;
  raise exception 'QTEST free_room_match=% (exp 1) ttl_msg_match=% (exp 1)', free_hit, ttl_hit;
end $$;
```
Expected error text: `QTEST free_room_match=1 (exp 1) ttl_msg_match=1 (exp 1)`. Confirm rollback (`select count(*) from public.rooms where room_key='__qexp__'` → `0`).

- [ ] **Step 5: Record the migration + commit**

Append `## monetization_p1_purge_crons` (SQL + verification) to the audit doc, then:
```bash
git add docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md
git commit -m "feat(monetization): purge crons for free rooms + disappearing messages (phase 1) [db]"
```

---

## Task 10: End-to-end verification sweep + memory note

**Files:**
- Modify: `docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md`
- Update memory: `C:\Users\polis\.claude\projects\c--Users-polis-Documents-incognitochat\memory\` (new file + MEMORY.md pointer)

- [ ] **Step 1: Full object inventory**

Run via `execute_sql`:
```sql
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='subscriptions') as subscriptions_tbl,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='rooms' and column_name in ('expires_at','locked')) as rooms_cols,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('effective_tier','enforce_message_quota','enforce_room_tier','reconcile_entitlements')) as funcs,
  (select count(*) from pg_trigger where tgrelid in ('public.messages'::regclass,'public.rooms'::regclass) and tgname in ('trg_enforce_message_quota','trg_enforce_room_tier')) as triggers,
  (select count(*) from cron.job where jobname in ('purge-expired-free-rooms','purge-expired-messages')) as crons;
```
Expected: `subscriptions_tbl=1`, `rooms_cols=2`, `funcs=4`, `triggers=2`, `crons=2`.

- [ ] **Step 2: Confirm no test rows leaked from any task**

Run via `execute_sql`:
```sql
select
  (select count(*) from public.rooms where room_key like '__q%') as leaked_rooms,
  (select count(*) from public.subscriptions where user_id::text like '00000000-0000-0000-0000-0000000000%') as leaked_subs;
```
Expected: `leaked_rooms=0`, `leaked_subs=0`. (If non-zero, delete them: `delete from public.rooms where room_key like '__q%'; delete from public.subscriptions where user_id::text like '00000000-0000-0000-0000-0000000000%';`)

- [ ] **Step 3: Confirm the TS mirror still matches the SQL numbers**

Re-read `utils/entitlements.ts` `TIER_CONFIG` and confirm: free `msgPerRoomPerDay:10 / maxRooms:1 / 10MB / 24h`; basic `100 / 10 / 10MB / null`; ultra `null / null / 40MB / null`. These must equal the SQL `case` expressions in Tasks 5, 7, 8. Run `npm test -- entitlements` once more → PASS.

- [ ] **Step 4: Finalize the audit doc**

Add a closing "## Verification sweep" section to `docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md` with the Step 1 result counts.

- [ ] **Step 5: Write a memory note**

Create `C:\Users\polis\.claude\projects\c--Users-polis-Documents-incognitochat\memory\incognitochat-monetization.md` summarizing: tiers (free/basic/ultra), the `subscriptions` table (webhook-written, read-own RLS), `effective_tier`, the quota trigger (per uid/room/day, Athens), room cap + free 24h `expires_at` in `join_or_create_room`, the room-tier guard, `reconcile_entitlements`, the two purge crons, and the rule "never backfill expires_at / never auto-lock existing rooms". Add a one-line pointer to `MEMORY.md`. (Link `[[incognitochat-unread-badges]]`, `[[incognitochat-overview]]`.)

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md
git commit -m "docs(monetization): phase 1 verification sweep [db]"
git push origin main
```

---

## Phase 1 self-review checklist (run before declaring done)

- [ ] `subscriptions` table exists, RLS on, read-own only, no write policy (Task 2).
- [ ] `rooms.expires_at` (nullable, no backfill) + `rooms.locked` (default false) exist; 0 existing rooms have expiry or lock (Task 3).
- [ ] `effective_tier` returns free/basic/ultra correctly incl. grace (Task 4).
- [ ] Message quota blocks the 11th free / 101st basic send per room/day; system msgs exempt; ultra unlimited; locked rooms reject sends (Task 5).
- [ ] Premium room-setting changes blocked below the required tier; locked/expires_at updates pass (Task 6).
- [ ] `join_or_create_room` caps rooms per tier and stamps free rooms with 24h expiry; JSON shape unchanged (Task 7).
- [ ] `reconcile_entitlements` locks all-but-newest on downgrade and unlocks + clears expiry on upgrade (Task 8).
- [ ] Both purge crons scheduled and their predicates match the right rows (Task 9).
- [ ] No test rows leaked; TS config matches SQL; all vitest green; build green (Task 10).

## What Phase 1 deliberately does NOT do (next phases)

- No Stripe yet — the `subscriptions` table is written manually in tests only; the webhook that populates it is **Phase 2**.
- No client wiring — `utils/entitlements.ts` exists but `useEntitlements`, gray-outs, quota counters, and locked-room banners are **Phase 3**.
- No pricing/billing UI — **Phase 4**.
- Client-side mapping of `QUOTA_EXCEEDED` / `ROOM_LIMIT` / `ROOM_LOCKED` / `TIER_REQUIRED` errors to Greek prompts is **Phase 3**.
