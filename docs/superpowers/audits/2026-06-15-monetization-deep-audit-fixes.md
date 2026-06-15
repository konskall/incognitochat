# Monetization deep-audit fixes (2026-06-15)

Fixes applied after the 6-area deep audit (client + Stripe edge fns + live DB),
every finding adversarially verified. Verdict was **0 critical / 0 confirmed-high**
(both "high" claims downgraded to medium); security posture confirmed strong
(no tier-forgery path — `subscriptions` RLS is SELECT-only, webhook writes via
service-role, all SECURITY DEFINER fns pin `search_path`).

## Live DB change (Supabase-managed)

### CG-6 — `attachments` bucket hard size cap
The file-size tier limit (10MB Free/Basic, 40MB Ultra) was **client-only** and
the `attachments` bucket had `file_size_limit = null` (unlimited), so a client
edit or the voice/avatar/background upload paths could push an arbitrarily large
object into the public bucket. Set a hard server ceiling above the top tier:

```sql
update storage.buckets set file_size_limit = 47185920 where id = 'attachments'; -- 45 MB
```

This stops gross abuse (e.g. GB-scale uploads) server-side while leaving headroom
for the 40MB Ultra tier. NOTE: the *per-tier* distinction (Free/Basic 10MB vs
Ultra 40MB) remains **client-enforced** — like P2P calls, by design. True per-tier
server enforcement would require a signed-upload edge function that checks
`effective_tier(auth.uid())` against the file size (deferred; not worth the
upload-breakage risk of an RLS size predicate on a live app).

## Edge functions redeployed

- **get-prices** (v2, verify_jwt=false) — SEW-4: module-scope 5-min TTL cache so
  warm isolates don't hit Stripe on every public call.
- **create-checkout-session** (v11, verify_jwt=true) — SEW-3: resolve the Stripe
  customer authoritatively from `subscriptions.stripe_customer_id` (service-role)
  before the eventually-consistent metadata search/create, avoiding orphaned
  duplicate customers on a rapid double-submit. SEW-5: build success/cancel URLs
  via the URL API (`searchParams.set`) so an APP_URL with a query/fragment can't
  produce a malformed double-separator URL.
- **create-portal-session** (v9, verify_jwt=true) — SEW-5: same URL-API return_url.

## Client fixes (see git commit)

- BF-1/BF-2: checkout resume gated on `SIGNED_IN` only + shares the `checkoutBusy`
  guard; stale `pendingCheckoutTier` cleared on room-join / goToLanding.
- BF-3/CG-5: softened ?checkout=success toast + bounded post-checkout entitlement
  poll (`postCheckoutPoll` marker → useEntitlements polls until tier upgrades).
- CG-1: poll creation routes QT001/QT002 through the upgrade funnel + bumps quota.
- CG-2: voice / location sends map QT001/QT002 instead of misleading/silent fail.
- CALL-ACCEPT-GATE: incoming-call **accept** now tier-gated (was init-only).
- CLC-1: free room-rename QT004 → upgrade prompt (was a raw alert).
- CG-7: QT001 copy reworded (owner-scoped lock, not a viewer-upgrade promise).
- CG-4: parseTierError only message-matches when there's no SQLSTATE.
- ENT-DOUBLE-REFETCH: useEntitlements in-flight dedupe (focus+visibility).
- usePrices: module-level shared cache (one fetch across mounts).
- UpgradeModal: grammar ("— available on … for €X/month"), graceful price-while-
  loading, iOS body-scroll-lock.

## Intentionally NOT changed (verified by-design / refuted)
- ENT-3: grace-expiry doesn't re-lock excess Free rooms — intentional "never
  auto-lock" stance (would need a pg_cron sweep).
- ENT-5 / CG-3: client clock skew & the entLoading call window — client-only call
  gate is accepted-by-design (P2P, zero server cost).
- BF-4: popstate clearing `hasSeenLanding` — refuted (intended routing behavior).
