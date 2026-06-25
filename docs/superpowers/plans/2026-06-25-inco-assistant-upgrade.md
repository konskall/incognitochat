# Inco Assistant Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A noticeably better "inco" assistant — crafted persona/prompt, correct local time/date, search only when needed, coherent multi-turn memory, and on-demand consent-based location awareness.

**Architecture:** Pure, unit-tested client helpers (Nominatim city parser + history-turn builder) live in `utils/`. The edge function `inco-ai` is rewritten (new system prompt, `history`→Gemini `contents` mapping, client-supplied local time, and a `[[NEED_LOCATION]]` sentinel → `{needLocation:true}` protocol with a loop guard). `useIncoAI` sends the new fields and runs the 2-pass location flow (GPS → reverse-geocode to a city → re-invoke; denial → ask for city).

**Tech Stack:** React 18 + TS, Vite, Vitest (`npm run test`), Supabase Deno edge functions, Gemini `gemini-2.5-flash`, OSM Nominatim (keyless reverse-geocode).

## Global Constraints

- No new client secret; Gemini key stays server-side; `is_member` check unchanged.
- Location is **on-demand + per-question consent** (not always-on); only a **city/area name** reaches the edge/Gemini (never coordinates); nothing (time/location) persisted. Raw lat/lng transit OSM Nominatim once for the reverse lookup only.
- Assistant replies in **plain text (no markdown)** and in the **user's language**; no invented facts.
- `google_search` used ONLY for facts/current-events/unknowns — never for time/date/chit-chat.
- Backward compatible: a client omitting the new fields still works (edge falls back to UTC-labeled time, no location).
- Preserve existing rate-limit / 429→`{quota}` / transient-5xx retry / 4000-char cap.
- At most ONE location round-trip per question (loop guard).

---

### Task 1: Pure client helpers + tests

**Files:**
- Create: `utils/geocode.ts`
- Create: `utils/incoContext.ts`
- Test: `utils/geocode.test.ts`, `utils/incoContext.test.ts`

**Interfaces:**
- Produces:
  - `parseNominatimCity(data: unknown): string | null`
  - `reverseGeocodeCity(lat: number, lng: number): Promise<string | null>`
  - `buildIncoTurns(messages: Message[], botUuid: string, maxTurns?: number): { role: 'user' | 'model'; text: string }[]`

- [ ] **Step 1: Write the failing tests**

Create `utils/geocode.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseNominatimCity } from './geocode';

describe('parseNominatimCity', () => {
  it('prefers city, then town/village/municipality/county/state', () => {
    expect(parseNominatimCity({ address: { city: 'Thessaloniki', state: 'Central Macedonia' } })).toBe('Thessaloniki');
    expect(parseNominatimCity({ address: { town: 'Katerini' } })).toBe('Katerini');
    expect(parseNominatimCity({ address: { village: 'Litochoro' } })).toBe('Litochoro');
    expect(parseNominatimCity({ address: { municipality: 'Pylaia-Chortiatis' } })).toBe('Pylaia-Chortiatis');
    expect(parseNominatimCity({ address: { county: 'Thessaloniki Regional Unit' } })).toBe('Thessaloniki Regional Unit');
    expect(parseNominatimCity({ address: { state: 'Attica' } })).toBe('Attica');
  });
  it('returns null when no usable field / malformed input', () => {
    expect(parseNominatimCity({ address: {} })).toBeNull();
    expect(parseNominatimCity({})).toBeNull();
    expect(parseNominatimCity(null)).toBeNull();
    expect(parseNominatimCity('nope')).toBeNull();
  });
});
```

Create `utils/incoContext.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildIncoTurns } from './incoContext';
import { Message } from '../types';

const BOT = '00000000-0000-0000-0000-000000000000';
const msg = (over: Partial<Message>): Message => ({
  id: 'x', text: 'hi', uid: 'u1', username: 'Alice', avatarURL: '', createdAt: '2026-06-25T10:00:00Z', ...over,
});

describe('buildIncoTurns', () => {
  it('maps users to user turns (name-prefixed) and the bot to model turns', () => {
    const out = buildIncoTurns([
      msg({ uid: 'u1', username: 'Alice', text: 'hello' }),
      msg({ uid: BOT, username: 'inco', text: 'hi Alice' }),
    ], BOT);
    expect(out).toEqual([
      { role: 'user', text: 'Alice: hello' },
      { role: 'model', text: 'hi Alice' },
    ]);
  });
  it('drops system + empty-text messages and caps to maxTurns (last N)', () => {
    const many = Array.from({ length: 20 }, (_, i) => msg({ id: String(i), text: `m${i}`, username: 'Bob', uid: 'u2' }));
    many.splice(0, 0, msg({ type: 'system', text: 'Room created' }), msg({ text: '' }));
    const out = buildIncoTurns(many, BOT, 16);
    expect(out.length).toBe(16);
    expect(out.every((t) => t.role === 'user')).toBe(true);
    expect(out[out.length - 1].text).toBe('Bob: m19');
  });
  it('truncates long message text to 300 chars (plus the name prefix)', () => {
    const long = 'a'.repeat(500);
    const out = buildIncoTurns([msg({ uid: 'u1', username: 'Al', text: long })], BOT);
    expect(out[0].text).toBe(`Al: ${'a'.repeat(300)}`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- geocode incoContext`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the helpers**

Create `utils/geocode.ts`:
```ts
// Reverse-geocode coordinates to a city/area NAME using the keyless OSM Nominatim
// service (same provider as the location-message map tiles). Only the name is ever
// passed on to the AI — never the coordinates. Low volume (only when inco needs a
// location), so Nominatim's usage policy is satisfied by the browser Referer.

export function parseNominatimCity(data: unknown): string | null {
  const a = (data as { address?: Record<string, string> } | null)?.address;
  if (!a || typeof a !== 'object') return null;
  return a.city || a.town || a.village || a.municipality || a.county || a.state || null;
}

export async function reverseGeocodeCity(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10`;
    const resp = await fetch(url, { headers: { 'Accept-Language': navigator.language || 'en' } });
    if (!resp.ok) return null;
    return parseNominatimCity(await resp.json());
  } catch {
    return null;
  }
}
```

Create `utils/incoContext.ts`:
```ts
import { Message } from '../types';

// Turn the held messages into Gemini-style conversation turns so inco follows the
// thread (instead of one flattened blob). The bot's own messages become 'model'
// turns; everyone else is a 'user' turn prefixed with their name (group chat).
export function buildIncoTurns(
  messages: Message[],
  botUuid: string,
  maxTurns = 16,
): { role: 'user' | 'model'; text: string }[] {
  return messages
    .filter((m) => m.type !== 'system' && m.text)
    .slice(-maxTurns)
    .map((m) =>
      m.uid === botUuid
        ? { role: 'model' as const, text: m.text.substring(0, 300) }
        : { role: 'user' as const, text: `${m.username}: ${m.text.substring(0, 300)}` },
    );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- geocode incoContext`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → no errors.
```bash
git add utils/geocode.ts utils/incoContext.ts utils/geocode.test.ts utils/incoContext.test.ts
git commit -m "feat(inco): pure reverse-geocode + conversation-turn helpers"
```

---

### Task 2: Edge function rewrite (`inco-ai`)

**Files:**
- Modify: `supabase/functions/inco-ai/index.ts` (full rewrite of the prompt-build + body-parse + contents + sentinel/location sections; membership/rate-limit/retry logic preserved)

**Interfaces:**
- Consumes (request body): `{ roomKey, roomName, history?: {role,text}[], triggerText, triggerUsername, clientDateTime?, locationCity?, locationDenied? }`
- Produces (200): `{ text, sources }` | `{ needLocation: true }` | `{ quota: true }`

- [ ] **Step 1: Replace the file with the new implementation**

Replace the entire contents of `supabase/functions/inco-ai/index.ts` with:

```ts
// Supabase Edge Function: inco-ai
// Server-side proxy for the "inco" Gemini assistant. Holds GEMINI_API_KEY as a
// server secret, verifies the caller is a signed-in MEMBER of the room, calls
// Gemini, and returns text + grounding sources (or a location request). The client
// encrypts + inserts the bot message itself (PIN/key never leave the client).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_MODEL = "gemini-2.5-flash";

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
      roomKey, roomName, history, triggerText, triggerUsername,
      clientDateTime, locationCity, locationDenied,
    } = await req.json().catch(() => ({}));

    if (!roomKey || !triggerText) return json({ error: "BAD_REQUEST" }, 400);

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

    // Conversation as proper turns; fall back to a single user turn if no history.
    let contents = toContents(history);
    if (contents.length === 0) {
      contents = [{ role: "user", parts: [{ text: `${triggerUsername ?? "user"}: ${triggerText}` }] }];
    }

    const geminiBody = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.7 },
    };

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
```

- [ ] **Step 2: Commit**

(No local typecheck for the Deno edge file — it's deployed/verified in Task 4. The client `tsc` is unaffected by this file.)
```bash
git add supabase/functions/inco-ai/index.ts
git commit -m "feat(inco): rewrite edge — persona/prompt, client time, turn-context, location protocol"
```

---

### Task 3: Client wiring (`useIncoAI`)

**Files:**
- Modify: `hooks/useIncoAI.ts` (build + send `clientDateTime` + `history`; run the 2-pass location flow)

**Interfaces:**
- Consumes: `buildIncoTurns` (Task 1, `utils/incoContext`), `reverseGeocodeCity` (Task 1, `utils/geocode`), the edge contract (Task 2).

- [ ] **Step 1: Add the imports**

In `hooks/useIncoAI.ts`, add near the top imports:
```ts
import { buildIncoTurns } from '../utils/incoContext';
import { reverseGeocodeCity } from '../utils/geocode';
```

- [ ] **Step 2: Add the location helper + 2-pass invoke inside `handleBotResponse`**

Replace the body of `handleBotResponse` from the `const context = …` block through the `supabase.functions.invoke('inco-ai', …)` call (currently building `context` and doing a single invoke) with the 2-pass version. Concretely, replace:
```ts
      const context = chatHistory
        .slice(-10)
        .filter(m => m.type !== 'system' && m.text)
        .map(m => `${m.username}: ${m.text.substring(0, 300)}`)
        .join('\n');

      // Gemini is called server-side (Edge Function `inco-ai`) so the API key is
      // never shipped to the browser. The function verifies room membership and
      // returns plaintext + grounding sources; we encrypt + insert client-side so
      // the room PIN / encryption key never leaves the device.
      const { data, error } = await supabase.functions.invoke('inco-ai', {
        body: {
          roomKey,
          roomName: config.roomName,
          context,
          triggerText: triggerMsg.text,
          triggerUsername: triggerMsg.username,
        },
      });

      if (error) {
        // 403 (not a member) / 503 (AI not configured) / 5xx — stay silent.
        console.error('Inco AI proxy error:', error);
        return;
      }
```
with:
```ts
      // Conversation as proper turns (the bot's own msgs as 'model'), so inco
      // follows the thread on follow-ups. The trigger is the last user turn.
      const history = buildIncoTurns(chatHistory, INCO_BOT_UUID);
      // The user's LOCAL date/time, formatted on-device (the edge runs in UTC).
      const clientDateTime = new Date().toLocaleString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
      });

      const baseBody = {
        roomKey,
        roomName: config.roomName,
        history,
        triggerText: triggerMsg.text,
        triggerUsername: triggerMsg.username,
        clientDateTime,
      };

      // Gemini is called server-side (Edge Function `inco-ai`) so the API key is
      // never shipped to the browser. We encrypt + insert the reply client-side so
      // the room PIN / encryption key never leaves the device.
      let { data, error } = await supabase.functions.invoke('inco-ai', { body: baseBody });
      if (error) { console.error('Inco AI proxy error:', error); return; }

      // Location protocol: the model asked for the user's location. Request GPS
      // ONCE (on-demand consent), reverse-geocode to a CITY NAME client-side, and
      // re-invoke. Denial / unavailable / geocode-fail → re-invoke with a denied
      // flag so inco asks for the city instead of stalling. (Coords never leave
      // the device except to OSM Nominatim for the lookup; only the city is sent.)
      if ((data as { needLocation?: boolean })?.needLocation) {
        let city: string | null = null;
        if (navigator.geolocation) {
          try {
            const pos = await new Promise<GeolocationPosition>((res, rej) =>
              navigator.geolocation.getCurrentPosition(res, rej, { timeout: 15000, maximumAge: 600000 }),
            );
            city = await reverseGeocodeCity(pos.coords.latitude, pos.coords.longitude);
          } catch { city = null; }
        }
        const second = await supabase.functions.invoke('inco-ai', {
          body: city ? { ...baseBody, locationCity: city } : { ...baseBody, locationDenied: true },
        });
        if (second.error) { console.error('Inco AI proxy error (loc):', second.error); return; }
        data = second.data;
      }
```

(Everything after — the `data?.quota` branch, `data?.text` insert with `reply_to`, grounding, and the `finally { isBusy.current = false; setIsResponding(false); }` — stays exactly as-is. `let` is used for `data`/`error` so the location branch can reassign.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full suite**

Run: `npm run test`
Expected: all green (Task 1's new tests + existing 106).

- [ ] **Step 5: Build + commit**

Run: `npm run build` → succeeds.
```bash
git add hooks/useIncoAI.ts
git commit -m "feat(inco): send client time + turn-context; on-demand location 2-pass"
```

---

### Task 4: Deploy edge function + integration verification

**Files:** none (deploy + verification)

- [ ] **Step 1: Deploy the edge function**

Deploy `inco-ai` to project `qygirixqsuraclbdfnjp` (Supabase MCP `deploy_edge_function`, or `supabase functions deploy inco-ai`). The `GEMINI_API_KEY` secret is already set (unchanged).

- [ ] **Step 2: Manual / Playwright E2E in a room with AI enabled**

In a room with inco enabled, verify:
- "τι ώρα είναι;" → answers the **correct local time** (matches your device), no web search, no markdown.
- A normal message ("πώς πάει;") → friendly reply, no time/location volunteered, plain text.
- A factual/current question ("ποιος κέρδισε το Champions League φέτος;") → uses search (grounding sources chip appears).
- "θέλω την καλύτερη pizza" (no city) → browser GPS prompt appears. **Grant** → local pizza suggestions for your reverse-geocoded city. **Deny** → inco asks which city (no stall, "thinking" clears).
- Follow-up after a bot answer ("και κοντά μου;") → coherent (structured turns).
- Reply-to-inco still triggers a response (unchanged trigger path).

- [ ] **Step 3: Confirm clean tree**

Run: `git status` → clean; `npx tsc --noEmit && npm run test && npm run build` → all pass.

---

## Notes for the executor

- `INCO_BOT_UUID` already exists in `hooks/useIncoAI.ts` — reuse it (don't redefine).
- Do NOT change the `data?.quota` / insert / `reply_to` / grounding / `finally` logic in `handleBotResponse` — only the context-build + invoke section.
- The edge file has no repo unit tests (Deno) — its correctness is gated by Task 4 deploy + E2E. The unit-tested logic was extracted into Task 1 helpers.
- Keep `temperature: 0.7`, the 4000-char cap, retry/timeout, rate-limit, and `{quota}` exactly as in the rewrite above.
- Nominatim: no API key; the browser Referer satisfies its low-volume usage policy. Treat any failure as "no city" (→ denied path).
