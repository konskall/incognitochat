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
    // Sanitize APP_URL (see create-checkout-session): a malformed secret would make
    // the portal return_url invalid. Trim + validate; fall back to the prod origin.
    const DEFAULT_APP_URL = "https://konskall.github.io/incognitochat/";
    let APP_URL = DEFAULT_APP_URL;
    try { APP_URL = new URL((Deno.env.get("APP_URL") ?? "").trim() || DEFAULT_APP_URL).toString(); } catch { APP_URL = DEFAULT_APP_URL; }
    // Build the return URL via the URL API so an APP_URL with an existing query or
    // fragment doesn't produce a malformed double-separator URL (SEW-5).
    const returnUrl = (() => { const u = new URL(APP_URL); u.searchParams.set("portal", "return"); return u.toString(); })();
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
      return_url: returnUrl,
    });
    return json({ url: portal.url }, 200);
  } catch (e) {
    console.error("create-portal-session error", e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
