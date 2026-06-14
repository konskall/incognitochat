# Monetization Phase 1 — DB migrations (live, Supabase-managed)

Recorded for reproducibility; migrations are not git-tracked. Each section is the
exact SQL applied + its verification result.

## monetization_p1_subscriptions_table
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
drop policy if exists subs_select_own on public.subscriptions;
create policy subs_select_own on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create index if not exists idx_subscriptions_stripe_customer on public.subscriptions (stripe_customer_id);
```
Verify: tbl=1, policies=1, rls_on=true, write_policies=0. ✅

## monetization_p1_subscriptions_updated_at_trigger
```sql
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();
```
Verify: updated_at_overridden=t, leaked=0. ✅ (review fix: updated_at would otherwise freeze at insert time)

## monetization_p1_rooms_columns_and_index
```sql
alter table public.rooms add column if not exists expires_at timestamptz;
alter table public.rooms add column if not exists locked boolean not null default false;
create index if not exists idx_messages_uid_room_created
  on public.messages (room_key, uid, created_at);
create index if not exists idx_rooms_expires_at on public.rooms (expires_at)
  where expires_at is not null;
```
Verify: has_expires=1, has_locked=1, rooms_with_expiry=0 (NO backfill), locked_rooms=0, both indexes present. ✅

## monetization_p1_effective_tier
```sql
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
Verify: none=free, active=ultra, cancel_future=ultra, cancel_past=free; leaked_subs=0, leaked_users=0. ✅

## monetization_p1_message_quota_trigger
```sql
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
Verify: free_11th_blocked=t, ultra_unlimited=t, system_exempt=t, leaked_rooms/subs/users all 0. ✅
