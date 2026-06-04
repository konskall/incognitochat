// Supabase Edge Function: notify-room
// Server-side email notifications for room activity (replaces the insecure
// client-side EmailJS code that shipped keys to the browser and required
// reading every subscriber's email from the client).
//
// Flow: the client invokes this after sending a message. The function:
//   1. verifies the caller is a signed-in MEMBER of the room,
//   2. reads the room's subscribers with the SERVICE ROLE (server-side only),
//   3. applies the per-subscriber cooldown,
//   4. sends one EmailJS email per recipient (so addresses are not leaked to
//      each other), then updates last_notified_at.
//
// Secrets:
//   EMAILJS_PRIVATE_KEY   (REQUIRED — EmailJS account "Private Key"/accessToken;
//                          also enable "Allow EmailJS API for non-browser
//                          applications" in the EmailJS dashboard)
//   EMAILJS_SERVICE_ID / EMAILJS_TEMPLATE_ID / EMAILJS_PUBLIC_KEY  (optional
//                          overrides; default to the project's existing values)
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically by the platform.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const COOLDOWN_MINUTES = 30;
const EMAILJS_ENDPOINT = "https://api.emailjs.com/api/v1.0/email/send";

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
    const EMAILJS_PRIVATE_KEY = Deno.env.get("EMAILJS_PRIVATE_KEY");
    if (!EMAILJS_PRIVATE_KEY) return json({ error: "EMAIL_NOT_CONFIGURED" }, 503);

    const EMAILJS_SERVICE_ID = Deno.env.get("EMAILJS_SERVICE_ID") ?? "service_cnerkn6";
    const EMAILJS_TEMPLATE_ID = Deno.env.get("EMAILJS_TEMPLATE_ID") ?? "template_zr9v8bp";
    const EMAILJS_PUBLIC_KEY = Deno.env.get("EMAILJS_PUBLIC_KEY") ?? "cSDU4HLqgylnmX957";

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const {
      roomKey,
      roomName,
      senderName,
      body,
      action = "message",
      excludeUids = [],
      link = "",
    } = await req.json().catch(() => ({}));

    if (!roomKey) return json({ error: "BAD_REQUEST" }, 400);

    // 1. Authn/authz: caller must be a member of the room.
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await callerClient.auth.getUser();
    const senderUid = userData?.user?.id;
    if (!senderUid) return json({ error: "AUTH_REQUIRED" }, 401);

    const { data: isMember } = await callerClient.rpc("is_member", { p_room_key: roomKey });
    if (!isMember) return json({ error: "NOT_A_MEMBER" }, 403);

    // 2. Read subscribers with the service role (server-side only).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: subs, error: subErr } = await admin
      .from("subscribers")
      .select("uid, email, last_notified_at")
      .eq("room_key", roomKey);
    if (subErr) {
      console.error("subscribers read failed", subErr);
      return json({ error: "DB_ERROR" }, 500);
    }

    const exclude = new Set<string>([senderUid, ...(excludeUids as string[])]);
    const now = Date.now();
    const recipients = (subs ?? []).filter((s) => {
      if (!s.email) return false;
      if (exclude.has(s.uid)) return false;
      if (action !== "deleted" && s.last_notified_at) {
        const diffMin = (now - new Date(s.last_notified_at).getTime()) / 60000;
        if (diffMin < COOLDOWN_MINUTES) return false;
      }
      return true;
    });

    if (recipients.length === 0) return json({ sent: 0 }, 200);

    const actionLabel = action === "deleted" ? "Room Deleted" : "New Message";

    // 3. Send one email per recipient (no cross-recipient address leak).
    let sent = 0;
    for (const r of recipients) {
      const payload = {
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        accessToken: EMAILJS_PRIVATE_KEY,
        template_params: {
          to_email: r.email,
          room_name: roomName ?? "",
          action_type: actionLabel,
          sender_name: senderName ?? "",
          message_body: body ?? "",
          link,
        },
      };
      const resp = await fetch(EMAILJS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (resp.ok) sent++;
      else console.error("EmailJS send failed", resp.status, (await resp.text()).slice(0, 200));
    }

    // 4. Update cooldown timestamps for everyone we emailed.
    if (sent > 0) {
      const uids = recipients.map((r) => r.uid);
      await admin
        .from("subscribers")
        .update({ last_notified_at: new Date().toISOString() })
        .eq("room_key", roomKey)
        .in("uid", uids);
    }

    return json({ sent }, 200);
  } catch (e) {
    console.error("notify-room exception", e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
