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
  // so Stripe's automatic retry can reprocess.
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
    // Permanent: a non-UUID uid (bad metadata) would 22P02 on the uuid columns and
    // loop Stripe retries for days — ack as a permanent skip instead.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) {
      console.error("malformed uid in Stripe metadata", uid, subscriptionId);
      return json({ received: true, skipped: "MALFORMED_UID" }, 200);
    }

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
      if ((upErr as { code?: string }).code === "23505") {
        console.error("subscriptions upsert unique conflict (acked, not retried)", upErr);
        return json({ received: true, conflict: true }, 200);
      }
      // Retryable DB error: release the idempotency claim so Stripe's retry reprocesses.
      console.error("subscriptions upsert failed (will retry)", upErr);
      await admin.from("stripe_events").delete().eq("id", event.id);
      return json({ error: "DB_ERROR" }, 500);
    }
    const { error: rpcErr } = await admin.rpc("reconcile_entitlements", { p_uid: uid });
    if (rpcErr) {
      // Retryable: the subscription row is written but entitlements weren't
      // reconciled — release the idempotency claim so Stripe retries the sync.
      console.error("reconcile_entitlements failed (will retry)", rpcErr);
      await admin.from("stripe_events").delete().eq("id", event.id);
      return json({ error: "RECONCILE_ERROR" }, 500);
    }
    return json({ received: true, uid, tier, status: sub.status }, 200);
  } catch (e) {
    // Retryable failure (Stripe retrieve / reconcile / network): release the
    // idempotency claim so Stripe's automatic retry can reprocess this event.
    console.error("webhook sync error (will retry)", e);
    await admin.from("stripe_events").delete().eq("id", event.id);
    return json({ error: "SYNC_ERROR" }, 500);
  }
});
