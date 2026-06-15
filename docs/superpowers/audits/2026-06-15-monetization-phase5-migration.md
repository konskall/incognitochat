# Monetization Phase 5 — DB migration (live, Supabase-managed)

## monetization_p5_messages_sent_today
Read-only helper that drives the per-room daily message-quota counter in the
composer. Reuses the EXACT day expression + system-message exclusion from the
`enforce_message_quota` trigger, so the counter never disagrees with enforcement.
SECURITY DEFINER + filters on `auth.uid()` → only ever returns the CALLER's own
count (no RLS leak). `messages.uid` is text → cast `auth.uid()::text`.

```sql
create or replace function public.messages_sent_today(p_room_key text)
returns int
language sql
security definer
set search_path to 'public', 'pg_temp'
stable
as $$
  select count(*)::int
  from public.messages m
  where m.uid = (select auth.uid())::text
    and m.room_key = p_room_key
    and coalesce(m.type, 'text') <> 'system'
    and m.created_at >= (date_trunc('day', now() at time zone 'Europe/Athens') at time zone 'Europe/Athens');
$$;
grant execute on function public.messages_sent_today(text) to authenticated, anon;
```

Verify: `select public.messages_sent_today('any-room-key');` → `0` (int) in the SQL
editor (auth.uid() is null there). ✅ Real per-user counts are exercised client-side
with a JWT via the `useMessageQuota` hook. Covered by the existing
`idx_messages_uid_room_created (room_key, uid, created_at)` index.
