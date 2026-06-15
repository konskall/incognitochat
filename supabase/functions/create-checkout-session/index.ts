// Supabase Edge Function: create-checkout-session
// Creates a Stripe Checkout Session (subscription mode) so a signed-in Google
// user can subscribe to Basic or Ultra. Anonymous users cannot subscribe.
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_BASIC, STRIPE_PRICE_ULTRA, APP_URL.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected.
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
    // Sanitize APP_URL: an empty/whitespace/malformed secret would make the Stripe
    // success/cancel URLs invalid (StripeInvalidRequestError url_invalid). Trim +
    // validate; fall back to the prod origin if it isn't a real URL.
    const DEFAULT_APP_URL = "https://konskall.github.io/incognitochat/";
    let APP_URL = DEFAULT_APP_URL;
    try { APP_URL = new URL((Deno.env.get("APP_URL") ?? "").trim() || DEFAULT_APP_URL).toString(); } catch { APP_URL = DEFAULT_APP_URL; }
    // Build return URLs via the URL API so an APP_URL that ever carries a query or
    // fragment doesn't produce a malformed double-separator URL (SEW-5).
    const appUrlWith = (key: string, value: string) => {
      const u = new URL(APP_URL);
      u.searchParams.set(key, value);
      return u.toString();
    };
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
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

    // Resolve the Stripe customer for this uid. Prefer the AUTHORITATIVE id the
    // webhook recorded in `subscriptions` (service-role read), then a metadata
    // search, else create one. This avoids spawning orphaned duplicate customers
    // on a rapid double-submit, since the eventually-consistent search can miss a
    // just-created customer (SEW-3).
    let customerId: string | undefined;
    if (SERVICE_ROLE_KEY) {
      try {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        const { data: subRow } = await admin
          .from("subscriptions").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
        if (subRow?.stripe_customer_id) customerId = subRow.stripe_customer_id as string;
      } catch (_e) { /* fall through to search/create */ }
    }
    if (!customerId) {
      try {
        const found = await stripe.customers.search({ query: `metadata['uid']:'${user.id}'`, limit: 1 });
        if (found.data.length > 0) customerId = found.data[0].id;
      } catch (_e) { /* search unavailable -> fall through to create */ }
    }
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
      success_url: appUrlWith("checkout", "success"),
      cancel_url: appUrlWith("checkout", "cancel"),
      allow_promotion_codes: true,
    });
    if (!session.url) return json({ error: "NO_CHECKOUT_URL" }, 500);
    return json({ url: session.url }, 200);
  } catch (e) {
    console.error("create-checkout-session error", e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
