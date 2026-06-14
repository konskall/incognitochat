# Monetization Phase 2 — DB migrations + Stripe setup (live, Supabase-managed)

## monetization_p2_stripe_events
```sql
create table if not exists public.stripe_events (
  id          text primary key,
  type        text,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
```
Verify: tbl=1, rls_on=true, policies=0. ✅
