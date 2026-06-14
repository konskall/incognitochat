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

## Edge functions deployed (live, via MCP)
- `create-checkout-session` — verify_jwt=true (v2, null-URL guard). 503 STRIPE_NOT_CONFIGURED until secrets set.
- `stripe-webhook` — **verify_jwt=false** (public; v2, malformed-uid guard + reconcile-retry). Smoke test returned 503 (not 401 → confirmed public).
- `create-portal-session` — verify_jwt=true (v1). 503 until secrets set.

## Stripe setup (USER ACTION — required before end-to-end test)
Do this in Stripe **Test mode** first.
1. Create/open a Stripe account → switch to **Test mode**.
2. Create two Products with recurring **monthly EUR** prices (amounts your choice):
   - "Incognito Basic" → copy its **Price ID** (`price_…`) → `STRIPE_PRICE_BASIC`.
   - "Incognito Ultra" → copy its **Price ID** → `STRIPE_PRICE_ULTRA`.
3. Developers → API keys → copy the **Secret key** (`sk_test_…`) → `STRIPE_SECRET_KEY`.
4. Developers → Webhooks → **Add endpoint**:
   - URL: `https://qygirixqsuraclbdfnjp.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`.
   - Copy the **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
5. Settings → Billing → **Customer portal** → activate (allow cancellation + invoice history).
6. Set the 5 secrets in Supabase (Dashboard → Project Settings → Edge Functions → Secrets, or CLI):
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_ULTRA`,
   `APP_URL=https://konskall.github.io/incognitochat/`.

Once secrets are set + webhook registered → resume at Task 6 (end-to-end test in Stripe test mode).

## End-to-end test (Stripe test mode) — PASSED ✅
Real test checkout (card 4242…) by a Google user:
- `subscriptions`: 1 row — tier=`basic`, status=`active`, current_period_end ≈ +1 month, cancel_at_period_end=false, stripe_customer_id + stripe_subscription_id set. `updated_at` > `created_at` (updated_at trigger fired on the follow-up events).
- `public.effective_tier(user_id)` = **`basic`** ✅
- `stripe_events`: 4 events recorded idempotently for the one subscription —
  `invoice.paid`, `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated` — all converged onto the single subscriptions row
  via onConflict(user_id) (out-of-order tolerant). No duplicates, no errors.

### Bug found + fixed during e2e: `APP_URL` url_invalid
First checkout returned 500. Diagnostic build pinpointed `step=checkout_create`,
`StripeInvalidRequestError: "Not a valid URL"` (`url_invalid`). Cause: the
`success_url`/`cancel_url` were `${APP_URL}?...` and the `?? default` fallback only
guards null/undefined — a malformed/empty `APP_URL` secret produced an invalid URL.
Fix (commit `367892c`): both checkout + portal now `trim()` + `new URL()`-validate
APP_URL and fall back to the prod origin. Redeployed checkout v9 / portal v7.

### Cancel path verified ✅
Cancelled the test subscription via the Customer Portal → webhook received 2
`customer.subscription.updated` events → subscriptions row synced to
`cancel_at_period_end=true` (status stays `active`, current_period_end unchanged) →
`effective_tier` remains `basic` until the period end, then auto-reverts to `free`
(grace behavior working as designed). Final function state: create-checkout-session
& create-portal-session verify_jwt=true, stripe-webhook verify_jwt=false — all ACTIVE.
Phase 2 complete.
