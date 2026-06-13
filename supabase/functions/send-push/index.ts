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
//   APP_URL (optional, defaults to the GitHub Pages app URL) — the canonical
//   same-origin click target for notifications.
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
    // The notification's click target must NOT be trusted from the request body:
    // any member could call this with an arbitrary `url` and deliver an
    // OS-level notification that navigates every other subscriber to a phishing
    // page (open redirect). We pin it to the app's own origin server-side — a
    // same-origin client url is kept (in case of future deep-links), anything
    // else falls back to the canonical app URL.
    const APP_URL = Deno.env.get("APP_URL") ?? "https://konskall.github.io/incognitochat/";

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
      .select("id, user_id, endpoint, p256dh, auth, created_at")
      .eq("room_key", roomKey);
    if (subErr) {
      console.error("push_subscriptions read failed", subErr);
      return json({ error: "DB_ERROR" }, 500);
    }

    // Only CURRENT members get pushed. A subscription row outlives a "leave
    // room" (and room keys are deterministic name+pin, so a re-created room
    // would otherwise resurrect rows from its previous life and push strangers).
    // The error MUST be checked: an unchecked transient failure here would make
    // `members` an empty set and the garbage sweep below would mass-delete
    // every subscription row in the room.
    const { data: memberRows, error: memberErr } = await admin
      .from("subscribers")
      .select("uid")
      .eq("room_key", roomKey);
    if (memberErr) {
      console.error("subscribers read failed", memberErr);
      return json({ error: "DB_ERROR" }, 500);
    }
    const members = new Set<string>((memberRows ?? []).map((m) => String(m.uid).toLowerCase()));
    // The caller just passed is_member, so an empty member set is an
    // inconsistency signal, never reality — fall back to the unfiltered list
    // and DELETE NOTHING rather than treating everyone as garbage.
    const membersTrustworthy = members.size > 0;
    const memberSubs = membersTrustworthy
      ? (subs ?? []).filter((s) => members.has(String(s.user_id).toLowerCase()))
      : (subs ?? []);

    // One push per device: churned anonymous uids leave OLDER rows for the
    // SAME endpoint behind, and each row used to get its own send → duplicate
    // banners on that device. Keep only the newest row per endpoint (the client
    // upsert refreshes created_at, so newest == the device's active identity).
    const byEndpoint = new Map<string, (typeof memberSubs)[number]>();
    for (const s of memberSubs) {
      const prev = byEndpoint.get(s.endpoint);
      if (
        !prev ||
        s.created_at > prev.created_at ||
        (s.created_at === prev.created_at && s.id > prev.id)
      ) {
        byEndpoint.set(s.endpoint, s);
      }
    }
    const deduped = [...byEndpoint.values()];

    // Garbage = non-member rows + older duplicate-endpoint rows. Delete them
    // opportunistically so the table converges to one row per member-device.
    // Only when the member read is verifiably healthy (see above).
    const keepIds = new Set(deduped.map((s) => s.id));
    const garbageIds = membersTrustworthy
      ? (subs ?? []).filter((s) => !keepIds.has(s.id)).map((s) => s.id)
      : [];
    if (garbageIds.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", garbageIds);
    }

    // Respect per-user "mute" for this room: those users opted out of push.
    // A transient error here only risks pushing a muted user once (log and
    // proceed) — never dropping or deleting anything.
    const { data: mutedRows, error: mutedErr } = await admin
      .from("room_settings")
      .select("user_id")
      .eq("room_key", roomKey)
      .eq("muted", true);
    if (mutedErr) console.error("room_settings muted read failed", mutedErr);
    const muted = new Set<string>((mutedRows ?? []).map((m) => String(m.user_id).toLowerCase()));

    // Validate excludeUids defensively: a non-array body would throw on spread
    // and turn the push into a 500.
    const exList = Array.isArray(excludeUids)
      ? excludeUids.filter((x: unknown) => typeof x === "string")
      : [];
    const exclude = new Set<string>(
      [senderUid, ...exList].map((u) => String(u).toLowerCase()),
    );
    // Exclusion is per DEVICE (endpoint), not per row: one device can carry
    // rows under several identities (Google <-> anonymous switches), and the
    // kept row's uid may be the stale one. If ANY identity on an endpoint is
    // the sender or muted, that device is excluded.
    const excludedEndpoints = new Set<string>(
      memberSubs
        .filter((s) => {
          const uid = String(s.user_id).toLowerCase();
          return exclude.has(uid) || muted.has(uid);
        })
        .map((s) => s.endpoint),
    );
    const targets = deduped.filter((s) => !excludedEndpoints.has(s.endpoint));
    // Structured log so delivery is diagnosable from the dashboard: how many
    // subscriptions the room has, how many survived member/dedupe filtering,
    // how many devices were excluded (sender/muted), how many remain.
    console.log(
      `send-push v10 room=${roomKey} subs=${subs?.length ?? 0} members=${memberSubs.length} deduped=${deduped.length} garbage=${garbageIds.length} excludedDevices=${excludedEndpoints.size} targets=${targets.length}${membersTrustworthy ? "" : " MEMBERS_READ_EMPTY"}`,
    );
    if (targets.length === 0) return json({ sent: 0 }, 200);

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    // Derive the click target server-side: keep the client url only if it's
    // same-origin as the app, otherwise pin to the canonical app URL. Never let
    // an attacker-supplied off-origin url reach the subscribers' devices.
    const appOrigin = new URL(APP_URL).origin;
    let safeUrl = APP_URL;
    try {
      if (url) {
        const u = new URL(url, APP_URL);
        if (u.origin === appOrigin) safeUrl = u.href;
      }
    } catch { /* keep APP_URL */ }

    // Web Push payloads are capped (~4KB after encryption). A long body would
    // 413 on send and — since only 404/410 are treated as stale — silently drop
    // the push for the whole room. Clamp the visible fields well under the limit.
    const clampPush = (v: unknown, n: number) => String(v ?? "").slice(0, n);
    const payload = JSON.stringify({
      title: clampPush(title ?? (roomName ? `New message in ${roomName}` : "New message"), 120),
      body: clampPush(body, 1000),
      url: safeUrl,
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

    console.log(`send-push room=${roomKey} sent=${sent} pruned=${staleIds.length}`);

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
