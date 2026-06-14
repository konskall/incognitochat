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

## monetization_p1_message_quota_errcodes
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
    raise exception 'ROOM_LOCKED' using errcode = 'QT001';
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
    raise exception 'QUOTA_EXCEEDED:%', v_tier using errcode = 'QT002';
  end if;

  return NEW;
end; $$;
```
Error-code contract: QT001=ROOM_LOCKED, QT002=QUOTA_EXCEEDED:<tier>. Verify: quota_sqlstate=QT002, locked_sqlstate=QT001, no leaks. ✅ (review fix: stable SQLSTATE instead of message-string parsing)

## monetization_p1_room_tier_guard
```sql
create or replace function public.enforce_room_tier()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_tier text := public.effective_tier((select auth.uid()));
begin
  if ( (NEW.ai_enabled is distinct from OLD.ai_enabled and coalesce(NEW.ai_enabled,false) = true)
       or NEW.ai_avatar_url is distinct from OLD.ai_avatar_url )
     and v_tier <> 'ultra' then
    raise exception 'TIER_REQUIRED:ai' using errcode = 'QT004';
  end if;

  if ( NEW.message_ttl_seconds is distinct from OLD.message_ttl_seconds
       or NEW.auto_delete_seconds is distinct from OLD.auto_delete_seconds
       or NEW.avatar_url        is distinct from OLD.avatar_url
       or NEW.background_type    is distinct from OLD.background_type
       or NEW.background_preset  is distinct from OLD.background_preset
       or NEW.background_url     is distinct from OLD.background_url
       or NEW.display_name       is distinct from OLD.display_name )
     and v_tier = 'free' then
    raise exception 'TIER_REQUIRED:basic' using errcode = 'QT004';
  end if;

  return NEW;
end; $$;

drop trigger if exists trg_enforce_room_tier on public.rooms;
create trigger trg_enforce_room_tier
  before update on public.rooms
  for each row execute function public.enforce_room_tier();
```
Error code: QT004=TIER_REQUIRED:<feature>. Verify: free_state=QT004 (appearance blocked), basic_ai_state=QT004 (AI blocked below ultra), ultra_ok=t, lock_ok=t (reconcile path ungated), no leaks. ✅

## monetization_p1_join_or_create_room_caps
```sql
create or replace function public.join_or_create_room(p_room_key text, p_room_name text, p_pin text, p_username text, p_create_if_missing boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
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
        and (expires_at is null or expires_at > now());
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
Error code: QT003=ROOM_LIMIT:<tier>. Verify: free 2nd room blocked (QT003) + first room 24h expiry; ultra 2 rooms ok + expires_at NULL; JSON shape unchanged; no leaks. ✅
