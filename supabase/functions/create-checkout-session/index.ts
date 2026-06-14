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
