// Supabase Edge Function: delete-account
// GDPR self-serve account deletion. Verifies the caller from their JWT, then
// IRREVERSIBLY removes everything tied to them:
//   1. Stripe customer (cancels any active subscription + deletes Stripe-side PII)
//   2. Storage: their profile avatars + every attachment in rooms they OWN
//   3. Rooms they created (cascades messages + room-scoped subscribers/settings/push)
//   4. Their membership + per-user settings in rooms they only JOINED (no FK to auth.users)
//   5. Their subscription record
//   6. The auth user itself (cascades push_subscriptions)
// Order matters: rooms.created_by is ON DELETE NO ACTION, so owned rooms MUST be
// deleted BEFORE the auth user, or the auth delete is blocked.
// Secrets: STRIPE_SECRET_KEY (optional). SUPABASE_* auto-injected.
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

const BUCKET = "attachments";
const LIST_PAGE = 100;

// Best-effort: list + remove every object directly under `${prefix}/`. Our paths
// are flat (attachments/<roomKey>/<file>, profiles/<uid>/<file>) so no recursion.
// Removing a full page then re-listing returns the next page (no offset needed).
async function removePrefix(admin: ReturnType<typeof createClient>, prefix: string) {
  try {
    for (let guard = 0; guard < 1000; guard++) {
      const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: LIST_PAGE });
      if (error || !data || data.length === 0) break;
      const paths = data.filter((o) => o.id !== null).map((o) => `${prefix}/${o.name}`);
      if (paths.length === 0) break;
      await admin.storage.from(BUCKET).remove(paths);
      if (data.length < LIST_PAGE) break;
    }
  } catch (e) {
    console.warn("storage cleanup failed for", prefix, e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // Identify the caller (runs as them; can't be forged).
    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await caller.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "AUTH_REQUIRED" }, 401);
    const uid = user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Stripe — delete the customer (cancels active subs + removes Stripe PII).
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    try {
      const { data: subRow } = await admin
        .from("subscriptions").select("stripe_customer_id").eq("user_id", uid).maybeSingle();
      const customerId = subRow?.stripe_customer_id as string | undefined;
      if (customerId && STRIPE_SECRET_KEY) {
        const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
        await stripe.customers.del(customerId);
      }
    } catch (e) {
      console.warn("Stripe customer delete failed (continuing):", e);
    }

    // 2. Storage — owned-room attachments + this user's avatars. Fetch the owned
    //    room keys BEFORE the rows are deleted.
    try {
      const { data: owned } = await admin.from("rooms").select("room_key").eq("created_by", uid);
      for (const r of (owned ?? []) as { room_key: string }[]) await removePrefix(admin, r.room_key);
      await removePrefix(admin, `profiles/${uid}`);
    } catch (e) {
      console.warn("storage cleanup failed (continuing):", e);
    }

    // 3. Owned rooms — cascades messages + room-scoped subscribers/settings/push.
    //    MUST run before the auth-user delete (rooms.created_by = NO ACTION).
    {
      const { error } = await admin.from("rooms").delete().eq("created_by", uid);
      if (error) { console.error("rooms delete failed:", error); return json({ error: "DELETE_FAILED" }, 500); }
    }

    // 4. Membership + per-user settings in rooms the user only JOINED (these tables
    //    have no FK to auth.users, so the auth-user delete wouldn't reach them).
    await admin.from("subscribers").delete().eq("uid", uid);
    await admin.from("room_settings").delete().eq("user_id", uid);

    // 5. Subscription record (also cascades on the auth delete; explicit for clarity).
    await admin.from("subscriptions").delete().eq("user_id", uid);

    // 6. The auth user itself (cascades push_subscriptions.user_id).
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) { console.error("auth deleteUser failed:", delErr); return json({ error: "DELETE_FAILED" }, 500); }

    return json({ ok: true }, 200);
  } catch (e) {
    console.error("delete-account error", e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
