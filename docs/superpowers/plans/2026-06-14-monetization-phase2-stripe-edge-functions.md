# Monetization Phase 2 — Stripe Edge Functions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Stripe server tier — three Supabase Deno edge functions (`create-checkout-session`, `stripe-webhook`, `create-portal-session`) that turn a Stripe subscription into rows in the Phase-1 `subscriptions` table and run `reconcile_entitlements`, plus a `stripe_events` idempotency table.

**Architecture:** Checkout and Portal functions are authenticated (verify_jwt=true) and called by the client; the webhook is PUBLIC (verify_jwt=false) and authenticates via the Stripe signature. The webhook always re-syncs from Stripe's CURRENT state (retrieve the subscription, map its price → tier, upsert `subscriptions` ON CONFLICT (user_id), then `reconcile_entitlements`) so it is tolerant of out-of-order delivery; an `id`-keyed `stripe_events` table makes it idempotent.

**Tech Stack:** Supabase Edge Functions (Deno), `jsr:@supabase/supabase-js@2`, `https://esm.sh/stripe@17?target=deno` with `createFetchHttpClient()` + `constructEventAsync` + `createSubtleCryptoProvider()`. Deploy via the Supabase `deploy_edge_function` MCP tool. DB migration via `apply_migration`.

**Source spec:** `docs/superpowers/specs/2026-06-14-monetization-tiers-stripe-design.md` §6. Phase-1 carry-forward (from `docs/superpowers/audits/2026-06-14-monetization-phase1-migrations.md`): `subscriptions` table is webhook-written (service-role); `reconcile_entitlements(uuid)` is service-role-only; error-code contract QT001–QT004.

**Repo conventions (from `supabase/functions/notify-room/index.ts`):** `import "jsr:@supabase/functions-js/edge-runtime.d.ts"`; `Deno.serve`; a local `corsHeaders` + `json()` helper per function (functions are self-contained, no shared module); OPTIONS→CORS, POST-only; caller auth via a `createClient(URL, ANON, {global:{headers:{Authorization}}})` + `auth.getUser()`; privileged work via a service-role `createClient(URL, SERVICE_ROLE_KEY)`; secrets via `Deno.env.get`; `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the platform.

---

## Key facts locked before coding

- **Supabase project_id:** `qygirixqsuraclbdfnjp`. Function base URL: `https://qygirixqsuraclbdfnjp.supabase.co/functions/v1/<name>`.
- **Anon key** for structural smoke tests: read it from `services/supabase.ts` (the `supabaseAnonKey` constant).
- **`subscriptions` shape** (Phase 1): `user_id uuid PK`, `stripe_customer_id text unique`, `stripe_subscription_id text unique`, `tier text check in (basic,ultra)`, `status text`, `current_period_end timestamptz`, `cancel_at_period_end bool`, plus `created_at`/`updated_at` (auto-trigger). Upsert `onConflict: 'user_id'`.
- **`current_period_end` API caveat:** older Stripe API versions expose `subscription.current_period_end` (top-level, unix seconds); 2025+ moved billing period to items. Read defensively: `sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end`.
- **Functions are committed to the repo AND deployed via MCP.** The repo copy is source of truth; the deploy pushes that exact content live.
- **No vitest for Deno functions** (the existing 4 functions have none). Verification = MCP deploy success + `list_edge_functions`/`get_edge_function` confirmation + live structural smoke test + the Task-6 e2e.

---

## File / artifact map

- **DB:** `stripe_events` table (idempotency) — via `apply_migration`, recorded in `docs/superpowers/audits/2026-06-14-monetization-phase2-migrations.md`.
- **Create** `supabase/functions/create-checkout-session/index.ts`
- **Create** `supabase/functions/stripe-webhook/index.ts`
- **Create** `supabase/functions/create-portal-session/index.ts`
- **Doc** `docs/superpowers/audits/2026-06-14-monetization-phase2-migrations.md` (the DB migration + the user Stripe-setup checklist + e2e results).

---

## Task 1: `stripe_events` idempotency table

**Files:** DB migration `monetization_p2_stripe_events`; create `docs/superpowers/audits/2026-06-14-monetization-phase2-migrations.md`.

- [ ] **Step 1: Apply the migration**

Via the Supabase `apply_migration` MCP tool (load `select:mcp__plugin_supabase_supabase__apply_migration`), name `monetization_p2_stripe_events`, project_id `qygirixqsuraclbdfnjp`:
```sql
-- Webhook idempotency: each Stripe event id is recorded once. A duplicate insert
-- (23505) tells the webhook it already processed this event. RLS on, no policies
-- => only the service-role webhook touches it.
create table if not exists public.stripe_events (
  id          text primary key,
  type        text,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
```

- [ ] **Step 2: Verify** (load `select:mcp__plugin_supabase_supabase__execute_sql`):
```sql
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='stripe_events') as tbl,
  (select relrowsecurity from pg_class where oid='public.stripe_events'::regclass) as rls_on,
  (select count(*) from pg_policies where schemaname='public' and tablename='stripe_events') as policies;
```
Expected: `tbl=1`, `rls_on=true`, `policies=0`.

- [ ] **Step 3: Record + commit**

Create `docs/superpowers/audits/2026-06-14-monetization-phase2-migrations.md`:
```markdown
# Monetization Phase 2 — DB migrations + Stripe setup (live, Supabase-managed)

## monetization_p2_stripe_events
` ` `sql
create table if not exists public.stripe_events (
  id          text primary key,
  type        text,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
` ` `
Verify: tbl=1, rls_on=true, policies=0. ✅
```
(Replace ` ` ` with real triple-backticks.) Then:
```bash
git add docs/superpowers/audits/2026-06-14-monetization-phase2-migrations.md
git commit -m "feat(monetization): stripe_events idempotency table (phase 2) [db]"
```

---

## Task 2: `create-checkout-session` edge function

**Files:** Create `supabase/functions/create-checkout-session/index.ts`.

- [ ] **Step 1: Write the function file** exactly:

```ts
// Supabase Edge Function: create-checkout-session
// Creates a Stripe Checkout Session (subscription mode) so a signed-in Google
// user can subscribe to Basic or Ultra. Anonymous users cannot subscribe.
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_BASIC, STRIPE_PRICE_ULTRA, APP_URL.
// SUPABASE_URL / SUPABASE_ANON_KEY are auto-injected.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    const PRICE_BASIC = Deno.env.get("STRIPE_PRICE_BASIC");
    const PRICE_ULTRA = Deno.env.get("STRIPE_PRICE_ULTRA");
    if (!STRIPE_SECRET_KEY || !PRICE_BASIC || !PRICE_ULTRA) {
      return json({ error: "STRIPE_NOT_CONFIGURED" }, 503);
    }
    const APP_URL = Deno.env.get("APP_URL") ?? "https://konskall.github.io/incognitochat/";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const { tier } = await req.json().catch(() => ({}));
    if (tier !== "basic" && tier !== "ultra") return json({ error: "BAD_TIER" }, 400);

    // Caller must be a signed-in, NON-anonymous (Google) user.
    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await caller.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "AUTH_REQUIRED" }, 401);
    if (user.is_anonymous) return json({ error: "LOGIN_REQUIRED" }, 403);

    const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
    const price = tier === "ultra" ? PRICE_ULTRA : PRICE_BASIC;

    // Reuse an existing Stripe customer for this uid (search by metadata), else
    // create one. (Search is eventually consistent — a rare rapid double-submit
    // could create two customers; acceptable at this scale.)
    let customerId: string | undefined;
    try {
      const found = await stripe.customers.search({ query: `metadata['uid']:'${user.id}'`, limit: 1 });
      if (found.data.length > 0) customerId = found.data[0].id;
    } catch (_e) { /* search unavailable -> fall through to create */ }
    if (!customerId) {
      const c = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { uid: user.id },
      });
      customerId = c.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: { metadata: { uid: user.id } },
      success_url: `${APP_URL}?checkout=success`,
      cancel_url: `${APP_URL}?checkout=cancel`,
      allow_promotion_codes: true,
    });
    return json({ url: session.url }, 200);
  } catch (e) {
    console.error("create-checkout-session error", e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
```

- [ ] **Step 2: Deploy** via `deploy_edge_function` MCP (load `select:mcp__plugin_supabase_supabase__deploy_edge_function`): project_id `qygirixqsuraclbdfnjp`, name `create-checkout-session`, entrypoint_path `index.ts`, **verify_jwt: true**, files `[{ name: "index.ts", content: <the file above> }]`. Expect a success result.

- [ ] **Step 3: Verify deployment** (load `select:mcp__plugin_supabase_supabase__list_edge_functions`):
```
list_edge_functions(project_id: qygirixqsuraclbdfnjp)
```
Confirm `create-checkout-session` appears with status ACTIVE and `verify_jwt=true`.

- [ ] **Step 4: Structural smoke test (best-effort; no secrets needed yet).** The function checks secrets first, so before secrets are set it returns 503 for any authorized call — which confirms it is live and reachable. Read `supabaseAnonKey` from `services/supabase.ts`, then run:
```bash
curl -s -o - -w "\n%{http_code}" -X POST \
  "https://qygirixqsuraclbdfnjp.supabase.co/functions/v1/create-checkout-session" \
  -H "Authorization: Bearer <ANON_KEY>" -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" -d '{"tier":"basic"}'
```
Expected: HTTP `503` with body `{"error":"STRIPE_NOT_CONFIGURED"}` (confirms deploy + reachability). If the network is sandboxed and curl is blocked, SKIP this step and rely on Step 3 — note it as skipped.

- [ ] **Step 5: Commit**
```bash
git add supabase/functions/create-checkout-session/index.ts
git commit -m "feat(monetization): create-checkout-session edge function (phase 2)"
```

---

## Task 3: `stripe-webhook` edge function (PUBLIC)

**Files:** Create `supabase/functions/stripe-webhook/index.ts`.

- [ ] **Step 1: Write the function file** exactly:

```ts
// Supabase Edge Function: stripe-webhook (PUBLIC — deploy with verify_jwt=false)
// Stripe calls this with no Supabase JWT; it authenticates via the Stripe
// signature. Idempotent (stripe_events). Always re-syncs from Stripe's CURRENT
// state (retrieve subscription -> map price to tier -> upsert subscriptions ->
// reconcile_entitlements), so it tolerates out-of-order event delivery.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_BASIC, STRIPE_PRICE_ULTRA.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function tierForPrice(priceId: string | undefined, basic: string, ultra: string): "basic" | "ultra" | null {
  if (priceId && priceId === ultra) return "ultra";
  if (priceId && priceId === basic) return "basic";
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!STRIPE_SECRET_KEY || !WEBHOOK_SECRET) return json({ error: "STRIPE_NOT_CONFIGURED" }, 503);
  const PRICE_BASIC = Deno.env.get("STRIPE_PRICE_BASIC") ?? "";
  const PRICE_ULTRA = Deno.env.get("STRIPE_PRICE_ULTRA") ?? "";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
  const cryptoProvider = Stripe.createSubtleCryptoProvider();

  const sig = req.headers.get("Stripe-Signature");
  const body = await req.text();
  if (!sig) return json({ error: "NO_SIGNATURE" }, 400);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (e) {
    console.error("signature verification failed", (e as Error).message);
    return json({ error: "BAD_SIGNATURE" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Idempotency CLAIM: record the event id; a duplicate (23505) means already
  // processed -> ack and skip. On a *retryable* failure later we DELETE this row
  // so Stripe's automatic retry can reprocess (otherwise a transient DB/Stripe
  // error would be permanently swallowed by the duplicate check).
  const { error: insErr } = await admin.from("stripe_events").insert({ id: event.id, type: event.type });
  if (insErr) {
    if ((insErr as { code?: string }).code === "23505") return json({ received: true, duplicate: true }, 200);
    console.error("stripe_events insert failed", insErr);
    return json({ error: "DB_ERROR" }, 500);
  }

  // Resolve the subscription id from the event.
  const obj = event.data.object as Record<string, unknown>;
  let subscriptionId: string | undefined;
  switch (event.type) {
    case "checkout.session.completed":
      subscriptionId = (obj.subscription as string) ?? undefined;
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      subscriptionId = obj.id as string;
      break;
    case "invoice.payment_failed":
    case "invoice.paid":
      subscriptionId = (obj.subscription as string) ?? undefined;
      break;
    default:
      return json({ received: true, ignored: event.type }, 200);
  }
  if (!subscriptionId) return json({ received: true, no_subscription: true }, 200);

  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    let uid = (sub.metadata?.uid as string) || "";
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    if (!uid) {
      const cust = await stripe.customers.retrieve(customerId);
      if (cust && !("deleted" in cust && cust.deleted)) uid = ((cust as Stripe.Customer).metadata?.uid as string) || "";
    }
    // Permanent (a retry won't fix it) -> ack 200 + log, keep the idempotency row.
    if (!uid) { console.error("no uid on subscription", subscriptionId); return json({ received: true, skipped: "NO_UID" }, 200); }

    const priceId = sub.items.data[0]?.price?.id;
    const tier = tierForPrice(priceId, PRICE_BASIC, PRICE_ULTRA);
    // Permanent -> ack 200 + log (e.g. a price not in our two env vars).
    if (!tier) { console.error("unknown price", priceId); return json({ received: true, skipped: "UNKNOWN_PRICE" }, 200); }

    // Defensive: period end is top-level on older API versions, per-item on 2025+.
    const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end
      ?? (sub.items.data[0] as unknown as { current_period_end?: number })?.current_period_end;

    const row = {
      user_id: uid,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      tier,
      status: sub.status,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: !!sub.cancel_at_period_end,
    };
    const { error: upErr } = await admin.from("subscriptions").upsert(row, { onConflict: "user_id" });
    if (upErr) {
      // A unique conflict on stripe_customer_id/stripe_subscription_id (e.g. a
      // re-created customer) must not 500 into infinite Stripe retries.
      if ((upErr as { code?: string }).code === "23505") {
        console.error("subscriptions upsert unique conflict (acked, not retried)", upErr);
        return json({ received: true, conflict: true }, 200);
      }
      // Retryable DB error: release the idempotency claim so Stripe's retry reprocesses.
      console.error("subscriptions upsert failed (will retry)", upErr);
      await admin.from("stripe_events").delete().eq("id", event.id);
      return json({ error: "DB_ERROR" }, 500);
    }
    await admin.rpc("reconcile_entitlements", { p_uid: uid });
    return json({ received: true, uid, tier, status: sub.status }, 200);
  } catch (e) {
    // Retryable failure (Stripe retrieve / reconcile / network): release the
    // idempotency claim so Stripe's automatic retry can reprocess this event.
    console.error("webhook sync error (will retry)", e);
    await admin.from("stripe_events").delete().eq("id", event.id);
    return json({ error: "SYNC_ERROR" }, 500);
  }
});
```

- [ ] **Step 2: Deploy** via `deploy_edge_function`: name `stripe-webhook`, entrypoint_path `index.ts`, **verify_jwt: false** (Stripe sends no Supabase JWT), files `[{ name:"index.ts", content:<the file above> }]`. Expect success.

- [ ] **Step 3: Verify deployment** via `list_edge_functions` — confirm `stripe-webhook` is ACTIVE and **`verify_jwt=false`** (critical: if it shows true, re-deploy with verify_jwt=false, else Stripe calls get a gateway 401).

- [ ] **Step 4: Structural smoke test (best-effort).** Before secrets, the function returns 503. This call ALSO proves the endpoint is public (no JWT needed — a non-public function would return a gateway 401 instead):
```bash
curl -s -o - -w "\n%{http_code}" -X POST \
  "https://qygirixqsuraclbdfnjp.supabase.co/functions/v1/stripe-webhook" \
  -H "Content-Type: application/json" -d '{}'
```
Expected: HTTP `503` `{"error":"STRIPE_NOT_CONFIGURED"}` (NOT a 401 — that would mean verify_jwt is still true). If curl is sandboxed, SKIP and rely on Step 3's verify_jwt=false confirmation.

- [ ] **Step 5: Commit**
```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat(monetization): stripe-webhook edge function (phase 2)"
```

---

## Task 4: `create-portal-session` edge function

**Files:** Create `supabase/functions/create-portal-session/index.ts`.

- [ ] **Step 1: Write the function file** exactly:

```ts
// Supabase Edge Function: create-portal-session
// Returns a Stripe Billing Portal URL for the signed-in user to manage their
// subscription (cancel, invoices, payment method).
// Secrets: STRIPE_SECRET_KEY, APP_URL. SUPABASE_* auto-injected.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) return json({ error: "STRIPE_NOT_CONFIGURED" }, 503);
    const APP_URL = Deno.env.get("APP_URL") ?? "https://konskall.github.io/incognitochat/";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await caller.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "AUTH_REQUIRED" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: subRow } = await admin
      .from("subscriptions").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
    const customerId = subRow?.stripe_customer_id;
    if (!customerId) return json({ error: "NO_SUBSCRIPTION" }, 404);

    const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}?portal=return`,
    });
    return json({ url: portal.url }, 200);
  } catch (e) {
    console.error("create-portal-session error", e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
```

- [ ] **Step 2: Deploy** via `deploy_edge_function`: name `create-portal-session`, entrypoint_path `index.ts`, **verify_jwt: true**, files `[{ name:"index.ts", content:<the file above> }]`.

- [ ] **Step 3: Verify deployment** via `list_edge_functions` — `create-portal-session` ACTIVE, `verify_jwt=true`.

- [ ] **Step 4: Structural smoke test (best-effort).** Returns 503 before secrets:
```bash
curl -s -o - -w "\n%{http_code}" -X POST \
  "https://qygirixqsuraclbdfnjp.supabase.co/functions/v1/create-portal-session" \
  -H "Authorization: Bearer <ANON_KEY>" -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" -d '{}'
```
Expected: HTTP `503` `{"error":"STRIPE_NOT_CONFIGURED"}`. Skip if curl sandboxed.

- [ ] **Step 5: Commit**
```bash
git add supabase/functions/create-portal-session/index.ts
git commit -m "feat(monetization): create-portal-session edge function (phase 2)"
```

---

## Task 5: ⏸️ USER ACTION — Stripe account, products, secrets, webhook (PAUSE)

This task is performed by the **user** (the agent cannot access the user's Stripe account or set their secret keys). The agent presents this checklist and pauses execution until the user confirms completion. The agent records the checklist verbatim into `docs/superpowers/audits/2026-06-14-monetization-phase2-migrations.md` under a `## Stripe setup (user action)` section and commits that, then stops.

**Checklist for the user (Stripe TEST mode first):**

1. **Create / open a Stripe account** and switch to **Test mode** (toggle, top-right of the Stripe dashboard).
2. **Create two Products with recurring monthly EUR prices:**
   - Product "Incognito Basic" → recurring price, monthly, EUR, amount TBD → copy the **Price ID** (`price_…`) → this is `STRIPE_PRICE_BASIC`.
   - Product "Incognito Ultra" → recurring price, monthly, EUR, amount TBD → copy the **Price ID** → this is `STRIPE_PRICE_ULTRA`.
3. **Get the secret API key:** Developers → API keys → copy the **Secret key** (`sk_test_…`) → this is `STRIPE_SECRET_KEY`.
4. **Register the webhook:** Developers → Webhooks → Add endpoint:
   - Endpoint URL: `https://qygirixqsuraclbdfnjp.supabase.co/functions/v1/stripe-webhook`
   - Events to send: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`.
   - After creating, copy the **Signing secret** (`whsec_…`) → this is `STRIPE_WEBHOOK_SECRET`.
5. **Enable the Customer Portal:** Settings → Billing → Customer portal → activate (allow cancellation + invoice history).
6. **Set the 5 secrets in Supabase** (Dashboard → Project Settings → Edge Functions → Secrets, OR via CLI). The exact set:
   - `STRIPE_SECRET_KEY = sk_test_…`
   - `STRIPE_WEBHOOK_SECRET = whsec_…`
   - `STRIPE_PRICE_BASIC = price_…`
   - `STRIPE_PRICE_ULTRA = price_…`
   - `APP_URL = https://konskall.github.io/incognitochat/`
   CLI form (if used): `supabase secrets set STRIPE_SECRET_KEY=… STRIPE_WEBHOOK_SECRET=… STRIPE_PRICE_BASIC=… STRIPE_PRICE_ULTRA=… APP_URL=https://konskall.github.io/incognitochat/ --project-ref qygirixqsuraclbdfnjp`

When the user replies that secrets are set and the webhook is registered, resume at Task 6.

---

## Task 6: End-to-end verification (after Task 5)

**Files:** append results to `docs/superpowers/audits/2026-06-14-monetization-phase2-migrations.md`.

- [ ] **Step 1: Confirm functions now read their secrets.** Re-run the Task 3 webhook smoke test (best-effort curl, no signature): now expect HTTP `400` `{"error":"NO_SIGNATURE"}` (NOT 503) — proving `STRIPE_WEBHOOK_SECRET` is set and the signature path is active.

- [ ] **Step 2: Drive a real test checkout from the browser console.** The user, logged into the app with a Google account, opens DevTools console and runs:
```js
const { data, error } = await supabase.functions.invoke('create-checkout-session', { body: { tier: 'basic' } });
console.log(data, error); window.open(data.url, '_blank');
```
Pay with the Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC/ZIP.

- [ ] **Step 3: Verify the webhook wrote the subscription** (via `execute_sql`, after the redirect to `?checkout=success`):
```sql
select user_id, tier, status, current_period_end, cancel_at_period_end, stripe_customer_id is not null as has_cust
from public.subscriptions order by created_at desc limit 3;
select id, type, received_at from public.stripe_events order by received_at desc limit 5;
```
Expected: a row with `tier='basic'`, `status='active'`, a future `current_period_end`; at least one `stripe_events` row (e.g. `checkout.session.completed`).

- [ ] **Step 4: Verify entitlement resolves.** With the test user's uid from Step 3:
```sql
select public.effective_tier('<that user_id>'::uuid) as tier; -- expect 'basic'
```

- [ ] **Step 5: Verify the Portal.** Browser console:
```js
const { data } = await supabase.functions.invoke('create-portal-session', {});
window.open(data.url, '_blank');
```
Confirm the Stripe Customer Portal opens for that customer. Optionally cancel there → confirm a new `stripe_events` row + the `subscriptions.status`/`cancel_at_period_end` update; `effective_tier` should remain `basic` until `current_period_end` (grace), then `free`.

- [ ] **Step 6: Record the e2e results** (tier/status/period observed, events seen) in the audit doc under `## End-to-end test (Stripe test mode)` and commit:
```bash
git add docs/superpowers/audits/2026-06-14-monetization-phase2-migrations.md
git commit -m "docs(monetization): phase 2 e2e verification [stripe test mode]"
```

---

## Task 7: Finalize + memory + push

- [ ] **Step 1:** Confirm all three functions are ACTIVE with correct `verify_jwt` via `list_edge_functions` (checkout=true, webhook=false, portal=true).
- [ ] **Step 2:** Update memory file `incognitochat-monetization.md` — mark Phase 2 done, note the 3 functions + `stripe_events` + the secrets list + that the webhook is verify_jwt=false. Update the `MEMORY.md` pointer line.
- [ ] **Step 3:** Push: `git push origin main`.

---

## Self-review checklist (run before declaring Phase 2 done)

- [ ] `stripe_events` table exists, RLS on, no policies (Task 1).
- [ ] `create-checkout-session`: authed + non-anonymous only; bad tier → 400; reuses/creates customer with metadata.uid; sets client_reference_id + subscription_data.metadata.uid; returns Checkout URL; verify_jwt=true (Task 2).
- [ ] `stripe-webhook`: PUBLIC (verify_jwt=false); rejects missing/bad signature (400); idempotent via stripe_events (23505→ack) AND releases the claim (delete) on retryable failures so Stripe retries reprocess; acks permanent skips (NO_UID/UNKNOWN_PRICE/upsert-23505) with 200; resolves uid from sub/customer metadata; maps price→tier via env; upsert onConflict user_id; calls reconcile_entitlements; defensive current_period_end read (Task 3).
- [ ] `create-portal-session`: authed; 404 if no subscription; returns Portal URL; verify_jwt=true (Task 4).
- [ ] User Stripe setup checklist documented + the 6 events registered (Task 5).
- [ ] e2e: real test checkout → subscriptions row (tier/status/period) → effective_tier → portal (Task 6).
- [ ] All 3 functions ACTIVE with correct verify_jwt; memory updated; pushed (Task 7).

## What Phase 2 deliberately does NOT do (Phase 3/4)

- No client UI: the browser-console invocations in Task 6 are test-only. The pricing page, dashboard billing section, `useEntitlements` hook, gray-outs, and mapping QT001–QT004 to Greek prompts are **Phase 3/4**.
- Amounts remain TBD in Stripe; only price IDs are referenced.
