// Supabase Edge Function: get-prices (PUBLIC, verify_jwt=false)
// Returns the live Basic/Ultra prices from Stripe so the landing page never
// hardcodes amounts. Reads STRIPE_SECRET_KEY + STRIPE_PRICE_BASIC/ULTRA (already
// set in Phase 2). No auth required — prices are public marketing data.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@17?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}

// This is a PUBLIC, unauthenticated function the client calls via POST (so the
// Cache-Control hint above doesn't apply browser-side). Cache the shaped result
// in module scope so warm isolates reuse it for ~5 min instead of hitting Stripe
// on every landing-page / modal mount (SEW-4). Only successes are cached.
const TTL_MS = 5 * 60 * 1000;
let cache: { body: { basic: unknown; ultra: unknown }; exp: number } | null = null;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (cache && cache.exp > Date.now()) return json(cache.body, 200);

    const KEY = Deno.env.get("STRIPE_SECRET_KEY");
    const PRICE_BASIC = Deno.env.get("STRIPE_PRICE_BASIC");
    const PRICE_ULTRA = Deno.env.get("STRIPE_PRICE_ULTRA");
    if (!KEY || !PRICE_BASIC || !PRICE_ULTRA) return json({ error: "STRIPE_NOT_CONFIGURED" }, 503);

    const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient() });
    const [b, u] = await Promise.all([
      stripe.prices.retrieve(PRICE_BASIC),
      stripe.prices.retrieve(PRICE_ULTRA),
    ]);
    const shape = (p: Stripe.Price) => ({
      amount: p.unit_amount,                       // minor units (cents)
      currency: p.currency,                        // e.g. "eur"
      interval: p.recurring?.interval ?? "month",  // "month"
    });
    const body = { basic: shape(b), ultra: shape(u) };
    cache = { body, exp: Date.now() + TTL_MS };
    return json(body, 200);
  } catch (e) {
    console.error("get-prices error", e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
