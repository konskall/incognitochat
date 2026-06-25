// Supabase Edge Function: inco-ai
// Server-side proxy for the "inco" Gemini assistant. Holds GEMINI_API_KEY as a
// server secret, verifies the caller is a signed-in MEMBER of the room, calls
// Gemini, and returns text + grounding sources (or a location request). The client
// encrypts + inserts the bot message itself (PIN/key never leave the client).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_MODEL = "gemini-2.5-flash";

// Lightweight per-caller rate limit. Each Gemini call has google_search grounding
// enabled (billed) and any room member can invoke this — bound single-client abuse
// with an in-memory sliding window per uid (warm isolates reused across a burst).
const RL_WINDOW_MS = 60_000;
const RL_MAX = 8;
const rlHits = new Map<string, number[]>();
function rateLimited(uid: string): boolean {
  const now = Date.now();
  const recent = (rlHits.get(uid) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  recent.push(now);
  rlHits.set(uid, recent);
  if (rlHits.size > 500) {
    for (const [k, v] of rlHits) { if (v.every((t) => now - t >= RL_WINDOW_MS)) rlHits.delete(k); }
  }
  return recent.length > RL_MAX;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Map the client-sent history turns into Gemini `contents`, merging consecutive
// same-role turns (a multi-human room produces several 'user' turns in a row) and
// dropping any leading 'model' turns (Gemini requires the first turn to be 'user').
function toContents(history: unknown): { role: "user" | "model"; parts: { text: string }[] }[] {
  const out: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  if (Array.isArray(history)) {
    for (const h of history) {
      const text = typeof h?.text === "string" ? h.text : "";
      if (!text) continue;
      const role: "user" | "model" = h?.role === "model" ? "model" : "user";
      const last = out[out.length - 1];
      if (last && last.role === role) last.parts[0].text += `\n${text}`;
      else out.push({ role, parts: [{ text }] });
    }
  }
  while (out.length && out[0].role === "model") out.shift();
  return out;
}

const SENTINEL = "[[NEED_LOCATION]]";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) return json({ error: "AI_NOT_CONFIGURED" }, 503);

    const authHeader = req.headers.get("Authorization") ?? "";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const {
      roomKey, roomName, history, context, triggerText, triggerUsername,
      clientDateTime, locationCity, locationDenied,
    } = await req.json().catch(() => ({}));

    if (!roomKey || !triggerText) return json({ error: "BAD_REQUEST" }, 400);

    // Verify the caller is a member of the room (runs is_member() as the caller).
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await sb.auth.getUser();
    const callerUid = userData?.user?.id;
    if (!callerUid) return json({ error: "AUTH_REQUIRED" }, 401);

    const { data: isMember, error: memErr } = await sb.rpc("is_member", { p_room_key: roomKey });
    if (memErr || !isMember) return json({ error: "NOT_A_MEMBER" }, 403);

    if (rateLimited(callerUid)) return json({ error: "RATE_LIMITED" }, 429);

    // The user's LOCAL time comes from the client; only fall back to a clearly
    // labeled UTC if a stale client didn't send it.
    const whenLine = (typeof clientDateTime === "string" && clientDateTime)
      ? clientDateTime
      : `${new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} (UTC)`;

    // pass 2 only: we already attempted location. Forbid another sentinel (loop guard).
    const secondPass = !!locationCity || !!locationDenied;
    const locationLine = locationCity ? `\nUSER LOCATION: ${locationCity}` : "";
    const deniedNote = locationDenied
      ? `\n- The user DECLINED to share their location. Ask them which city/area they mean, or answer generally. Do NOT output ${SENTINEL}.`
      : "";

    const systemInstruction = `You are "inco", a warm, concise, genuinely helpful assistant inside the chat room "${roomName ?? ""}". Multiple people may be chatting.

CURRENT DATE & TIME (the user's local time): ${whenLine}${locationLine}

GUIDELINES:
- Reply in the SAME language the user writes in; if they ask you to switch, keep the new language.
- Be concise and friendly. PLAIN TEXT ONLY — no markdown (no **bold**, #, or bullet/asterisk syntax); the chat renders raw text.
- If the user asks the date or time, answer directly from CURRENT DATE & TIME above. NEVER use web search for the time/date.
- Use Google Search ONLY for facts, current events, or things you don't know — never for the time, opinions, or chit-chat.
- If you don't know or aren't sure, say so briefly. Do NOT invent facts, links, names, or numbers.
- Don't volunteer the date, time, or location unless it's relevant to the user's message.
- LOCATION: if answering well REQUIRES the user's physical location (e.g. "best pizza near me", "weather here", nearby places) and no USER LOCATION is given above, reply with EXACTLY ${SENTINEL} and nothing else — do not guess a city and do not search. If USER LOCATION is given, use it. If the user already named a place, just use that.${deniedNote}`;

    // Conversation as proper turns; fall back if no structured history.
    let contents = toContents(history);
    if (contents.length === 0) {
      // Backward-compat: a stale (pre-upgrade) client sends a flattened `context`
      // string instead of `history`. Use it so inco isn't context-blind in the
      // window before the new client is deployed.
      const blob = (typeof context === "string" && context)
        ? `${context}\n\n${triggerUsername ?? "user"}: ${triggerText}`
        : `${triggerUsername ?? "user"}: ${triggerText}`;
      contents = [{ role: "user", parts: [{ text: blob }] }];
    }

    const geminiBody = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.7 },
    };

    // Call Gemini, retrying transient upstream 5xx blips a couple of times (these
    // momentary errors used to make inco look "dead" since the client masks any
    // non-ok as a silent no-op). Not retried: 429 (quota) and permanent 4xx.
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const TRANSIENT = new Set([500, 502, 503, 504]);
    const MAX_ATTEMPTS = 3;
    let resp: Response | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      try {
        resp = await fetch(GEMINI_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiBody),
          signal: ctl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (resp.status === 429) return json({ quota: true }, 200);
      if (resp.ok) break;
      if (TRANSIENT.has(resp.status) && attempt < MAX_ATTEMPTS) {
        const detail = await resp.text().catch(() => "");
        console.warn(`Gemini transient ${resp.status} (attempt ${attempt}/${MAX_ATTEMPTS}), retrying`, detail.slice(0, 200));
        await new Promise((r) => setTimeout(r, attempt * 400));
        continue;
      }
      const detail = await resp.text();
      console.error("Gemini error", resp.status, detail.slice(0, 500));
      return json({ error: "AI_REQUEST_FAILED" }, 502);
    }
    if (!resp || !resp.ok) return json({ error: "AI_REQUEST_FAILED" }, 502);

    const data = await resp.json();
    const cand = data?.candidates?.[0];
    const rawText: string = (cand?.content?.parts ?? [])
      .map((p: { text?: string }) => p?.text ?? "")
      .join("")
      .trim();

    // Location request: only honored on the FIRST pass (loop guard). On a second
    // pass we strip any stray sentinel and answer with whatever else there is.
    if (rawText.includes(SENTINEL) && !secondPass) {
      return json({ needLocation: true }, 200);
    }
    const cleaned = rawText.split(SENTINEL).join("").trim();
    // Cap the bot reply: a crafted prompt could coax a very long response that
    // inflates the encrypted row broadcast to every member. 4000 is generous.
    const text = (cleaned || "Which city or area should I look in?").slice(0, 4000);

    const chunks = cand?.groundingMetadata?.groundingChunks ?? [];
    const sources = chunks
      .filter((c: { web?: unknown }) => c.web)
      .map((c: { web: { title?: string; uri?: string } }) => ({ title: c.web.title, uri: c.web.uri }));

    return json({ text, sources }, 200);
  } catch (e) {
    console.error("inco-ai exception", e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
