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
