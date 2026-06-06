// Supabase Edge Function: inco-ai
// Server-side proxy for the "inco" Gemini assistant.
//
// WHY: previously the Gemini API key was injected into the client bundle
// (anyone could extract it and burn the owner's quota/billing). This function
// holds the key as a server-side secret (GEMINI_API_KEY), verifies the caller
// is a signed-in MEMBER of the room, then calls Gemini and returns the text +
// grounding sources. The client encrypts and inserts the bot message itself
// (so the room PIN / encryption key never leaves the client).
//
// Required secret:  GEMINI_API_KEY   (set via `supabase secrets set` or the
// Dashboard -> Edge Functions -> Manage secrets). SUPABASE_URL and
// SUPABASE_ANON_KEY are injected automatically by the platform.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_MODEL = "gemini-2.5-flash";

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
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      // Not configured yet — tell the client to stay quiet rather than error loudly.
      return json({ error: "AI_NOT_CONFIGURED" }, 503);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const {
      roomKey,
      roomName,
      context,
      triggerText,
      triggerUsername,
    } = await req.json().catch(() => ({}));

    if (!roomKey || !triggerText) return json({ error: "BAD_REQUEST" }, 400);

    // Verify the caller is a member of the room (runs is_member() as the caller).
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: isMember, error: memErr } = await sb.rpc("is_member", {
      p_room_key: roomKey,
    });
    if (memErr || !isMember) return json({ error: "NOT_A_MEMBER" }, 403);

    // --- Build the prompt (no geolocation: removed for privacy) ---
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const timeStr = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const systemInstruction = `You are "inco", a helpful chat assistant in the room "${roomName ?? ""}".

BACKGROUND DATA (Internal use only):
- Date: ${dateStr}
- Time: ${timeStr}

STRICT RULES:
1. NEVER mention the current time or date in your response unless the user explicitly asks for it (e.g., "what time is it?").
2. Reply in the same language the user writes in (detect it from their message). If the user explicitly asks you to answer in another language, switch to that language and keep using it for the rest of the conversation.
3. Be concise and friendly. Use Google Search ONLY when necessary for facts or current events.
4. Do not start your sentences with "Today is..." or "The time is..." unless relevant.`;

    const userContent =
      `Recent conversation:\n${context ?? ""}\n\nUser ${triggerUsername ?? "user"}: ${triggerText}`;

    const geminiBody = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: userContent }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.7 },
    };

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody),
      },
    );

    if (resp.status === 429) return json({ quota: true }, 200);
    if (!resp.ok) {
      const detail = await resp.text();
      console.error("Gemini error", resp.status, detail.slice(0, 500));
      return json({ error: "AI_REQUEST_FAILED" }, 502);
    }

    const data = await resp.json();
    const cand = data?.candidates?.[0];
    const text: string = (cand?.content?.parts ?? [])
      .map((p: { text?: string }) => p?.text ?? "")
      .join("")
      .trim();

    const chunks = cand?.groundingMetadata?.groundingChunks ?? [];
    const sources = chunks
      .filter((c: { web?: unknown }) => c.web)
      .map((c: { web: { title?: string; uri?: string } }) => ({
        title: c.web.title,
        uri: c.web.uri,
      }));

    return json({ text, sources }, 200);
  } catch (e) {
    console.error("inco-ai exception", e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
