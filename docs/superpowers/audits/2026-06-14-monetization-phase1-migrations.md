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
