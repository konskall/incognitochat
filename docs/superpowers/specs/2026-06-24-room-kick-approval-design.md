# Room Kick Enforcement + Re-entry Approval — Design

**Goal:** When a room owner removes a member or clears all members, the affected users are ejected live (even if their tab was closed), the room enters an "approval-required" lockdown, and any subsequent join attempt by a non-member must be approved by the owner via an in-app prompt. Deleting the room resets everything so it can be recreated freely.

**Architecture:** A room-level `approval_required` flag plus a `room_access_requests` table model the lockdown. The single membership choke point — the `join_or_create_room` SECURITY DEFINER RPC — gates entry: while locked, a non-member's join writes a pending request instead of a membership row. Live ejection and the approve/deny handshake ride the existing `room_status:${roomKey}` broadcast channel; the owner is notified of new requests via a postgres_changes subscription on `room_access_requests`. All state is FK'd to `rooms` with `ON DELETE CASCADE`, so room deletion auto-resets the gate.

**Tech Stack:** React 18 + TS + Vite (GitHub Pages SPA), Supabase Postgres + RLS + Realtime, Supabase Auth (Google + anonymous). Migrations applied live via the Supabase `apply_migration` MCP tool.

## Global Constraints

- **Membership model is unchanged and binary:** `is_member(room_key)` = "a row exists in `subscribers(room_key, uid)`". Pending knockers are NOT members (no subscriber row) → RLS keeps them out of all reads/writes automatically. Do **not** add a status column to `subscribers` and do **not** modify `is_member`.
- **The only path that creates membership rows is `join_or_create_room`** (and `get_or_create_notes_room`). `subscribers` has no INSERT RLS policy. Gate re-entry inside the SECURITY DEFINER RPC, never in client code.
- **Owner = `rooms.created_by = auth.uid()`.** Owner-gated RPCs are granted to `anon` + `authenticated` and enforce ownership *inside the body* (mirror `remove_room_member` / `clear_room_members`).
- **Never backfill `rooms.expires_at`, never auto-lock existing rooms.** The new `approval_required` column defaults `false`; do not set it on any existing room during migration.
- New RPCs follow the established pattern: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, owner-gate via `created_by = auth.uid()`, `GRANT EXECUTE TO anon, authenticated`.
- All behavioral DB checks during implementation must **self-roll-back** (BEGIN … ROLLBACK), using a real `auth.users.id` for any `rooms.created_by` (FK), and fabricated text uids for non-owners (no FK on `subscribers.uid` / `room_access_requests.uid`).
- UI copy in English; conversation in Greek.

## Design Decisions (confirmed with user)

1. **Scope = room-level lockdown.** Once the owner does *any* remove/clear, the room flips to `approval_required = true`; thereafter **every** non-member join (even a brand-new user with the correct PIN) needs approval — not just previously-removed uids.
2. **Admin-offline notification = in-app only (v1).** Owner sees a pop-up + a pending list when in the app. No push edge function in v1 (documented as a future add-on).
3. **Knocker experience = live wait + auto-join.** The knocker sees a "Waiting for approval" screen and is auto-admitted via realtime when approved; a light poll is the backstop if the broadcast is missed.

---

## 1. Data model

### 1a. `rooms.approval_required`
```sql
ALTER TABLE public.rooms
  ADD COLUMN approval_required boolean NOT NULL DEFAULT false;
```
Additive, default `false` — no existing room is affected (constraint: never auto-lock).

### 1b. New table `room_access_requests` (pending knocks)
```sql
CREATE TABLE public.room_access_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_key     text NOT NULL REFERENCES public.rooms(room_key) ON DELETE CASCADE,
  uid          text NOT NULL,
  username     text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (room_key, uid)
);
ALTER TABLE public.room_access_requests ENABLE ROW LEVEL SECURITY;
```
- `ON DELETE CASCADE` → deleting the room clears all pending requests (R3, for free).
- `UNIQUE(room_key, uid)` → re-knocking updates the existing row (no duplicate prompts).
- Added to the `supabase_realtime` publication so the owner can subscribe via postgres_changes:
  ```sql
  ALTER PUBLICATION supabase_realtime ADD TABLE public.room_access_requests;
  ```

### 1c. RLS policies on `room_access_requests`
```sql
-- Owner sees their room's pending requests; a requester sees only their own.
CREATE POLICY rar_select_owner_or_self ON public.room_access_requests
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.rooms r
            WHERE r.room_key = room_access_requests.room_key
              AND r.created_by = (SELECT auth.uid()))
    OR uid = (SELECT auth.uid())::text
  );
```
No INSERT/UPDATE/DELETE policies → the table is mutated **only** through SECURITY DEFINER RPCs (mirrors the `subscribers` choke-point pattern). The owner SELECT path is what makes the postgres_changes owner subscription deliver rows.

---

## 2. Server RPCs

### 2a. Modify `remove_room_member(p_room_key, p_uid)` and `clear_room_members(p_room_key)`
Keep existing owner-gate (`NOT_OWNER`) and, for remove, `CANNOT_REMOVE_SELF`. After the existing `DELETE FROM subscribers …`, add:
```sql
UPDATE public.rooms SET approval_required = true WHERE room_key = p_room_key;
```
(For `clear_room_members`, the client still re-subscribes the owner afterward via `join_or_create_room`; the owner is exempt from the gate — see 2b.)

### 2b. Modify `join_or_create_room(...)` — the gate
In the **existing-room** branch, after the `WRONG_PIN` check and **before** the `INSERT INTO subscribers … ON CONFLICT`:
```sql
-- Owner and existing members are never gated.
IF v_room.approval_required
   AND v_room.created_by IS DISTINCT FROM v_uid
   AND NOT EXISTS (SELECT 1 FROM public.subscribers s
                   WHERE s.room_key = p_room_key AND s.uid = v_uid::text)
THEN
  INSERT INTO public.room_access_requests (room_key, uid, username)
  VALUES (p_room_key, v_uid::text, p_username)
  ON CONFLICT (room_key, uid)
    DO UPDATE SET username = EXCLUDED.username, requested_at = timezone('utc', now());
  RETURN jsonb_build_object('pending', true, 'room_name', v_room.room_name);
END IF;
```
- PIN is still validated first → you must know the PIN to even knock.
- Owner (`created_by`) and anyone already holding a subscriber row bypass entirely (covers owner re-subscribe after clear, and normal member refresh).
- Room *creation* path is unaffected (a brand-new room has `approval_required = false`).
- The **success** return of `join_or_create_room` must additionally include `approval_required` in its room payload, so the client can render the owner toggle (§6) and gate state without a second query. This is an additive field on the existing JSON return.

### 2c. New `approve_access_request(p_room_key text, p_uid text) → jsonb`
Owner-gate (`NOT_OWNER`). Reads the pending row's username, grants membership, deletes the request:
```sql
INSERT INTO public.subscribers (room_key, uid, username)
SELECT p_room_key, p_uid, username FROM public.room_access_requests
  WHERE room_key = p_room_key AND uid = p_uid
ON CONFLICT (room_key, uid) DO UPDATE SET username = EXCLUDED.username;
DELETE FROM public.room_access_requests WHERE room_key = p_room_key AND uid = p_uid;
RETURN jsonb_build_object('approved', true);
```
(If no pending row exists, it is a no-op returning `approved:false` — idempotent against double-approve.)

### 2d. New `deny_access_request(p_room_key text, p_uid text) → jsonb`
Owner-gate, then `DELETE FROM room_access_requests WHERE room_key=p_room_key AND uid=p_uid;` Returns `{denied:true}`. A denied user may knock again (this is an approval gate, not a permanent ban).

### 2e. New `set_room_approval(p_room_key text, p_required boolean) → jsonb`
Owner-gate, then `UPDATE rooms SET approval_required = p_required WHERE room_key = p_room_key;` Lets the owner turn lockdown off (un-stick the room without deleting it) or on manually.

### 2f. GRANTs
`GRANT EXECUTE ON FUNCTION approve_access_request, deny_access_request, set_room_approval TO anon, authenticated;` (ownership enforced inside each body). `room_members` and the read path are unchanged.

> **Optional convenience RPC:** `list_access_requests(p_room_key)` (owner-gated, returns pending rows). Not strictly required — the owner can read via the `rar_select_owner_or_self` RLS policy directly — but a SECURITY DEFINER reader keeps the client query trivial and consistent with `room_members`. Decide at plan time; default to using the RLS SELECT directly to minimize surface.

---

## 3. Realtime events (on the existing `room_status:${roomKey}` broadcast channel)

Client-emitted by the owner **after** the corresponding RPC succeeds (mirrors how `room_deleted` is broadcast after the delete):

| Event | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `member_removed` | `{ uid }` | owner, after `remove_room_member` | the removed user's live tab → eject overlay |
| `members_cleared` | `{}` | owner, after `clear_room_members` | all non-owner live tabs → eject overlay |
| `access_granted` | `{ uid }` | owner, after `approve_access_request` | the knocker's waiting screen → auto-join |
| `access_denied` | `{ uid }` | owner, after `deny_access_request` | the knocker's waiting screen → denied message |

Owner notification of **new** knocks uses postgres_changes (not broadcast): the owner subscribes to `INSERT` on `room_access_requests` filtered `room_key=eq.${roomKey}` (RLS delivers only their room's rows).

Broadcast is best-effort (only reaches connected tabs); every consumer therefore has a non-realtime backstop (§4, §5).

---

## 4. Live kick enforcement (R1)

**Open tab (instant):** ChatScreen's `room_status` channel handler (currently `components/ChatScreen.tsx:1004-1046`) gains two listeners:
- `member_removed` → `if (payload.uid === user.uid) setAccessError('You were removed from this room.')`
- `members_cleared` → `if (user.uid !== roomCreatorId) setAccessError('You were removed from this room.')`

Reuse the existing blocking `accessError` overlay (`ChatScreen.tsx:1578-1600`) which traps focus and offers "Return to Home". The owner emits these in `handleRemoveMember` (`:1091-1103`) and `handleClearMembers` (`:1071-1086`) via `roomStatusChannelRef.current?.send(...)` after the RPC resolves. The owner ignores `members_cleared` (it re-subscribes itself).

**Closed/backgrounded tab (backstop):** broaden `checkRoomStatus` (`ChatScreen.tsx:662-675`, bound to `focus`/`visibilitychange` at `:744-759`) to also verify own membership (a lightweight `is_member` RPC call). On a *confirmed* `false` with no error (mirroring the existing room-absent guard, so transient errors never eject) → `setAccessError('You were removed from this room.')`. This catches kicks missed while disconnected and covers `clear_room_members`. Server-side, RLS already blocks the removed user's reads/writes the instant their row is gone, so no data leaks in the gap.

> A fresh full re-entry by a removed user (reload) goes through `initRoom` → `join_or_create_room`, which now returns `pending` (room is locked) → the knock/waiting flow (§5), not the eject overlay. The overlay is specifically for the *live* session.

---

## 5. Knock → approval handshake (R2)

### Knocker side
`initRoom` (`ChatScreen.tsx:677-742`) inspects the `join_or_create_room` result: if `result.pending === true`, set new state `pendingApproval = true` instead of `isRoomReady`. Render a new **`WaitingApprovalScreen`** overlay ("Waiting for the admin to approve your access…", with a Cancel/Return-home button). While shown it:
- subscribes to `room_status` and reacts to `access_granted` (`payload.uid === user.uid` → re-run `initRoom`; membership now exists → enters the room) and `access_denied` (`uid === me` → show "Access denied" then `onExit`).
- polls `join_or_create_room` (createIfMissing=false) every ~5 s as a backstop; once approved the RPC returns the room (member row exists) → enter. This guarantees admission even if the broadcast was missed.

### Owner side
When `isOwner`, ChatScreen:
- subscribes to postgres_changes `INSERT` on `room_access_requests` (filter `room_key=eq.${roomKey}`) → pushes onto a `pendingRequests` state and shows an **`AccessRequestPrompt`** dialog ("`<username>` wants to join — Approve / Deny").
- fetches existing pending requests on mount and when the Members modal opens (via the RLS SELECT).
- `handleApprove(uid)` → `approve_access_request` RPC → broadcast `access_granted{uid}` → remove from list. `handleDeny(uid)` → `deny_access_request` RPC → broadcast `access_denied{uid}` → remove from list.
- A pending-count **badge** on the Members quick-action (`RoomInfoModal.tsx:202-205`) and a **"Pending requests" section** inside `MembersHistoryModal` (reusing its inline Approve/Deny confirm pattern, alongside the existing remove/clear controls).

Pending users are not members → `room_members` does not list them; they appear only in the pending section.

---

## 6. Owner lockdown toggle + reset (R3)

- **Toggle:** a new owner-only `Row` in `RoomInfoModal` "Room" section: **"Approval to join" On/Off** (mirrors the Inco AI `role="switch"` Row). Reads `rooms.approval_required` (surfaced into ChatScreen room state from the join payload at `:717`, and kept live by adding `approval_required` to the existing `room_status` UPDATE-on-`rooms` propagation at `:1023-1042`). Toggling calls `set_room_approval`. Without this, a single remove would lock the room until deletion — the toggle is the off-switch.
- **Reset on delete:** `approval_required` is a column on `rooms` and `room_access_requests` cascade-deletes with the room. Deleting the room (existing `handleDeleteChat`, `:1303-1347`) removes all of it; recreating the same `room_key` yields a fresh row with `approval_required = false` and zero requests — no entry restriction, exactly as required.

---

## 7. Client service wrappers (`services/supabase.ts`)

- `joinOrCreateRoom` (`:34-59`): return type extended to surface `{ pending: true, room_name }`; callers (`initRoom`) branch on it.
- New thin wrappers: `approveAccessRequest(roomKey, uid)`, `denyAccessRequest(roomKey, uid)`, `setRoomApproval(roomKey, required)`, and a pending-requests fetch (RLS SELECT on `room_access_requests`).

`App.tsx` needs no routing change — the pending state is handled inside ChatScreen's overlay layer, exactly like `roomDeleted`/`accessError`.

---

## 8. Edge cases

- **Owner after `clear_room_members`:** owner re-subscribes via `join_or_create_room`; `created_by` bypass means it succeeds despite `approval_required = true`.
- **Double approve / approve-then-already-member:** `INSERT … ON CONFLICT DO UPDATE` is idempotent; deleting an absent request is a no-op.
- **Knock spam:** `UNIQUE(room_key, uid)` collapses repeat knocks to one row (updates `requested_at`); the owner sees one entry. (A per-knocker cooldown is deferred — not needed for v1's small private rooms.)
- **Denied user re-knocks:** allowed (approval gate, not a ban); owner can deny again.
- **Anonymous identity churn:** a removed anonymous user can return with a new `uid` (new browser/incognito). Under lockdown this does **not** grant free entry — they still appear as a pending request and need approval; the residual risk is only that the owner may not recognize them. Documented, accepted (no durable identity exists for anonymous users; PIN + approval remain the controls). Google-account owners/members are robust.
- **Transient network/RLS error in the membership backstop:** must never eject — only a confirmed `is_member = false` with no error ejects (mirrors the existing room-absent guard).

---

## 9. Out of scope (future)

- **Push notification to an offline owner** (a `knock-room` edge function targeting `created_by`'s `push_subscriptions`). Deferred to v2; v1 is in-app only. (Mapping notes the plumbing is ~80% present but needs single-user targeting + a non-`is_member` authz path + the anon-owner instability caveat.)
- Actionable Approve/Deny buttons inside the push notification (SW work, iOS-shaky).
- System message in the transcript ("X was removed" / "room locked"). The removed user's overlay is the required "corresponding message"; an optional transcript note can be added later via the existing `sendMessage(..., 'system')` path.

---

## 10. Testing strategy

**Server (self-rolling-back SQL, applied via MCP `execute_sql` inside BEGIN…ROLLBACK):**
- A real `auth.users.id` for `rooms.created_by`; fabricated text uids for non-owners.
- `join_or_create_room`: (a) locked room + non-member + correct PIN → returns `pending:true` and writes one request row; (b) owner joins locked room → membership granted, no request; (c) existing member re-joins locked room → membership kept, no request; (d) WRONG_PIN still fails before any request is written.
- `remove_room_member` / `clear_room_members` → `approval_required` becomes `true`.
- `approve_access_request` → subscriber row created, request row gone. `deny_access_request` → request row gone, no subscriber. `set_room_approval` → flag toggles. All owner-gated (`NOT_OWNER` for a non-owner caller).
- RLS: owner can SELECT their room's requests; a requester sees only their own; a third party sees none.
- Confirm 0 leftover rows after ROLLBACK.

**Client (Playwright against `npm run dev`):**
- Removed user's open tab shows the eject overlay on `member_removed`.
- A locked-room join lands on the WaitingApprovalScreen; owner approves → knocker auto-enters.
- Owner sees the AccessRequestPrompt on a new knock and the pending badge/section in the Members modal.
- Lockdown toggle flips `approval_required` and a subsequent non-member join is gated/ungated accordingly.

**Unit:** extend existing vitest where pure helpers are added (e.g. result-shape parsing of `joinOrCreateRoom`).

## 11. Safety checklist (carried into the plan)

- Migration is additive (`ADD COLUMN DEFAULT false`, new table) — no data rewrite, no `expires_at` backfill, no existing room locked.
- RPC changes via `CREATE OR REPLACE FUNCTION` preserving signatures, owner-gates, and grants.
- `verify_jwt` and edge functions are untouched (no edge work in v1).
- Push-to-main only after browser + SQL verification and explicit user confirmation (live deploy).

---

## Appendix A — applied DDL

Migration name: `add_room_approval_and_requests` — applied 2026-06-24 via Supabase MCP `apply_migration`.

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

### Task 3 — join_gate_on_approval

Migration name: `join_gate_on_approval` — applied 2026-06-24 via Supabase MCP `apply_migration`.

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

### Task 4 — access_request_rpcs

Migration name: `access_request_rpcs` — applied 2026-06-24 via Supabase MCP `apply_migration`.

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

### Task 2 — lockdown_on_remove_clear

Migration name: `lockdown_on_remove_clear` — applied 2026-06-24 via Supabase MCP `apply_migration`.

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
