# Host Tier Inheritance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members of a room whose creator is a paid tier inherit the host's tier for two capabilities only — daily message quota (server-enforced) and calls (client-gated).

**Architecture:** Define `roomTier = MAX(member_tier, host_tier)` by tier rank and apply it in exactly two places: the `enforce_message_quota` trigger (server, authoritative) and the `CallManager` entitlements + message-quota UI (client). Every other gate keeps using the member's own `effective_tier`, preserving the exclusions. The host tier is resolved server-side (`effective_tier(rooms.created_by)`) and surfaced to the client via the `join_or_create_room` payload.

**Tech Stack:** Supabase Postgres (plpgsql SECURITY DEFINER functions, triggers), React 18 + TypeScript, Vite, vitest, Playwright (prod-preview verification), supabase MCP (`apply_migration`, `execute_sql`).

## Global Constraints

- LIVE production project id: `qygirixqsuraclbdfnjp`. SQL goes straight to prod via `apply_migration`; verify on a throwaway room then clean it up.
- Tier limits stay EXACTLY: free=10, basic=100, ultra=∞ (null) messages/room/day. This feature changes WHICH tier is chosen, never the numbers.
- All modified SQL functions stay `SECURITY DEFINER` with `SET search_path TO 'public', 'pg_temp'`. `rooms.created_by` is server-set — the inherited tier cannot be forged by a client.
- Do NOT change: `enforce_room_tier`, room-creation limits, room expiry, the bot (`00000000-0000-0000-0000-000000000000`) and `system`-message early-returns in the quota trigger.
- Exclusions that MUST remain on the member's OWN tier: uploads (`maxFileBytes`, `canMultiUpload`), room-settings editing (`canRoomAppearance`, `canDisappearing`, `canAI`, `canClearMessages`, `canEmailAlerts`), `maxRooms`.
- `Tier` type = `'free' | 'basic' | 'ultra'` (from `utils/entitlements.ts`).
- Commit messages end with the repo's `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

### Task 1: Server — `tier_rank` helper, quota inheritance, join payload

**Files:**
- Migrate (via `apply_migration`, name `host_tier_inheritance`): `public.tier_rank`, `public.enforce_message_quota`, `public.join_or_create_room`.

**Interfaces:**
- Produces (SQL): `public.tier_rank(text) → int`; `join_or_create_room(...)` JSONB now includes `creator_tier` (text: `'free'|'basic'|'ultra'`).
- Consumes: existing `public.effective_tier(uuid) → text` (unchanged), `rooms.created_by uuid`.

- [ ] **Step 1: Apply the migration**

Use the `apply_migration` MCP tool, project `qygirixqsuraclbdfnjp`, name `host_tier_inheritance`, with this exact SQL (three `CREATE OR REPLACE`s):

```sql
-- 1) Tier ranking helper for taking the higher of two tiers.
CREATE OR REPLACE FUNCTION public.tier_rank(t text)
 RETURNS int
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$ select case t when 'ultra' then 2 when 'basic' then 1 else 0 end $function$;

-- 2) Message quota: effective tier = MAX(sender tier, room creator tier).
CREATE OR REPLACE FUNCTION public.enforce_message_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tier         text;
  v_sender_tier  text;
  v_creator_tier text;
  v_created_by   uuid;
  v_limit int;
  v_count int;
  v_locked boolean;
begin
  if coalesce(NEW.type,'text') = 'system' then
    return NEW;
  end if;

  select locked, created_by into v_locked, v_created_by
  from public.rooms where room_key = NEW.room_key;
  if coalesce(v_locked, false) then
    raise exception 'ROOM_LOCKED' using errcode = 'QT001';
  end if;

  -- The inco assistant (fixed all-zero uid) is infrastructure, never quota'd.
  if NEW.uid = '00000000-0000-0000-0000-000000000000' then
    return NEW;
  end if;

  -- Host-tier inheritance: the effective quota tier is the HIGHER of the
  -- sender's own tier and the room creator's tier, so members of a paid host's
  -- room inherit the host's allowance. v_created_by NULL -> effective_tier
  -- returns 'free' (coalesce), so roomTier degrades to the sender's own tier.
  v_sender_tier  := public.effective_tier(NEW.uid::uuid);
  v_creator_tier := public.effective_tier(v_created_by);
  v_tier := case when public.tier_rank(v_creator_tier) > public.tier_rank(v_sender_tier)
                 then v_creator_tier else v_sender_tier end;

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
    raise exception 'QUOTA_EXCEEDED:%', v_tier using errcode = 'QT002';
  end if;

  return NEW;
end; $function$;

-- 3) join_or_create_room: add creator_tier to the success payload (verbatim copy
--    of the current function with ONE added key in the final jsonb_build_object).
CREATE OR REPLACE FUNCTION public.join_or_create_room(p_room_key text, p_room_name text, p_pin text, p_username text, p_create_if_missing boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_room public.rooms%rowtype;
  v_uid  text := (select auth.uid())::text;
  v_is_new boolean := false;
  v_tier text;
  v_limit int;
  v_count int;
  v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_room from public.rooms where room_key = p_room_key;

  if not found then
    if not p_create_if_missing then
      raise exception 'ROOM_DELETED';
    end if;

    v_tier  := public.effective_tier((select auth.uid()));
    v_limit := case v_tier when 'ultra' then null when 'basic' then 10 else 1 end;
    if v_limit is not null then
      select count(*) into v_count
      from public.rooms
      where created_by = (select auth.uid())
        and (expires_at is null or expires_at > now())
        and is_notes = false;
      if v_count >= v_limit then
        raise exception 'ROOM_LIMIT:%', v_tier using errcode = 'QT003';
      end if;
    end if;
    if v_tier = 'free' then
      v_expires := now() + interval '24 hours';
    else
      v_expires := null;
    end if;

    insert into public.rooms (room_key, room_name, pin, created_by, expires_at)
    values (p_room_key, p_room_name, p_pin, (select auth.uid()), v_expires)
    returning * into v_room;
    v_is_new := true;
  else
    if v_room.pin is distinct from p_pin then
      raise exception 'WRONG_PIN';
    end if;

    if coalesce(v_room.approval_required, false)
       and v_room.created_by is distinct from (select auth.uid())
       and not exists (
         select 1 from public.subscribers s
         where s.room_key = p_room_key and s.uid = v_uid
       )
    then
      insert into public.room_access_requests (room_key, uid, username)
      values (p_room_key, v_uid, p_username)
      on conflict (room_key, uid)
        do update set username = excluded.username, requested_at = timezone('utc', now());
      return jsonb_build_object('pending', true, 'room_name', v_room.room_name);
    end if;
  end if;

  insert into public.subscribers (room_key, uid, username)
  values (p_room_key, v_uid, p_username)
  on conflict (room_key, uid) do update set username = excluded.username;

  return jsonb_build_object(
    'room_key', v_room.room_key,
    'room_name', v_room.room_name,
    'created_by', v_room.created_by,
    'creator_tier', public.effective_tier(v_room.created_by),
    'ai_enabled', coalesce(v_room.ai_enabled, false),
    'ai_avatar_url', v_room.ai_avatar_url,
    'avatar_url', v_room.avatar_url,
    'background_url', v_room.background_url,
    'background_type', v_room.background_type,
    'background_preset', v_room.background_preset,
    'message_ttl_seconds', v_room.message_ttl_seconds,
    'auto_delete_seconds', v_room.auto_delete_seconds,
    'pinned_message_id', v_room.pinned_message_id,
    'approval_required', coalesce(v_room.approval_required, false),
    'is_notes', coalesce(v_room.is_notes, false),
    'is_new', v_is_new
  );
end;
$function$;
```

- [ ] **Step 2: Verify the helper + recompiled definitions (deterministic)**

Run via `execute_sql`:

```sql
select public.tier_rank('ultra') as u, public.tier_rank('basic') as b, public.tier_rank('free') as f;
select pg_get_functiondef('public.enforce_message_quota'::regprocedure) like '%created_by%'
   and pg_get_functiondef('public.enforce_message_quota'::regprocedure) like '%tier_rank%' as quota_ok,
       pg_get_functiondef('public.join_or_create_room'::regprocedure) like '%creator_tier%' as join_ok;
```
Expected: `u=2, b=1, f=0`; `quota_ok=true, join_ok=true`.

- [ ] **Step 3: Behavioral test — free sender inherits an Ultra host's unlimited quota**

Precondition: confirm the chosen host account has no real subscription (so cleanup is a clean delete). Run:
```sql
select id, (select tier from public.subscriptions s where s.user_id = u.id) as existing_tier
from auth.users u where u.email = 'konskall@gmail.com';
```
If `existing_tier` is non-null, STOP and pick a different throwaway host account (do not clobber a real subscription). Otherwise continue.

```sql
-- Temp-grant Ultra to the host, create a throwaway room owned by the host.
insert into public.subscriptions (user_id, tier, status, current_period_end, cancel_at_period_end)
values ((select id from auth.users where email='konskall@gmail.com'), 'ultra', 'active', now() + interval '1 hour', false)
on conflict (user_id) do update set tier='ultra', status='active', current_period_end=excluded.current_period_end, cancel_at_period_end=false;

insert into public.rooms (room_key, room_name, pin, created_by, expires_at)
values ('tierinh_verify', 'tierinh', '0000', (select id from auth.users where email='konskall@gmail.com'), null);

-- Insert 12 messages as a FREE sender (random uuid, no subscription). All succeed
-- because the host is Ultra (quota = unlimited).
do $$
declare i int; v_uid text := gen_random_uuid()::text;
begin
  for i in 1..12 loop
    insert into public.messages (room_key, uid, username, text) values ('tierinh_verify', v_uid, 'FreeSender', 'm'||i);
  end loop;
end $$;
select count(*) as inserted_ultra from public.messages where room_key='tierinh_verify';
```
Expected: `inserted_ultra = 12` (no exception).

- [ ] **Step 4: Behavioral test — same room with a FREE host blocks at 10**

```sql
-- Drop the temp Ultra grant: host is now free.
delete from public.subscriptions where user_id = (select id from auth.users where email='konskall@gmail.com');

-- New free sender, no messages today: the 11th insert must fail QUOTA_EXCEEDED:free.
do $$
declare i int; v_uid text := gen_random_uuid()::text;
begin
  for i in 1..11 loop
    insert into public.messages (room_key, uid, username, text) values ('tierinh_verify', v_uid, 'FreeSender2', 'x'||i);
  end loop;
end $$;
```
Expected: ERROR `QUOTA_EXCEEDED:free` (raised on the 11th). The `do` block aborts — that IS the pass condition.

- [ ] **Step 5: Cleanup**

```sql
delete from public.rooms where room_key = 'tierinh_verify';           -- cascades messages
delete from public.subscriptions where user_id = (select id from auth.users where email='konskall@gmail.com'); -- no-op if already gone
```
Confirm: `select count(*) from public.rooms where room_key='tierinh_verify';` → 0. The host account is back to no-subscription (its original state).

- [ ] **Step 6: Commit** (documentation only — SQL lives in the DB; record the migration name)

```bash
git commit --allow-empty -m "feat(db): host-tier inheritance for message quota (migration host_tier_inheritance)"
```

---

### Task 2: Client foundation — `maxTier` helper + `JoinRoomResult.creator_tier`

**Files:**
- Modify: `utils/entitlements.ts` (append `maxTier` after `messagesRemaining`)
- Test: `utils/entitlements.test.ts`
- Modify: `services/supabase.ts` (add `creator_tier` to `JoinRoomResult`, import `Tier`)

**Interfaces:**
- Produces: `maxTier(a: Tier, b: Tier): Tier`; `JoinRoomResult.creator_tier: Tier`.
- Consumes: `Tier` from `utils/entitlements.ts`.

- [ ] **Step 1: Write the failing test**

Append to `utils/entitlements.test.ts` (add `maxTier` to the existing `./entitlements` import line):

```ts
describe('maxTier (host-tier inheritance)', () => {
  it('returns the higher-ranked tier (free < basic < ultra)', () => {
    expect(maxTier('free', 'ultra')).toBe('ultra');
    expect(maxTier('ultra', 'free')).toBe('ultra');
    expect(maxTier('free', 'basic')).toBe('basic');
    expect(maxTier('basic', 'free')).toBe('basic');
    expect(maxTier('basic', 'ultra')).toBe('ultra');
    expect(maxTier('free', 'free')).toBe('free');
    expect(maxTier('ultra', 'ultra')).toBe('ultra');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run utils/entitlements.test.ts`
Expected: FAIL — `maxTier is not a function` / import error.

- [ ] **Step 3: Implement `maxTier`**

Append to `utils/entitlements.ts` (after `messagesRemaining`):

```ts
// Higher of two tiers by rank (free < basic < ultra). Used for in-room host
// tier inheritance (message quota + calls) — see the host-tier-inheritance spec.
export function maxTier(a: Tier, b: Tier): Tier {
  const rank: Record<Tier, number> = { free: 0, basic: 1, ultra: 2 };
  return rank[a] >= rank[b] ? a : b;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run utils/entitlements.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `creator_tier` to `JoinRoomResult`**

In `services/supabase.ts`: add the import near the top (after the existing imports):
```ts
import type { Tier } from '../utils/entitlements';
```
And add the field to the `JoinRoomResult` interface (after `created_by: string;`):
```ts
  creator_tier: Tier; // effective_tier(created_by) — for in-room host tier inheritance
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean). `data as JoinRoomResult` in `joinOrCreateRoom` now carries `creator_tier`.

- [ ] **Step 7: Commit**

```bash
git add utils/entitlements.ts utils/entitlements.test.ts services/supabase.ts
git commit -m "feat(entitlements): maxTier helper + creator_tier on JoinRoomResult"
```

---

### Task 3: Client wiring — `roomTier` into ChatScreen (quota + nudge + calls)

**Files:**
- Modify: `components/ChatScreen.tsx` (import line ~33; state after ~165; `useMessageQuota` at ~182; nudge gate at ~192; join effect at ~836; `CallManager` `ent` prop at ~1973)
- Verify: `components/CallManager.tsx` (read-only — confirm `ent` is used ONLY for call flags)

**Interfaces:**
- Consumes: `maxTier`, `entitlements` from `utils/entitlements.ts`; `Tier`; `JoinRoomResult.creator_tier`.

- [ ] **Step 1: Confirm CallManager uses `ent` only for calls**

Run: `rg "ent[?.]" components/CallManager.tsx`
Expected: every usage is one of `canAudioCall` / `canVideoCall` / `canScreenShare` (plus `entLoading`). If `ent` gates anything else, STOP and report — elevating it would leak an excluded feature.

- [ ] **Step 2: Extend the entitlements import**

In `components/ChatScreen.tsx`, change the existing import (line ~33):
```ts
import { canSendBatch } from '../utils/entitlements';
```
to:
```ts
import { canSendBatch, maxTier, entitlements, type Tier } from '../utils/entitlements';
```

- [ ] **Step 3: Add `roomCreatorTier` state + `roomTier` derivation**

In `components/ChatScreen.tsx`, immediately AFTER `const { tier, ent, loading: entLoading } = useEntitlements(user?.uid);` (line ~165), add:
```ts
  // Host-tier inheritance: the room creator's tier, resolved server-side and
  // returned by join_or_create_room. The in-room effective tier is the higher of
  // the member's own tier and the host's — applied ONLY to message quota + calls
  // (uploads / room-settings / maxRooms stay on the member's own `tier`/`ent`).
  const [roomCreatorTier, setRoomCreatorTier] = useState<Tier>('free');
  const roomTier = maxTier(tier, roomCreatorTier);
```

- [ ] **Step 4: Feed `roomTier` into the message-quota hook + nudge gate**

In `components/ChatScreen.tsx`:
- Change (line ~182) `const quotaLeft = useMessageQuota(config.roomKey, tier, quotaBump);`
  to `const quotaLeft = useMessageQuota(config.roomKey, roomTier, quotaBump);`
- Change the nudge guard (line ~192) `if (entLoading || tier !== 'free' || quotaLeft === null) return;`
  to `if (entLoading || roomTier !== 'free' || quotaLeft === null) return;`

- [ ] **Step 5: Set `roomCreatorTier` from the join payload**

In `components/ChatScreen.tsx`, in the join effect where `setRoomCreatorId(room.created_by);` runs (line ~836), add immediately after it:
```ts
        setRoomCreatorTier(room.creator_tier ?? 'free');
```

- [ ] **Step 6: Pass the room-tier entitlements to CallManager**

In `components/ChatScreen.tsx`, change the `CallManager` prop (line ~1973) `ent={ent}` to:
```ts
              ent={entitlements(roomTier)}
```
(Leave every other `ent={ent}` / `ent.can...` usage in the file untouched — uploads and RoomInfoModal settings stay on the member's own tier.)

- [ ] **Step 7: Typecheck, tests, build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc clean; all tests pass; build succeeds.

- [ ] **Step 8: Playwright verification (prod-preview) — calls unlock + exclusions hold**

Setup (via `execute_sql`, only if `konskall@gmail.com` has no real subscription — same guard as Task 1 Step 3):
```sql
insert into public.subscriptions (user_id, tier, status, current_period_end, cancel_at_period_end)
values ((select id from auth.users where email='konskall@gmail.com'), 'ultra', 'active', now() + interval '2 hours', false)
on conflict (user_id) do update set tier='ultra', status='active', current_period_end=excluded.current_period_end, cancel_at_period_end=false;
insert into public.rooms (room_key, room_name, pin, created_by, expires_at)
values ('tierinh_pw', 'tierinh', '4321', (select id from auth.users where email='konskall@gmail.com'), null);
```
Then: `npm run build` and `npx vite preview --port 4180` (background). In Playwright:
1. Navigate to `http://localhost:4180/incognitochat/`, open the login form, join room `tierinh_pw` / PIN `4321` as a fresh anon user "Guest" (this user is FREE; the host is Ultra).
2. Assert the join resolved host inheritance: via `browser_evaluate`, confirm the message-quota nudge/counter is absent (a free member in an Ultra room → `roomTier==='ultra'` → no counter). Concretely, the composer shows no "N messages left today" pill.
3. Assert calls unlocked: open the call/participants UI (resolve the button via `browser_snapshot`) and confirm the audio + video call actions are enabled (no upgrade-lock affordance / tapping does not open the UpgradeModal). Screenshot for the record.
4. Assert exclusions hold (own tier still gates): the attachment file input has NO `multiple` attribute (`document.querySelector('input[type=file]').multiple === false`), and opening Room settings shows Room-appearance still locked (upgrade affordance present).
5. Report pass/fail per assertion; screenshot the call UI.

Cleanup (via `execute_sql`) + stop preview:
```sql
delete from public.rooms where room_key = 'tierinh_pw';
delete from public.subscriptions where user_id = (select id from auth.users where email='konskall@gmail.com');
```
Delete any screenshot written to the repo root before committing.

- [ ] **Step 9: Commit**

```bash
git add components/ChatScreen.tsx
git commit -m "feat(chat): inherit host tier for message quota + calls in-room"
```

---

## Notes for the executor
- Tasks are ordered: Task 1 (server) is independent and can ship first; Task 2 is pure client foundation; Task 3 depends on Task 2's `maxTier` + `creator_tier`.
- The server (Task 1) is the security boundary and is authoritative regardless of the client. The client changes (Task 3) are UX unlocks only.
- If `konskall@gmail.com` carries a real subscription, substitute a throwaway host account in Tasks 1 & 3 rather than clobbering it.
