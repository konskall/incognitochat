# Session record — 2026-06-13 (re-audit fixes, realtime typing/Seen, DB cleanup)

Durable record of everything done this session. Code is in git (commits below).
DB migrations are Supabase-managed (not otherwise in the repo) — their SQL is
captured here for reproducibility. One-off data cleanups are logged with counts.

## Code (committed + pushed to `main`)

- `f2bdc16` spec, `06a13f1` plan — dashboard live "room deleted".
- `edad146`,`010f247`,`588356d`,`c1ba97c`,`be9fd91` — **dashboard live deleted-room
  card** (re-create / dismiss) via `room_deleted` broadcast on `room_status:<key>`;
  new `utils/roomLifecycle.ts`.
- `833559c`,`0248fd5`,`f2d74dd`,`47d9ae6` — **typing indicator fix**: moved from
  presence-meta to **Realtime broadcast** (`event:'typing'`). Root cause: Supabase
  presence does NOT propagate same-key meta UPDATES (only join/leave + initial), so
  the heartbeat/stop re-tracks never reached observers and the onlineAt-freshness
  scheme expired live typers. Confirmed with live 2-client console instrumentation.
- `5833f6f` — **"Seen" receipts** moved to broadcast (`event:'read'`, same root
  cause as typing) + **push FK (23503)** silenced/gated (subscribe waits for
  `isRoomReady`; benign FK no longer logged).

(Earlier same-day full-app re-audit fixes are in `docs/.../2026-06-13-focused-reaudit.md`.)

## DB migrations applied this session (live, in `supabase_migrations`)

### `audit_2026_06_13b_reaudit_authz_hardening` (20260613101803)
```sql
-- messages: lock direct member UPDATE to the edit path only (poll/reactions/uid/
-- type tampering go through the SECURITY DEFINER RPCs).
revoke update on public.messages from anon, authenticated;
grant update (text, is_edited) on public.messages to anon, authenticated;
-- rooms: (column-level revoke here was a NO-OP because a table-level grant existed;
-- the real lockdown is migration 13c below.)
revoke update (pin, created_by, room_key, created_at, room_name)
  on public.rooms from anon, authenticated;
-- vote_poll / toggle_reaction / set_poll_closed: added `... for update` row locks
-- to the message SELECT (kills the lost-update race). Full bodies unchanged
-- otherwise; see live DB (pg_get_functiondef) for the complete definitions.
-- perf: covering index for the room_settings -> rooms ON DELETE CASCADE FK.
create index if not exists idx_room_settings_room_key on public.room_settings (room_key);
```

### `audit_2026_06_13c_rooms_table_level_update_fix` (20260613101950)
```sql
-- A column-level REVOKE is a no-op while a TABLE-level UPDATE grant exists.
-- Drop the table grant, then grant only the cosmetic/settings columns — this is
-- what actually blocks PIN tampering / created_by hijack / room_name rename-bypass.
revoke update on public.rooms from anon, authenticated;
grant update (
  ai_avatar_url, ai_enabled, auto_delete_seconds,
  avatar_url, background_preset, background_type, background_url,
  display_name, message_ttl_seconds, pinned_message_id
) on public.rooms to anon, authenticated;
```

### `cleanup_abandoned_anon_users_cron` (20260613153755)
```sql
create or replace function public.cleanup_abandoned_anon_users()
returns integer language plpgsql security definer
set search_path = 'public','auth','pg_temp'
as $function$
declare v_deleted integer;
begin
  with d as (
    delete from auth.users u
    where u.is_anonymous
      and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '7 days'
      and not exists (select 1 from public.subscribers s where lower(s.uid) = lower(u.id::text))
      and not exists (select 1 from public.push_subscriptions p where p.user_id = u.id)
      and not exists (select 1 from public.rooms r where r.created_by = u.id)
    returning 1
  )
  select count(*) into v_deleted from d;
  return v_deleted;
end; $function$;
revoke execute on function public.cleanup_abandoned_anon_users() from public, anon, authenticated;
-- daily 03:17 UTC (pg_cron jobid 4)
select cron.schedule('cleanup-abandoned-anon-users','17 3 * * *',
  $$ select public.cleanup_abandoned_anon_users(); $$);
```

## One-off data cleanups (live DML, irreversible)

1. **System messages** — `delete from public.messages where type='system'` →
   **57 deleted** across 9 rooms (the lingering "user joined/left" noise that the
   UI couldn't remove). 0 remain; 40 real messages kept.
2. **Abandoned anonymous users** — deleted anon `auth.users` with no membership,
   no push subscription, and not a room owner →
   **444 deleted** (456 → 12 users: 2 Google + 10 active anon). subscribers (14),
   push_subscriptions (31), rooms (10), messages (40) all left intact.
   Going forward handled automatically by the daily cron above.

## Storage audit (`attachments` bucket) — no action needed

18 objects: 15 real files all under existing rooms (paginated delete-cleanup is
working — no orphans), + 3 zero-byte `.emptyFolderPlaceholder` markers (harmless;
left as-is — a SQL row-delete would create an inconsistent backend orphan, and the
proper removal needs the Storage API).

## Follow-up fix (later same session): dashboard phantom "unread"

**Symptom:** every already-read room kept showing a permanent unread badge of 1 on
the dashboard; reading the room and leaving never cleared it. Many new peer
messages all showed (correct), but exactly one stuck forever after reading.

**Root cause (proven on live data — 6/6 rooms reproduced):** a timestamp
**precision mismatch**. `messages.created_at` is a microsecond-precision
`timestamptz`; the client stores its read marker as `Date.getTime()`
(`lastRead_<roomKey>` in localStorage) and sent it to the `room_overview` RPC as a
**millisecond**-precise ISO `since`. The RPC counted `created_at > since`, so the
newest message's sub-millisecond remainder (e.g. `.54288` vs stored `.542`) was
always strictly greater than the truncated marker → a phantom unread of (usually)
1 that never cleared.

### `fix_room_overview_unread_ms_precision` (live, in `supabase_migrations`)
```sql
-- room_overview: count unread at MILLISECOND granularity, the only resolution the
-- client read-marker can express (it's Date.getTime()). Was `m.created_at > i.since`.
create or replace function public.room_overview(p_items jsonb) ... -- (full body unchanged except:)
  and date_trunc('milliseconds', m.created_at) > date_trunc('milliseconds', i.since)
```
Verified via the real RPC: simulated "read up to latest" → unread_count **0** for
all 6 rooms (was 1); a genuinely-newer message (since = 2nd-newest) still counts
**1**. Server-side fix → all clients corrected immediately, no localStorage migration.

## Key durable lesson

Supabase Realtime **presence** propagates membership (join/leave) + the initial
meta, but NOT same-key meta UPDATES → use **broadcast** for any live toggling
signal (typing, "Seen"). Presence is now used only for online/membership.

Unread badges compare a **millisecond** client marker against **microsecond**
server `created_at` — always compare at ms granularity (`date_trunc('milliseconds',…)`)
or a sub-ms remainder leaves a permanent phantom unread.
