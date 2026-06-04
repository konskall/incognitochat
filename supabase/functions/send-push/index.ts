// Supabase Edge Function: send-push
// Sends Web Push (VAPID) notifications to a room's subscribers when a new
// message is posted. Called by the client after sending a message.
//
// Verifies the caller is a member, reads push_subscriptions for the room with
// the SERVICE ROLE, then sends an encrypted push to each subscription
// (excluding the sender and currently-online users). Stale subscriptions
// (404/410) are pruned.
//
// Secrets (REQUIRED):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
//   VAPID_SUBJECT (optional, defaults to mailto:admin@incognitochat)
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY injected by the platform.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return json({ error: "PUSH_NOT_CONFIGURED" }, 503);
    }
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@incognitochat";

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const {
      roomKey,
      title,
      body,
      url,
      roomName,
      excludeUids = [],
    } = await req.json().catch(() => ({}));

    if (!roomKey) return json({ error: "BAD_REQUEST" }, 400);

    // 1. Authn/authz: caller must be a member.
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await callerClient.auth.getUser();
    const senderUid = userData?.user?.id;
    if (!senderUid) return json({ error: "AUTH_REQUIRED" }, 401);

    const { data: isMember } = await callerClient.rpc("is_member", { p_room_key: roomKey });
    if (!isMember) return json({ error: "NOT_A_MEMBER" }, 403);

    // 2. Read subscriptions for the room (service role).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: subs, error: subErr } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .eq("room_key", roomKey);
    if (subErr) {
      console.error("push_subscriptions read failed", subErr);
      return json({ error: "DB_ERROR" }, 500);
    }

    const exclude = new Set<string>([senderUid, ...(excludeUids as string[])]);
    const targets = (subs ?? []).filter((s) => !exclude.has(s.user_id));
    if (targets.length === 0) return json({ sent: 0 }, 200);

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const payload = JSON.stringify({
      title: title ?? (roomName ? `New message in ${roomName}` : "New message"),
      body: body ?? "",
      url: url ?? "/",
      roomKey,
    });

    let sent = 0;
    const staleIds: number[] = [];
    await Promise.all(
      targets.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          sent++;
        } catch (err: unknown) {
          const code = (err as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) staleIds.push(s.id);
          else console.error("push send error", code, err);
        }
      }),
    );

    // Prune stale subscriptions.
    if (staleIds.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", staleIds);
    }

    return json({ sent, pruned: staleIds.length }, 200);
  } catch (e) {
    console.error("send-push exception", e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
