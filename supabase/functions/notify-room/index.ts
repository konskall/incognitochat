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
// A room is deleted once, so "deleted" emails legitimately bypass the 30-min
// message cooldown — but a member could otherwise spam action:"deleted" to send
// unlimited emails (inbox flooding + shared EmailJS quota exhaustion). Keep a
// short floor so deletions still go out promptly but repeats are throttled.
const DELETED_FLOOR_MINUTES = 5;
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
    // Canonical app origin: the email's clickable link is pinned to this so a
    // client-supplied `link` can't deliver a phishing URL from our trusted sender.
    const APP_URL = Deno.env.get("APP_URL") ?? "https://konskall.github.io/incognitochat/";

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

    // Validate excludeUids defensively: a non-array body would throw on spread
    // and turn the notification into a 500 (DoS the caller's own request).
    const exList = Array.isArray(excludeUids)
      ? excludeUids.filter((x: unknown) => typeof x === "string")
      : [];
    const exclude = new Set<string>([senderUid, ...exList]);
    const now = Date.now();
    const cooldownMin = action === "deleted" ? DELETED_FLOOR_MINUTES : COOLDOWN_MINUTES;

    // Candidate recipients: have an email and are not excluded.
    const candidateUids = (subs ?? [])
      .filter((s) => s.email && !exclude.has(s.uid))
      .map((s) => s.uid);
    if (candidateUids.length === 0) return json({ sent: 0 }, 200);

    // Email alerts are a Basic+ feature. A DB trigger gates SETTING the email,
    // but we ALSO re-check effective tier at SEND time (defense-in-depth): a user
    // who subscribed while paid and later downgraded to free must stop receiving
    // alerts — no free riders on the email send cost. Mirrors SQL effective_tier
    // / client resolveTier. Free users (no subscription row) are dropped.
    const { data: subRows, error: subTierErr } = await admin
      .from("subscriptions")
      .select("user_id, tier, status, current_period_end")
      .in("user_id", candidateUids);
    if (subTierErr) {
      console.error("subscriptions tier read failed", subTierErr);
      return json({ error: "DB_ERROR" }, 500);
    }
    const entitledUids = new Set<string>();
    for (const s of subRows ?? []) {
      const periodMs = s.current_period_end ? Date.parse(s.current_period_end) : NaN;
      const inPeriod = Number.isFinite(periodMs) && periodMs > now;
      const entitled =
        s.status === "active" ||
        s.status === "trialing" ||
        ((s.status === "past_due" || s.status === "canceled") && inPeriod);
      if (entitled && (s.tier === "basic" || s.tier === "ultra")) entitledUids.add(s.user_id);
    }
    const paidUids = candidateUids.filter((u) => entitledUids.has(u));
    if (paidUids.length === 0) return json({ sent: 0 }, 200);

    // ATOMIC cooldown pre-claim. A single conditional UPDATE bumps
    // last_notified_at ONLY for rows whose cooldown has elapsed (or that were
    // never notified) and RETURNS the rows it actually changed. Two concurrent
    // invocations can't both claim the same recipient — the second's WHERE no
    // longer matches — which closes the read-then-write TOCTOU that let
    // concurrent sends double-email and exhaust the shared EmailJS quota. We
    // email only the rows we won. The timestamp is written pre-send (best-effort
    // digest): a failed individual send simply waits for the next window, which
    // also avoids re-notifying recipients whose send already succeeded.
    const cutoffIso = new Date(now - cooldownMin * 60000).toISOString();
    const { data: claimed, error: claimErr } = await admin
      .from("subscribers")
      .update({ last_notified_at: new Date(now).toISOString() })
      .eq("room_key", roomKey)
      .in("uid", paidUids)
      .or(`last_notified_at.is.null,last_notified_at.lt.${cutoffIso}`)
      .select("uid, email");
    if (claimErr) {
      console.error("cooldown claim failed", claimErr);
      return json({ error: "DB_ERROR" }, 500);
    }
    const recipients = claimed ?? [];
    if (recipients.length === 0) return json({ sent: 0 }, 200);

    const actionLabel = action === "deleted" ? "Room Deleted" : "New Message";

    // Pin the email's clickable link to the app's own origin. Never trust the
    // client `link`: an attacker member could otherwise deliver a phishing URL
    // from the project's trusted EmailJS sender. Off-origin / garbage -> APP_URL.
    const appOrigin = new URL(APP_URL).origin;
    let safeLink = APP_URL;
    try {
      if (link) { const u = new URL(String(link), APP_URL); if (u.origin === appOrigin) safeLink = u.href; }
    } catch { /* keep APP_URL */ }
    // Bound the spoofable free-text fields.
    const clamp = (v: unknown, n: number) => String(v ?? "").slice(0, n);
    const safeRoomName = clamp(roomName, 120);
    const safeSenderName = clamp(senderName, 80);
    const safeBody = clamp(body, 500);

    // Send one email per recipient (no cross-recipient address leak). Per-send
    // timeout so a slow/hung EmailJS endpoint can't stall the whole function.
    let sent = 0;
    for (const r of recipients) {
      const payload = {
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        accessToken: EMAILJS_PRIVATE_KEY,
        template_params: {
          to_email: r.email,
          room_name: safeRoomName,
          action_type: actionLabel,
          sender_name: safeSenderName,
          message_body: safeBody,
          link: safeLink,
        },
      };
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 10000);
      try {
        const resp = await fetch(EMAILJS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ctl.signal,
        });
        if (resp.ok) sent++;
        else console.error("EmailJS send failed", resp.status, (await resp.text()).slice(0, 200));
      } catch (e) {
        console.error("EmailJS send error", e);
      } finally {
        clearTimeout(t);
      }
    }

    return json({ sent }, 200);
  } catch (e) {
    console.error("notify-room exception", e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
