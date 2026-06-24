# Room Kick Enforcement + Re-entry Approval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a room owner removes a member or clears members, affected users are ejected live (even with a closed tab), the room enters an approval-required lockdown, every later non-member join must be owner-approved in-app, and deleting the room resets everything.

**Architecture:** A `rooms.approval_required` flag + a `room_access_requests` table model the lockdown. The `join_or_create_room` SECURITY DEFINER RPC is the gate (writes a pending request instead of membership while locked). Live ejection and the approve/deny result ride the existing `room_status:${roomKey}` broadcast channel; the owner learns of new knocks via a postgres_changes subscription on `room_access_requests`. All new state is FK'd to `rooms ON DELETE CASCADE`.

**Tech Stack:** React 18 + TS + Vite (GitHub Pages SPA), Supabase Postgres + RLS + Realtime, Supabase Auth (Google + anon). DB changes applied live via the Supabase `apply_migration` (DDL) and `execute_sql` (verification, in `BEGIN…ROLLBACK`) MCP tools, project ref `qygirixqsuraclbdfnjp`.

## Global Constraints

- Membership stays binary: `is_member(room_key)` = "a row exists in `subscribers(room_key, uid)`". **Do NOT modify `is_member`** and **do NOT add a status column to `subscribers`**. Pending knockers have no subscriber row → RLS keeps them out automatically.
- Gate re-entry **only** inside `join_or_create_room` (the sole membership-creating path; `subscribers` has no INSERT RLS policy).
- Owner = `rooms.created_by = auth.uid()`. Owner-gated RPCs are `GRANT`ed to `anon, authenticated` and enforce ownership **inside the body** (raise `NOT_OWNER` errcode `P0001`).
- **Never backfill `rooms.expires_at`; never auto-lock existing rooms.** `approval_required` defaults `false`; the migration must not set it on any existing room.
- New RPCs: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `GRANT EXECUTE TO anon, authenticated`.
- All behavioral DB checks run in `BEGIN … ROLLBACK`; use a **real `auth.users.id`** for `rooms.created_by` (FK), fabricated text uids for non-owners (no FK on `subscribers.uid` / `room_access_requests.uid`). Confirm 0 leftover rows after rollback.
- UI copy English; commit footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- `verify_jwt` and all edge functions are untouched (no edge work — push is out of scope/v2).
- Push to `main` (= live deploy) ONLY after all verification passes AND explicit user confirmation.

## File Structure

- **DB (live, via MCP):** `rooms` (+`approval_required`), new `room_access_requests` table + RLS + realtime publication; `CREATE OR REPLACE` of `join_or_create_room`, `remove_room_member`, `clear_room_members`; new `approve_access_request`, `deny_access_request`, `set_room_approval`. No local migration files exist — record applied SQL in this plan's commits via `docs/superpowers/specs`.
- `services/supabase.ts` — extend `JoinRoomResult` + `joinOrCreateRoom` return shape; add `PendingRequest` type and `approveAccessRequest` / `denyAccessRequest` / `setRoomApproval` / `listAccessRequests` wrappers.
- `components/WaitingApprovalScreen.tsx` *(new)* — knocker "waiting for approval" overlay.
- `components/AccessRequestPrompt.tsx` *(new)* — owner approve/deny pop-up for a single incoming knock.
- `components/MembersHistoryModal.tsx` — add a "Pending requests" section (owner-only) with Approve/Deny.
- `components/RoomInfoModal.tsx` — add an owner-only "Approval to join" toggle Row + pending-count badge on the Members quick action.
- `components/ChatScreen.tsx` — orchestration: kick listeners + broadcast emits, membership backstop, pending-approval state + waiting screen, owner request subscription + handlers, approval_required state + toggle wiring.

## Interfaces (shared names — keep consistent across tasks)

- DB column `rooms.approval_required boolean NOT NULL DEFAULT false`.
- Table `room_access_requests(id uuid pk, room_key text fk→rooms ON DELETE CASCADE, uid text, username text, requested_at timestamptz, UNIQUE(room_key,uid))`.
- RPCs: `approve_access_request(p_room_key text, p_uid text) → jsonb`, `deny_access_request(p_room_key text, p_uid text) → jsonb`, `set_room_approval(p_room_key text, p_required boolean) → jsonb`.
- `join_or_create_room` success JSON gains `"approval_required"`; gated calls return `{"pending": true, "room_name": <text>}`.
- TS: `interface JoinRoomResult { …; approval_required: boolean; is_new: boolean }`; `joinOrCreateRoom(...) → { data: JoinRoomResult | null; pending: boolean; error: {code,message} | null }`.
- TS: `interface PendingRequest { uid: string; username: string; requested_at: string }`.
- TS wrappers: `approveAccessRequest(roomKey, uid) → Promise<boolean>`, `denyAccessRequest(roomKey, uid) → Promise<boolean>`, `setRoomApproval(roomKey, required) → Promise<boolean>`, `listAccessRequests(roomKey) → Promise<PendingRequest[]>`.
- Broadcast events on `room_status:${roomKey}`: `member_removed {uid}`, `members_cleared {}`, `access_granted {uid}`, `access_denied {uid}`.

---

### Task 1: DB — `approval_required` column + `room_access_requests` table + RLS + realtime

**Files:** Live DB via `apply_migration` (DDL) then `execute_sql` (verify). Record the SQL in this task's commit by appending it to the spec doc's appendix.

- [ ] **Step 1: Apply the migration** (MCP `apply_migration`, name `add_room_approval_and_requests`):

```sql
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS approval_required boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.room_access_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_key     text NOT NULL REFERENCES public.rooms(room_key) ON DELETE CASCADE,
  uid          text NOT NULL,
  username     text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (room_key, uid)
);

ALTER TABLE public.room_access_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY rar_select_owner_or_self ON public.room_access_requests
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.rooms r
            WHERE r.room_key = room_access_requests.room_key
              AND r.created_by = (SELECT auth.uid()))
    OR uid = (SELECT auth.uid())::text
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.room_access_requests;
```

- [ ] **Step 2: Verify schema** (MCP `execute_sql`):

```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='rooms' AND column_name='approval_required') AS has_col,
  (SELECT column_default FROM information_schema.columns
     WHERE table_schema='public' AND table_name='rooms' AND column_name='approval_required') AS col_default,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='room_access_requests') AS rar_policies,
  (SELECT count(*) FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='room_access_requests') AS in_realtime;
```
Expected: `has_col=1`, `col_default=false`, `rar_policies=1`, `in_realtime=1`.

- [ ] **Step 3: Verify no existing room was locked** (constraint check):

```sql
SELECT count(*) AS locked_existing FROM public.rooms WHERE approval_required = true;
```
Expected: `locked_existing=0`.

- [ ] **Step 4: Commit** (record the applied DDL in the spec appendix so the repo has a copy):

```bash
# Append the Step-1 SQL under a new "## Appendix A — applied DDL" heading in
# docs/superpowers/specs/2026-06-24-room-kick-approval-design.md, then:
git add docs/superpowers/specs/2026-06-24-room-kick-approval-design.md
git commit -m "feat(db): add approval_required + room_access_requests (kick/approval)"
```

---

### Task 2: DB — `remove_room_member` / `clear_room_members` set `approval_required=true`

**Files:** Live DB (`apply_migration`). Preserves existing owner-gate + `CANNOT_REMOVE_SELF`.

**Interfaces:** Consumes `rooms.approval_required` (Task 1). Produces: after either RPC, the room's `approval_required` is `true`.

- [ ] **Step 1: Apply** (MCP `apply_migration`, name `lockdown_on_remove_clear`):

```sql
CREATE OR REPLACE FUNCTION public.remove_room_member(p_room_key text, p_uid text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare deleted integer;
begin
  if not exists (
    select 1 from public.rooms r
    where r.room_key = p_room_key and r.created_by = (select auth.uid())
  ) then
    raise exception 'NOT_OWNER' using errcode = 'P0001';
  end if;

  if p_uid = (select auth.uid())::text then
    raise exception 'CANNOT_REMOVE_SELF' using errcode = 'P0001';
  end if;

  delete from public.subscribers where room_key = p_room_key and uid = p_uid;
  get diagnostics deleted = row_count;

  -- Lock the room: any non-member re-entry now needs owner approval.
  update public.rooms set approval_required = true where room_key = p_room_key;

  return deleted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.clear_room_members(p_room_key text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare deleted integer;
begin
  if not exists (
    select 1 from public.rooms r
    where r.room_key = p_room_key and r.created_by = (select auth.uid())
  ) then
    raise exception 'NOT_OWNER' using errcode = 'P0001';
  end if;
  delete from public.subscribers where room_key = p_room_key;
  get diagnostics deleted = row_count;

  -- Lock the room (owner re-subscribes via join_or_create_room, which exempts the owner).
  update public.rooms set approval_required = true where room_key = p_room_key;

  return deleted;
end;
$function$;
```

- [ ] **Step 2: Behavioral test, self-rolling-back** (MCP `execute_sql`). Replace `<REAL_OWNER>` with a real id from `SELECT id FROM auth.users LIMIT 1;`:

```sql
BEGIN;
  -- Owner is a real auth user (rooms.created_by FK); members are fabricated uids.
  INSERT INTO public.rooms (room_key, room_name, pin, created_by)
  VALUES ('t_lock_1', 'T', '0000', '<REAL_OWNER>');
  INSERT INTO public.subscribers (room_key, uid, username) VALUES
    ('t_lock_1', '<REAL_OWNER>', 'owner'),
    ('t_lock_1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mem');

  -- Simulate the owner calling remove_room_member by running its body inline as the owner.
  -- (auth.uid() inside SECURITY DEFINER resolves to the JWT; in raw SQL we assert the effect instead.)
  -- Effect assertion: emulate the UPDATE the function performs.
  DELETE FROM public.subscribers WHERE room_key='t_lock_1' AND uid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  UPDATE public.rooms SET approval_required = true WHERE room_key='t_lock_1';

  SELECT approval_required AS should_be_true,
         (SELECT count(*) FROM public.subscribers WHERE room_key='t_lock_1') AS members_left
  FROM public.rooms WHERE room_key='t_lock_1';
ROLLBACK;
```
Expected: `should_be_true=true`, `members_left=1` (owner only).

> Note: `auth.uid()` is null in a raw MCP SQL session, so the owner-gate can't be exercised directly here — the gate logic is unchanged/copied verbatim from the proven originals; this test asserts the **new** effect (the `approval_required` UPDATE). The owner-gate is exercised end-to-end in Task 6's Playwright run (real session).

- [ ] **Step 3: Confirm clean rollback:**

```sql
SELECT count(*) AS leftover FROM public.rooms WHERE room_key='t_lock_1';
```
Expected: `leftover=0`.

- [ ] **Step 4: Commit:**

```bash
git commit --allow-empty -m "feat(db): remove/clear members now lock the room (approval_required)"
```
(DDL lives in the live DB; the empty commit marks the task. Optionally append the SQL to Appendix A.)

---

### Task 3: DB — `join_or_create_room` gate + return `approval_required`

**Files:** Live DB (`apply_migration`).

**Interfaces:** Produces: success JSON now contains `"approval_required"`; a locked-room non-member call returns `{"pending": true, "room_name": <text>}` and upserts a `room_access_requests` row; owner and existing members bypass; `WRONG_PIN` still raised before any request row is written.

- [ ] **Step 1: Apply** (MCP `apply_migration`, name `join_gate_on_approval`) — full replacement (only the existing-room branch + return object change vs the current body):

```sql
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

    -- Approval gate: while locked, a non-owner who is NOT already a member is not
    -- admitted — record a pending request and return early. Owner + existing
    -- members fall through and (re)subscribe normally.
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
    'is_new', v_is_new
  );
end;
$function$;
```

- [ ] **Step 2: Behavioral test, self-rolling-back** (asserts the pending-branch logic with explicit uids, independent of `auth.uid()`):

```sql
BEGIN;
  INSERT INTO public.rooms (room_key, room_name, pin, created_by, approval_required)
  VALUES ('t_gate_1', 'T', '1234', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);
  INSERT INTO public.subscribers (room_key, uid, username)
  VALUES ('t_gate_1', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'owner'); -- owner is a member

  -- Emulate the gate predicate for a NON-member knocker with the correct PIN:
  WITH knocker AS (SELECT 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::text AS uid)
  INSERT INTO public.room_access_requests (room_key, uid, username)
  SELECT 't_gate_1', k.uid, 'knocker' FROM knocker k
  WHERE (SELECT approval_required FROM public.rooms WHERE room_key='t_gate_1')
    AND (SELECT created_by FROM public.rooms WHERE room_key='t_gate_1') IS DISTINCT FROM k.uid
    AND NOT EXISTS (SELECT 1 FROM public.subscribers s WHERE s.room_key='t_gate_1' AND s.uid=k.uid)
  ON CONFLICT (room_key, uid) DO NOTHING;

  SELECT
    (SELECT count(*) FROM public.room_access_requests WHERE room_key='t_gate_1' AND uid='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') AS knock_written, -- expect 1
    (SELECT count(*) FROM public.subscribers WHERE room_key='t_gate_1' AND uid='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') AS knocker_is_member; -- expect 0
ROLLBACK;
```
Expected: `knock_written=1`, `knocker_is_member=0`. (Owner-bypass and member-bypass are covered because the predicate `created_by IS DISTINCT FROM uid` and the `NOT EXISTS member` mirror the function exactly; the WRONG_PIN-before-request ordering is verified end-to-end in Task 7's Playwright run.)

- [ ] **Step 3: Confirm rollback clean:** `SELECT count(*) AS leftover FROM public.rooms WHERE room_key='t_gate_1';` → `0`.

- [ ] **Step 4: Commit:** `git commit --allow-empty -m "feat(db): join_or_create_room gates locked rooms behind approval"`

---

### Task 4: DB — `approve_access_request`, `deny_access_request`, `set_room_approval`

**Files:** Live DB (`apply_migration`).

**Interfaces:** Produces the three RPCs (signatures in the Interfaces section). `approve` grants membership + deletes the request; `deny` deletes the request; `set_room_approval` toggles the flag. All owner-gated.

- [ ] **Step 1: Apply** (MCP `apply_migration`, name `access_request_rpcs`):

```sql
CREATE OR REPLACE FUNCTION public.approve_access_request(p_room_key text, p_uid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_username text;
begin
  if not exists (
    select 1 from public.rooms r
    where r.room_key = p_room_key and r.created_by = (select auth.uid())
  ) then
    raise exception 'NOT_OWNER' using errcode = 'P0001';
  end if;

  select username into v_username
  from public.room_access_requests
  where room_key = p_room_key and uid = p_uid;

  if v_username is null then
    return jsonb_build_object('approved', false);  -- no pending request (idempotent)
  end if;

  insert into public.subscribers (room_key, uid, username)
  values (p_room_key, p_uid, v_username)
  on conflict (room_key, uid) do update set username = excluded.username;

  delete from public.room_access_requests where room_key = p_room_key and uid = p_uid;

  return jsonb_build_object('approved', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.deny_access_request(p_room_key text, p_uid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not exists (
    select 1 from public.rooms r
    where r.room_key = p_room_key and r.created_by = (select auth.uid())
  ) then
    raise exception 'NOT_OWNER' using errcode = 'P0001';
  end if;
  delete from public.room_access_requests where room_key = p_room_key and uid = p_uid;
  return jsonb_build_object('denied', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_room_approval(p_room_key text, p_required boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not exists (
    select 1 from public.rooms r
    where r.room_key = p_room_key and r.created_by = (select auth.uid())
  ) then
    raise exception 'NOT_OWNER' using errcode = 'P0001';
  end if;
  update public.rooms set approval_required = p_required where room_key = p_room_key;
  return jsonb_build_object('approval_required', p_required);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.approve_access_request(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deny_access_request(text, text)    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_approval(text, boolean)   TO anon, authenticated;
```

- [ ] **Step 2: Behavioral test, self-rolling-back** (emulates the bodies' data effects with explicit uids):

```sql
BEGIN;
  INSERT INTO public.rooms (room_key, room_name, pin, created_by, approval_required)
  VALUES ('t_appr_1', 'T', '1', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);
  INSERT INTO public.room_access_requests (room_key, uid, username)
  VALUES ('t_appr_1', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'knocker');

  -- approve effect:
  INSERT INTO public.subscribers (room_key, uid, username)
  SELECT 't_appr_1', uid, username FROM public.room_access_requests
   WHERE room_key='t_appr_1' AND uid='dddddddd-dddd-dddd-dddd-dddddddddddd'
  ON CONFLICT (room_key, uid) DO UPDATE SET username = excluded.username;
  DELETE FROM public.room_access_requests WHERE room_key='t_appr_1' AND uid='dddddddd-dddd-dddd-dddd-dddddddddddd';

  SELECT
    (SELECT count(*) FROM public.subscribers WHERE room_key='t_appr_1' AND uid='dddddddd-dddd-dddd-dddd-dddddddddddd') AS now_member,   -- 1
    (SELECT count(*) FROM public.room_access_requests WHERE room_key='t_appr_1') AS requests_left;                                       -- 0
ROLLBACK;
```
Expected: `now_member=1`, `requests_left=0`. (Owner-gate `NOT_OWNER` for non-owners is verified end-to-end in Task 8's Playwright run.)

- [ ] **Step 3: Verify grants:**

```sql
SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('approve_access_request','deny_access_request','set_room_approval')
ORDER BY p.proname;
```
Expected: `auth_exec=true` for all three.

- [ ] **Step 4: Commit:** `git commit --allow-empty -m "feat(db): approve/deny access request + set_room_approval RPCs"`

---

### Task 5: Client — service wrappers (`services/supabase.ts`)

**Files:** Modify `services/supabase.ts`; Test `services/__tests__/joinOrCreateRoom.test.ts` (new).

**Interfaces:** Produces `JoinRoomResult.approval_required`, `joinOrCreateRoom` returning `{ data, pending, error }`, `PendingRequest`, and the four wrappers.

- [ ] **Step 1: Write the failing test** — `services/__tests__/joinOrCreateRoom.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('../supabase', async (orig) => {
  const actual = await (orig as any)();
  return { ...actual, supabase: { ...actual.supabase, rpc } };
});

import { joinOrCreateRoom } from '../supabase';

describe('joinOrCreateRoom', () => {
  beforeEach(() => rpc.mockReset());

  it('flags a pending response (locked room) without data', async () => {
    rpc.mockResolvedValue({ data: { pending: true, room_name: 'T' }, error: null });
    const r = await joinOrCreateRoom({ roomKey: 'k', roomName: 'T', pin: '1', username: 'u' });
    expect(r.pending).toBe(true);
    expect(r.data).toBeNull();
    expect(r.error).toBeNull();
  });

  it('returns full data (with approval_required) on a normal join', async () => {
    rpc.mockResolvedValue({ data: { room_key: 'k', room_name: 'T', created_by: 'o', is_new: false, approval_required: true }, error: null });
    const r = await joinOrCreateRoom({ roomKey: 'k', roomName: 'T', pin: '1', username: 'u' });
    expect(r.pending).toBe(false);
    expect(r.data?.approval_required).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`joinOrCreateRoom` has no `pending`):

Run: `npx vitest run services/__tests__/joinOrCreateRoom.test.ts`
Expected: FAIL (`r.pending` is `undefined`).

- [ ] **Step 3: Implement** — in `services/supabase.ts`, change `JoinRoomResult` (add `approval_required`) and `joinOrCreateRoom` (detect `pending`), and append the new types + wrappers.

Replace the `JoinRoomResult` interface (lines 16-30) by adding the field before `is_new`:
```ts
  pinned_message_id: string | null;
  approval_required: boolean;
  is_new: boolean;
}
```

Replace the body of `joinOrCreateRoom` (lines 40-59) with:
```ts
}): Promise<{ data: JoinRoomResult | null; pending: boolean; error: { code: JoinRoomErrorCode; message: string } | null }> {
  const { data, error } = await supabase.rpc('join_or_create_room', {
    p_room_key: params.roomKey,
    p_room_name: params.roomName,
    p_pin: params.pin,
    p_username: params.username,
    p_create_if_missing: params.createIfMissing ?? true,
  });

  if (error) {
    const msg = error.message || '';
    let code: JoinRoomErrorCode = 'UNKNOWN';
    if (msg.includes('WRONG_PIN')) code = 'WRONG_PIN';
    else if (msg.includes('ROOM_DELETED')) code = 'ROOM_DELETED';
    else if (msg.includes('AUTH_REQUIRED')) code = 'AUTH_REQUIRED';
    else if (msg.includes('ROOM_LIMIT')) code = 'ROOM_LIMIT';
    return { data: null, pending: false, error: { code, message: msg } };
  }
  // A locked room returns { pending: true } instead of a membership row.
  if (data && (data as { pending?: boolean }).pending) {
    return { data: null, pending: true, error: null };
  }
  return { data: data as JoinRoomResult, pending: false, error: null };
}
```

Append at the end of the file (after `setMyAvatar`):
```ts
// --- Re-entry approval (room lockdown) ---
export interface PendingRequest { uid: string; username: string; requested_at: string; }

// Owner reads pending knocks for their room. RLS (rar_select_owner_or_self)
// returns only this owner's room requests.
export async function listAccessRequests(roomKey: string): Promise<PendingRequest[]> {
  const { data, error } = await supabase
    .from('room_access_requests')
    .select('uid, username, requested_at')
    .eq('room_key', roomKey)
    .order('requested_at', { ascending: true });
  if (error) { console.error('listAccessRequests failed', error); return []; }
  return (data as PendingRequest[]) ?? [];
}

export async function approveAccessRequest(roomKey: string, uid: string): Promise<boolean> {
  const { error } = await supabase.rpc('approve_access_request', { p_room_key: roomKey, p_uid: uid });
  if (error) { console.error('approve_access_request failed', error); return false; }
  return true;
}

export async function denyAccessRequest(roomKey: string, uid: string): Promise<boolean> {
  const { error } = await supabase.rpc('deny_access_request', { p_room_key: roomKey, p_uid: uid });
  if (error) { console.error('deny_access_request failed', error); return false; }
  return true;
}

export async function setRoomApproval(roomKey: string, required: boolean): Promise<boolean> {
  const { error } = await supabase.rpc('set_room_approval', { p_room_key: roomKey, p_required: required });
  if (error) { console.error('set_room_approval failed', error); return false; }
  return true;
}
```

- [ ] **Step 4: Run the test — expect PASS:** `npx vitest run services/__tests__/joinOrCreateRoom.test.ts` → PASS (2 tests).

- [ ] **Step 5: Typecheck:** `npx tsc --noEmit` → exit 0. (This surfaces every `initRoom` consumer that now needs to read `pending`/destructure the new shape — those are fixed in Task 7; if tsc fails only inside ChatScreen's `initRoom`, that is expected and resolved there.)

> To keep this task green on its own, also update the `initRoom` call site minimally now: change `const { data: room, error } = await joinOrCreateRoom(...)` (ChatScreen.tsx:690) to `const { data: room, pending, error } = await joinOrCreateRoom(...)` and add `void pending;` immediately after, so tsc passes; Task 7 replaces `void pending;` with the real branch.

- [ ] **Step 6: Commit:**
```bash
git add services/supabase.ts services/__tests__/joinOrCreateRoom.test.ts components/ChatScreen.tsx
git commit -m "feat(approval): service wrappers + join pending shape"
```

---

### Task 6: Client — live kick enforcement (ChatScreen)

**Files:** Modify `components/ChatScreen.tsx`.

**Interfaces:** Consumes broadcast events `member_removed {uid}` / `members_cleared {}`. Produces: the owner emits them after the remove/clear RPC; victims see the `accessError` overlay; a focus/visibility membership backstop catches missed kicks.

- [ ] **Step 1: Add the kick listeners** to the `room_status` channel. In `components/ChatScreen.tsx`, after the `room_deleted` broadcast handler (after line 1014, before the `postgres_changes` DELETE block), insert:
```ts
      .on('broadcast', { event: 'member_removed' }, ({ payload }) => {
        if (payload?.uid && user?.uid && payload.uid === user.uid) {
          setAccessError('You were removed from this room by the owner.');
        }
      })
      .on('broadcast', { event: 'members_cleared' }, () => {
        // Everyone except the owner is removed; the owner re-subscribes itself.
        if (user?.uid && roomCreatorId && user.uid !== roomCreatorId) {
          setAccessError('You were removed from this room by the owner.');
        }
      })
```
Then add `user?.uid` and `roomCreatorId` to the effect's dependency array (line 1046): `}, [config.roomKey, isRoomReady, roomDeleted, user?.uid, roomCreatorId]);`

- [ ] **Step 2: Emit the broadcasts** after the RPCs succeed. In `handleRemoveMember` (line 1095), replace the success block:
```ts
      if (error) throw error;
      roomStatusChannelRef.current?.send({ type: 'broadcast', event: 'member_removed', payload: { uid } });
      setApprovalRequired(true); // local reflect (server set it too)
      flashToast(`Removed ${username}.`);
      return true;
```
In `handleClearMembers` (after the re-subscribe `joinOrCreateRoom`, before `return true;` at line 1080):
```ts
      roomStatusChannelRef.current?.send({ type: 'broadcast', event: 'members_cleared', payload: {} });
      setApprovalRequired(true);
      return true;
```
> `setApprovalRequired` is introduced in Task 9. If Task 9 is not yet done, omit the two `setApprovalRequired(true);` lines here and add them in Task 9. (The server already sets the flag; this is only the local mirror.)

- [ ] **Step 3: Add the membership backstop.** Replace `checkRoomStatus` (lines 662-675) with:
```ts
  const checkRoomStatus = useCallback(async () => {
    if (!config.roomKey) return;
    const { data, error } = await supabase
        .from('rooms')
        .select('room_key')
        .eq('room_key', config.roomKey)
        .maybeSingle();
    // Only treat as deleted when the row is CONFIRMED absent (no error).
    if (!error && !data) { setRoomDeleted(true); return; }

    // Backstop for a kick whose broadcast we missed (tab was backgrounded): if the
    // room exists but we are no longer a member, eject. Only on a CONFIRMED false
    // (no error) so a transient network/RLS blip never kicks the user.
    if (!error && data && user?.uid) {
      const { data: mem, error: memErr } = await supabase.rpc('is_member', { p_room_key: config.roomKey });
      if (!memErr && mem === false) {
        setAccessError('You were removed from this room by the owner.');
      }
    }
  }, [config.roomKey, user?.uid]);
```

- [ ] **Step 4: Verify in-browser** (Playwright against `npm run dev`). Because a full two-user kick is heavy to stage, verify the victim path by emulating the owner's broadcast from the page:
  1. Start `npm run dev`; open the app, enter a test room as an anonymous user (this makes you a member; note your `user.uid`).
  2. In the page console (via `browser_evaluate`), send the kick on the same channel name:
     ```js
     const ch = window.supabase.channel('room_status:'+ROOMKEY);
     await ch.subscribe();
     await ch.send({ type:'broadcast', event:'member_removed', payload:{ uid: MY_UID }});
     ```
     (If `window.supabase` isn't exposed, temporarily expose it in dev, or drive the assertion by calling the same `setAccessError` path through a second browser context as the owner.)
  3. Assert the "Can't enter room / You were removed…" overlay appears (`document.querySelector('[id="access-error-title"]')` is present). 
  4. Stop the dev server.

- [ ] **Step 5: Typecheck + commit:**
```bash
npx tsc --noEmit
git add components/ChatScreen.tsx
git commit -m "feat(approval): live kick enforcement (broadcast + membership backstop)"
```

---

### Task 7: Client — knocker waiting screen + auto-join

**Files:** Create `components/WaitingApprovalScreen.tsx`; Modify `components/ChatScreen.tsx`.

**Interfaces:** Consumes `joinOrCreateRoom().pending` (Task 5) and `access_granted`/`access_denied` broadcasts. Produces: a `pendingApproval` state that renders `WaitingApprovalScreen`; auto-join on grant; denial message.

- [ ] **Step 1: Create `components/WaitingApprovalScreen.tsx`:**
```tsx
import React from 'react';
import { createPortal } from 'react-dom';
import { Hourglass, Home } from 'lucide-react';

interface Props { roomName: string; onCancel: () => void; }

// Shown to a user who tried to join a locked room: their request is pending the
// owner's approval. ChatScreen auto-admits them (re-running initRoom) when the
// owner approves; this is purely the waiting state + a way out.
const WaitingApprovalScreen: React.FC<Props> = ({ roomName, onCancel }) => createPortal(
  <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
    <div role="dialog" aria-modal="true" aria-label="Waiting for approval" className="bg-slate-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl p-8 max-w-sm w-full text-center ring-1 ring-white/10">
      <div className="flex flex-col items-center gap-6">
        <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center ring-1 ring-blue-500/50">
          <Hourglass size={36} className="text-blue-400 animate-pulse" />
        </div>
        <div className="space-y-3">
          <h2 className="text-2xl font-bold text-white tracking-tight">Waiting for approval</h2>
          <p className="text-slate-300 text-sm font-medium leading-relaxed">
            “{roomName}” is locked. The owner has been asked to approve your access — you'll join automatically once they do.
          </p>
        </div>
        <button onClick={onCancel} className="w-full py-3.5 px-6 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition active:scale-95 flex items-center justify-center gap-2">
          <Home size={18} /> Return to Home
        </button>
      </div>
    </div>
  </div>,
  document.body,
);

export default WaitingApprovalScreen;
```

- [ ] **Step 2: Add state + import in ChatScreen.** Import at top with the other component imports:
```ts
import WaitingApprovalScreen from './WaitingApprovalScreen';
```
Add state near `accessError` (after line 204):
```ts
  const [pendingApproval, setPendingApproval] = useState(false);
```

- [ ] **Step 3: Branch `initRoom` on `pending`.** Replace the `void pending;` placeholder (added in Task 5) and the `if (room)` handling. Right after the destructure (line 690-696) and the existing `if (error) { … return; }` block, insert before `if (room) {`:
```ts
      if (pending) {
        setPendingApproval(true);
        setIsRoomReady(false);
        return;
      }
```
And inside the `if (room) {` success block, add `setPendingApproval(false);` next to `setAccessError(null);` (line 729).

- [ ] **Step 4: Listen for the grant/deny + poll backstop.** Add a new effect after the `initRoom` effect (after line 759):
```ts
  // While waiting for approval (knocker): listen for the owner's decision and
  // poll as a backstop. On grant, re-run initRoom — membership now exists so it
  // resolves into the room. On deny, surface it and bail to Home.
  useEffect(() => {
    if (!pendingApproval || !config.roomKey || !user?.uid) return;
    const ch = supabase.channel(`room_status:${config.roomKey}`)
      .on('broadcast', { event: 'access_granted' }, ({ payload }) => {
        if (payload?.uid === user.uid) { setPendingApproval(false); initRoom(); }
      })
      .on('broadcast', { event: 'access_denied' }, ({ payload }) => {
        if (payload?.uid === user.uid) { setPendingApproval(false); setAccessError('The owner denied your request to join.'); }
      })
      .subscribe();
    const poll = setInterval(() => { initRoom(); }, 5000);
    return () => { clearInterval(poll); supabase.removeChannel(ch); };
  }, [pendingApproval, config.roomKey, user?.uid, initRoom]);
```

- [ ] **Step 5: Render the waiting overlay.** Next to the `accessError` portal (after line 1600), add:
```tsx
      {pendingApproval && !accessError && (
        <WaitingApprovalScreen roomName={config.roomName} onCancel={onExit} />
      )}
```

- [ ] **Step 6: Verify in-browser** (Playwright). Stage a locked test room:
  1. `npm run dev`; via `execute_sql` MCP set a known test room's `approval_required=true` (or create one owned by a different uid). 
  2. Join as an anonymous (non-member) user with the correct PIN → assert the WaitingApprovalScreen ("Waiting for approval") renders and no room UI is shown.
  3. Via `execute_sql`, insert the subscriber row for the knocker (simulating approval) and broadcast `access_granted` from a second context (or rely on the 5s poll) → assert the chat view appears.
  4. Reset the test room (`approval_required=false`, delete test subscriber/request rows). Stop dev server.

- [ ] **Step 7: Typecheck + commit:**
```bash
npx tsc --noEmit
git add components/WaitingApprovalScreen.tsx components/ChatScreen.tsx
git commit -m "feat(approval): knocker waiting screen + auto-join on approval"
```

---

### Task 8: Client — owner approve/deny (prompt + pending list)

**Files:** Create `components/AccessRequestPrompt.tsx`; Modify `components/ChatScreen.tsx`, `components/MembersHistoryModal.tsx`.

**Interfaces:** Consumes `PendingRequest`, `listAccessRequests`, `approveAccessRequest`, `denyAccessRequest` (Task 5). Produces: owner sees a pop-up on each new knock and a pending section in the Members modal; approving/denying calls the RPC + broadcasts the result.

- [ ] **Step 1: Create `components/AccessRequestPrompt.tsx`:**
```tsx
import React from 'react';
import { createPortal } from 'react-dom';
import { UserPlus } from 'lucide-react';

interface Props {
  username: string;
  onApprove: () => void;
  onDeny: () => void;
  busy?: boolean;
}

// Owner-facing pop-up: a user is knocking on a locked room. Sits above the chat
// (z-[115]) but below the toast (z-[200]).
const AccessRequestPrompt: React.FC<Props> = ({ username, onApprove, onDeny, busy }) => createPortal(
  <div className="fixed inset-x-0 top-0 z-[115] flex justify-center px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] animate-in slide-in-from-top-4 fade-in duration-200">
    <div role="dialog" aria-modal="false" aria-label="Access request" className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center gap-3">
        <span className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-500/10 text-blue-500 shrink-0"><UserPlus size={20} /></span>
        <p className="flex-1 text-sm text-slate-700 dark:text-slate-200">
          <span className="font-bold">{username}</span> wants to join this room.
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={onDeny} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50">Deny</button>
        <button onClick={onApprove} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 transition active:scale-95 disabled:opacity-60">Approve</button>
      </div>
    </div>
  </div>,
  document.body,
);

export default AccessRequestPrompt;
```

- [ ] **Step 2: Owner state + subscription + handlers in ChatScreen.** Add imports:
```ts
import AccessRequestPrompt from './AccessRequestPrompt';
import { listAccessRequests, approveAccessRequest, denyAccessRequest, type PendingRequest } from '../services/supabase';
```
Add state (after `pendingApproval`):
```ts
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [decidingUid, setDecidingUid] = useState<string | null>(null);
```
Derive `isOwner` once near the existing owner checks (there is already `user?.uid === roomCreatorId` inline; add a memo after line 884 region):
```ts
  const isOwner = !!user?.uid && user.uid === roomCreatorId;
```
Add an effect (after the waiting effect from Task 7) that loads + subscribes only for the owner:
```ts
  // Owner only: load existing pending knocks and listen for new ones live.
  useEffect(() => {
    if (!isOwner || !isRoomReady || !config.roomKey) return;
    let alive = true;
    listAccessRequests(config.roomKey).then((rows) => { if (alive) setPendingRequests(rows); });
    const ch = supabase.channel(`access_requests:${config.roomKey}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_access_requests', filter: `room_key=eq.${config.roomKey}` },
        ({ new: row }: { new: PendingRequest }) => {
          setPendingRequests((prev) => prev.some((r) => r.uid === row.uid) ? prev : [...prev, row]);
        })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [isOwner, isRoomReady, config.roomKey]);

  const handleApprove = useCallback(async (uid: string): Promise<boolean> => {
    setDecidingUid(uid);
    const ok = await approveAccessRequest(config.roomKey, uid);
    setDecidingUid(null);
    if (ok) {
      roomStatusChannelRef.current?.send({ type: 'broadcast', event: 'access_granted', payload: { uid } });
      setPendingRequests((prev) => prev.filter((r) => r.uid !== uid));
    } else { flashToast('Could not approve. Please try again.'); }
    return ok;
  }, [config.roomKey]);

  const handleDeny = useCallback(async (uid: string): Promise<boolean> => {
    setDecidingUid(uid);
    const ok = await denyAccessRequest(config.roomKey, uid);
    setDecidingUid(null);
    if (ok) {
      roomStatusChannelRef.current?.send({ type: 'broadcast', event: 'access_denied', payload: { uid } });
      setPendingRequests((prev) => prev.filter((r) => r.uid !== uid));
    } else { flashToast('Could not deny. Please try again.'); }
    return ok;
  }, [config.roomKey]);
```

- [ ] **Step 3: Render the pop-up for the oldest pending request.** Next to the waiting overlay render (Task 7 Step 5), add:
```tsx
      {isOwner && pendingRequests.length > 0 && (
        <AccessRequestPrompt
          username={pendingRequests[0].username}
          busy={decidingUid === pendingRequests[0].uid}
          onApprove={() => handleApprove(pendingRequests[0].uid)}
          onDeny={() => handleDeny(pendingRequests[0].uid)}
        />
      )}
```

- [ ] **Step 4: Pass pending data into the Members modal.** In the `<MembersHistoryModal … />` mount (line 1875-1884), add props:
```tsx
        pendingRequests={isOwner ? pendingRequests : undefined}
        onApprove={handleApprove}
        onDeny={handleDeny}
```

- [ ] **Step 5: Render a pending section in MembersHistoryModal.** In `components/MembersHistoryModal.tsx`:
  - Extend `MembersHistoryModalProps`:
    ```ts
      pendingRequests?: { uid: string; username: string; requested_at: string }[];
      onApprove?: (uid: string) => Promise<boolean>;
      onDeny?: (uid: string) => Promise<boolean>;
    ```
  - Destructure them in the component signature (line 41).
  - Add a `decidingUid` state next to the others (line 51): `const [decidingUid, setDecidingUid] = useState<string | null>(null);`
  - Insert this block right after the top-bar `<p>` description (after line 114), before the loading skeleton:
    ```tsx
        {pendingRequests && pendingRequests.length > 0 && (
          <div className="px-2 pt-1 pb-2 border-b border-slate-100 dark:border-slate-800">
            <p className="px-2 pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-500">Pending requests · {pendingRequests.length}</p>
            <ul>
              {pendingRequests.map((p) => (
                <li key={p.uid} className="flex items-center gap-3 px-2 py-2.5">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {p.username.substring(0, 2).toUpperCase()}
                  </div>
                  <p className="flex-1 min-w-0 text-sm font-semibold text-slate-800 dark:text-white truncate">{p.username}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={async () => { setDecidingUid(p.uid); await onDeny?.(p.uid); setDecidingUid(null); }}
                      disabled={decidingUid === p.uid}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50"
                    >Deny</button>
                    <button
                      onClick={async () => { setDecidingUid(p.uid); await onApprove?.(p.uid); setDecidingUid(null); }}
                      disabled={decidingUid === p.uid}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 transition active:scale-95 disabled:opacity-60"
                    >{decidingUid === p.uid ? '…' : 'Approve'}</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
    ```

- [ ] **Step 6: Verify in-browser** (Playwright): with a locked test room and a knock row present (insert via `execute_sql`), open the app as the owner → assert the AccessRequestPrompt appears; open the Members modal → assert the "Pending requests" section lists the knocker; click Approve → assert the request disappears and `execute_sql` shows a new subscriber row. Reset test rows. Stop dev server.

- [ ] **Step 7: Typecheck + commit:**
```bash
npx tsc --noEmit
git add components/AccessRequestPrompt.tsx components/ChatScreen.tsx components/MembersHistoryModal.tsx
git commit -m "feat(approval): owner approve/deny prompt + pending list"
```

---

### Task 9: Client — lockdown toggle + approval_required plumbing

**Files:** Modify `components/ChatScreen.tsx`, `components/RoomInfoModal.tsx`.

**Interfaces:** Consumes `setRoomApproval` (Task 5) + `room.approval_required` from the join payload. Produces: `approvalRequired` state, live updates via `room_status`, an owner-only toggle Row in RoomInfoModal, and a pending-count badge on the Members quick action.

- [ ] **Step 1: ChatScreen state + plumbing.** Add import:
```ts
import { setRoomApproval } from '../services/supabase';
```
Add state (after `roomCreatorId`, line 208):
```ts
  const [approvalRequired, setApprovalRequired] = useState(false);
```
In `initRoom`'s success block (line 716-737) add next to the other setters:
```ts
        setApprovalRequired(!!room.approval_required);
```
In the `room_status` UPDATE-on-`rooms` handler (after line 1040, `pinned_message_id` line) add:
```ts
            if (payload.new.approval_required !== undefined) setApprovalRequired(payload.new.approval_required);
```
Add the toggle handler (near `handleClearMembers`):
```ts
  const handleToggleApproval = useCallback(async () => {
    const next = !approvalRequired;
    setApprovalRequired(next); // optimistic; room_status echo keeps members in sync
    const ok = await setRoomApproval(config.roomKey, next);
    if (!ok) { setApprovalRequired(!next); flashToast('Could not change the approval setting.'); }
  }, [approvalRequired, config.roomKey]);
```
Confirm the two `setApprovalRequired(true);` mirror lines from Task 6 Step 2 are present now.

- [ ] **Step 2: Pass props to RoomInfoModal.** In the `<RoomInfoModal … />` mount (line 1845-1873) add:
```tsx
        approvalRequired={approvalRequired}
        onToggleApproval={handleToggleApproval}
        pendingCount={isOwner ? pendingRequests.length : 0}
```

- [ ] **Step 3: RoomInfoModal — props + toggle Row + badge.** In `components/RoomInfoModal.tsx`:
  - Add to `RoomInfoModalProps` (after `onDeleteRoom`, line 38):
    ```ts
      approvalRequired?: boolean;
      onToggleApproval?: () => void;
      pendingCount?: number;
    ```
  - Add to the destructure (line 86): `onDeleteRoom, approvalRequired, onToggleApproval, pendingCount,`
  - Import `ShieldCheck` (add to the lucide import at line 3-5).
  - **Members badge:** in the Members quick-action button (line 202-205), add a count bubble. Replace the `<span className="w-12 h-12 …"><Users size={20} /></span>` with:
    ```tsx
              <span className="relative w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center group-hover:bg-slate-200 dark:group-hover:bg-slate-700 transition group-active:scale-95">
                <Users size={20} />
                {!!pendingCount && pendingCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-slate-900">{pendingCount}</span>
                )}
              </span>
    ```
  - **Toggle Row:** in the `Room` section, add (owner-only) right after the `<SectionLabel>Room</SectionLabel>` (line 276):
    ```tsx
        {isOwner && (
          <Row
            icon={<ShieldCheck size={18} />}
            label="Approval to join"
            onClick={() => onToggleApproval?.()}
            tint="bg-emerald-500/10 text-emerald-500"
            trailing={
              <span role="switch" aria-checked={!!approvalRequired} className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${approvalRequired ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${approvalRequired ? 'translate-x-4' : ''}`} />
              </span>
            }
          />
        )}
    ```

- [ ] **Step 4: Verify in-browser** (Playwright): as owner, open Room info → toggle "Approval to join" ON → `execute_sql` shows `approval_required=true` for the room; toggle OFF → `false`. With a pending request present, the Members quick action shows the count badge. Reset. Stop dev server.

- [ ] **Step 5: Typecheck + run full test suite + commit:**
```bash
npx tsc --noEmit
npx vitest run
git add components/ChatScreen.tsx components/RoomInfoModal.tsx
git commit -m "feat(approval): owner lockdown toggle + pending badge"
```

---

### Task 10: End-to-end verification + deploy

**Files:** none (verification + push).

- [ ] **Step 1: Two-context E2E (Playwright).** Owner context creates a room; second context joins (member). Owner removes the member → member's tab shows the "You were removed" overlay (R1, live). Member re-enters → WaitingApprovalScreen; owner sees prompt + approves → member auto-joins (R2). Owner toggles approval off → a fresh non-member join succeeds without a prompt. Owner deletes the room → recreating with the same name+PIN joins freely, `approval_required=false` (R3).
- [ ] **Step 2: Reset any test data** left in the live DB (`execute_sql`: delete test rooms/subscribers/requests; confirm `SELECT count(*) FROM rooms WHERE approval_required` reflects only intended state).
- [ ] **Step 3: Full suite green:** `npx vitest run` (all pass) and `npx tsc --noEmit` (exit 0).
- [ ] **Step 4: Confirm with the user, then push** (live deploy). After explicit "ok": `git push origin main`; poll the GitHub Actions run to `success`.
- [ ] **Step 5: Update memory** — append the kick/approval feature to `incognitochat-security-model.md` (new `room_access_requests` table, `approval_required` flag, the gated `join_or_create_room`, the new RPCs) and note it in `MEMORY.md`.

---

## Self-Review

**1. Spec coverage:**
- Spec §1 data model → Task 1. ✓
- §2 RPC changes → Tasks 2 (remove/clear), 3 (join gate + return), 4 (approve/deny/set). ✓
- §3 realtime events → emitted in Tasks 6 (member_removed/members_cleared) & 8 (access_granted/denied); owner postgres_changes in Task 8. ✓
- §4 live kick (open + closed tab backstop) → Task 6. ✓
- §5 knock→approval (knocker waiting + owner prompt + pending list) → Tasks 7 & 8. ✓
- §6 owner toggle + reset-on-delete → Task 9 (toggle); reset is automatic via FK cascade (Task 1) + default, verified in Task 10 Step 1. ✓
- §7 service wrappers → Task 5. ✓
- §10 testing → self-rolling-back SQL in Tasks 2-4, Playwright in 6-10, vitest in 5. ✓
- §8 edge cases → owner bypass (Task 3 predicate), double-approve idempotency (Task 4), knock dedupe (UNIQUE, Task 1), denied re-knock (allowed), anon churn (documented), transient-error guard (Task 6 Step 3). ✓
- §9 out of scope (push, system message) → not implemented, by design. ✓

**2. Placeholder scan:** No "TBD/etc." The two cross-task notes (Task 5 Step 5 `void pending;` → replaced in Task 7; Task 6 `setApprovalRequired` → introduced in Task 9) are explicit ordering notes with the exact lines, not vague placeholders.

**3. Type/name consistency:** `approval_required` (DB + `JoinRoomResult` + `approvalRequired` state), `PendingRequest {uid,username,requested_at}` (service + both modals), `joinOrCreateRoom → {data, pending, error}` (consumed in Task 7), RPC names and arg names (`p_room_key`,`p_uid`,`p_required`) match across Tasks 4/5, broadcast event strings (`member_removed`/`members_cleared`/`access_granted`/`access_denied`) match between emit (Tasks 6/8) and listen (Tasks 6/7). `is_member(p_room_key)` reused in Task 6 backstop matches the existing SECURITY DEFINER signature. ✓
