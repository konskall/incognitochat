# Inco Assistant Upgrade — Design Spec

**Date:** 2026-06-25
**Status:** Approved (design) — pending implementation plan
**Goal:** Make the "inco" AI assistant noticeably better overall: a well-crafted persona/prompt, correct local time/date, search used only when needed, coherent multi-turn memory, and on-demand, consent-based location awareness (so "best pizza near me" works).

**Scope:** Two files — `supabase/functions/inco-ai/index.ts` (edge) + `hooks/useIncoAI.ts` (client) — plus a redeploy of the edge function. No DB changes. No new dependencies (reverse-geocoding uses the keyless OSM/Nominatim service, consistent with the existing OSM map tiles).

---

## Global Constraints

- **No new client secret.** Gemini key stays server-side (`GEMINI_API_KEY`). Membership is verified server-side (`is_member`) — unchanged.
- **Privacy:** location is **on-demand + per-question consent** (NOT always-on — the old always-on geolocation was deliberately removed; this re-introduction is gated on an explicit GPS grant each time the model needs it). Only a **city/area name** (reverse-geocoded client-side) reaches the edge/Gemini — never raw coordinates. The raw lat/lng do transit OSM Nominatim once for the reverse lookup (same third party the existing location-message map tiles already use) and are never stored. Nothing (time, location) is persisted; both are transient prompt inputs to the membership-gated edge function.
- **Reply rendering:** the chat renders plain text (no markdown) — the assistant must reply in plain text.
- **Encryption:** the bot reply is still encrypted + inserted client-side (PIN/key never leaves the device) — unchanged.
- **Backward compatible:** a stale client that omits the new fields still works (edge falls back to a UTC-labeled time, no location).
- **Rate limit / quota / retries:** the existing per-uid sliding window, 429→`{quota}`, and transient-5xx retry logic are preserved. The 2-pass location flow must not multiply quota cost unfairly (see E).

---

## A. Persona + prompt rework

Replace the current minimal/confusing `systemInstruction`. New instruction (built server-side), in spirit:

```
You are "inco", a warm, concise, genuinely helpful assistant inside the chat room "<room>". Multiple people may be talking.

CURRENT DATE & TIME (the user's local time): <clientDateTime or "(UTC) <utc>">
<USER LOCATION: <city>>   // only present on a location-resolved 2nd pass

GUIDELINES:
- Reply in the SAME language the user writes in; if they ask you to switch, keep the new language.
- Be concise and friendly. Plain text only — NO markdown (no **, #, bullet syntax); the chat shows raw text.
- If the user asks the date or time, answer directly from CURRENT DATE & TIME above. Never use web search for the time/date.
- Use Google Search ONLY for facts, current events, or things you don't know — not for chit-chat, opinions, or the time.
- If you don't know or aren't sure, say so briefly. Do NOT invent facts, links, names, or numbers.
- Don't volunteer the date/time/location unless it's relevant to the user's message.
- LOCATION: if answering well REQUIRES the user's physical location (e.g. "best pizza near me", "weather here", nearby places) and no USER LOCATION is given, reply with EXACTLY `[[NEED_LOCATION]]` and nothing else — do not guess a city, do not search. If USER LOCATION is given, use it. If the user already named a place, just use that.
```

## B. Correct local time/date

**Client** (`useIncoAI.handleBotResponse`) computes its local datetime once and sends it:
```ts
const clientDateTime = new Date().toLocaleString(undefined, {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
}); // e.g. "Tuesday, June 25, 2026 at 3:45 PM GMT+3"
```
Sent in the edge body as `clientDateTime`. **Edge** injects it verbatim into CURRENT DATE & TIME. If absent (old client), edge falls back to the current UTC time explicitly labeled `(UTC)`. The edge no longer relies on its own (UTC) clock for the user-facing time.

## C. Smarter google_search

The `google_search` tool stays available (Gemini decides per-call), but the prompt (A) explicitly forbids using it for time/date/chit-chat and scopes it to facts/current-events/unknowns. No architectural change (no two-pass for search) — the steer is sufficient and keeps latency/cost down.

## D. Structured multi-turn context

Today the whole history is flattened into one `user` message, so inco loses the thread on follow-ups. Instead:

- **Client** sends `history`: the last **16** non-system messages (was 10), each `{ role, text }` where `role = 'model'` if `uid === INCO_BOT_UUID` else `'user'`, and `text` is `"<username>: <message, ≤300 chars>"` for user turns (so inco knows who said what in a group) and the raw text for its own model turns. The triggering message is the final `user` turn.
- **Edge** maps `history` into Gemini `contents` (role `user`/`model`), **merging consecutive same-role turns** into one part (Gemini expects alternating roles; merging keeps it valid for a multi-human room). The trigger is already the last user turn — no separate `triggerText` blob needed, but `triggerText`/`triggerUsername` are still sent for the location/loop logic and as a fallback.

## E. Location-aware Inco (on-demand, consent-based, 2-pass)

**Pass 1** — `useIncoAI` invokes `inco-ai` with the question (no location). The edge runs Gemini; if the model returns the sentinel `[[NEED_LOCATION]]` as its entire reply, the edge responds `{ needLocation: true }` (instead of a message). Otherwise it returns `{ text, sources }` as today.

**Client on `needLocation: true`:**
1. Request GPS via the existing geolocation path (reuse `navigator.geolocation.getCurrentPosition` + the `PermissionModal` UX already used by `handleSendLocation`). Keep `isResponding` (the "inco is thinking…" indicator) on through this.
2. **Granted →** reverse-geocode the coords **client-side** via OSM Nominatim (`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=..&lon=..&zoom=10`, with a descriptive `User-Agent`/`Accept-Language`), extract a city/town/municipality/region name (NOT coordinates). Re-invoke `inco-ai` with `locationCity: "<name>"`. Edge adds `USER LOCATION: <name>` to the prompt → Gemini answers (search allowed).
3. **Denied / unavailable / timeout / geocode-fail →** re-invoke `inco-ai` with `locationDenied: true`. Edge prompt note: "the user declined to share location — ask them which city/area, or answer generally." Gemini asks for the city in the user's language. (No raw coordinates are ever sent in any branch.)

**Loop guard:** on a 2nd pass (`locationCity` OR `locationDenied` present), the edge must NOT honor a sentinel again — if Gemini still emits `[[NEED_LOCATION]]`, strip it and fall back to a plain "tell me your city" reply. Guarantees at most one location round-trip per question.

**Quota/cost:** the 2-pass uses two Gemini calls only when location is actually needed (rare relative to normal chat). The existing per-uid rate limit still applies to each call. Acceptable.

---

## Edge request/response contract (after changes)

Request body (POST `inco-ai`):
```
{ roomKey, roomName, history?: {role:'user'|'model', text:string}[], triggerText, triggerUsername,
  clientDateTime?: string, locationCity?: string, locationDenied?: boolean }
```
Response (200):
```
{ text: string, sources: {title,uri}[] }   // normal answer
{ needLocation: true }                       // pass 1, model asked for location
{ quota: true }                              // unchanged
```
Errors: unchanged (`AI_NOT_CONFIGURED` 503, `BAD_REQUEST` 400, `AUTH_REQUIRED` 401, `NOT_A_MEMBER` 403, `RATE_LIMITED` 429, `AI_REQUEST_FAILED` 502, `SERVER_ERROR` 500).

## Error handling

- Reuse existing retry/timeout/quota/rate-limit. `needLocation` and `quota` are 200 responses (not errors), so the client's "any-error → silent" path is unaffected.
- Geolocation errors (deny/timeout/unsupported) → treated as "denied" → pass 2 with `locationDenied` (graceful, never a dead "thinking" state). `isBusy`/`isResponding` cleared in `finally` across both passes.
- Nominatim failure → treat as denied (ask for city). Never blocks.

## Testing

- **Edge (manual / Playwright E2E in a room):**
  - "τι ώρα είναι" → correct LOCAL time, no web search, answered directly.
  - Normal question → no time/location volunteered; plain text (no markdown).
  - Factual/current-event question → uses search (grounding sources appear).
  - "θέλω την καλύτερη pizza" (no city) → triggers GPS prompt; grant → local results for the reverse-geocoded city; deny → inco asks for the city.
  - Follow-up question ("και κοντά μου;") → coherent thanks to structured turns.
- **Client:** the `clientDateTime` + history-mapping + geolocation/geocode flow verified via Playwright (mock geolocation) + manual. The reverse-geocode parse (coords→city) is a small pure helper → unit-testable.
- All existing tests + tsc + build stay green; edge function deploys cleanly.
