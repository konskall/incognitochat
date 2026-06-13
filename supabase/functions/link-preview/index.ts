// Supabase Edge Function: link-preview
//
// WHY: link previews used to be fetched client-side from api.microlink.io —
// rate-limited, flaky, and it leaked every visited URL from every client to a
// third party. This fetches the Open Graph metadata server-side instead, with a
// long Cache-Control so the CDN can serve repeats.
//
// Safety: verify_jwt is enabled (so this isn't an open proxy), the caller must
// be a signed-in user and is rate-limited per uid (so a member can't script it
// into an SSRF probe / anonymizing fetch-relay / cost amplifier), it only
// fetches public http(s) hosts (SSRF guard), times out, and caps how much HTML
// it reads. SUPABASE_URL / SUPABASE_ANON_KEY are injected by the platform.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Per-caller sliding-window rate limit (in-memory; warm isolates reused across a
// burst). verify_jwt only proves "a Supabase caller", not "a trusted one" — this
// bounds a single identity's realistic abuse. Not a hard cross-isolate guarantee.
const RL_WINDOW_MS = 60_000;
const RL_MAX = 20;
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

function json(payload: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

// Reject obviously-private / local targets (basic SSRF guard).
function toPublicHttpUrl(raw: string, base?: string | URL): URL | null {
  let u: URL;
  try { u = base ? new URL(raw, base) : new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  // WHATWG URL wraps IPv6 hostnames in brackets ("[::1]") — strip them before
  // matching, or every IPv6 private/loopback check silently never fires.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") return null;
  // IPv4 private / loopback / link-local / CGNAT.
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return null;
  // IPv6 loopback (::1), unspecified (::), ULA (fc00::/7), link-local (fe80::/10),
  // and IPv4-mapped (::ffff:a.b.c.d → re-check the embedded IPv4).
  if (host === "::1" || host === "::") return null;
  if (/^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return null;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d): the WHATWG URL parser normalizes the
  // embedded IPv4 to compressed HEX (so http://[::ffff:127.0.0.1]/ becomes host
  // "::ffff:7f00:1" and http://[::ffff:169.254.169.254]/ becomes "::ffff:a9fe:a9fe").
  // The old dotted-decimal regex therefore NEVER matched — it was dead code that
  // let loopback and the 169.254.169.254 cloud-metadata endpoint through. There
  // is no legitimate public-preview reason to fetch any ::ffff: address, so
  // blanket-reject the whole IPv4-mapped range (covers both hex and dotted forms).
  if (host.startsWith("::ffff:")) return null;
  return u;
}

function decodeEntities(s?: string) {
  return s
    ? s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    : s;
}

function extractMeta(html: string, url: URL) {
  const pick = (re: RegExp) => html.match(re)?.[1]?.trim();
  const meta = (prop: string) =>
    pick(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i")) ||
    pick(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i"));

  const title = decodeEntities(meta("og:title") || meta("twitter:title") || pick(/<title[^>]*>([^<]*)<\/title>/i));
  const description = decodeEntities(meta("og:description") || meta("twitter:description") || meta("description"));
  let image = meta("og:image") || meta("twitter:image");
  const publisher = decodeEntities(meta("og:site_name")) || url.hostname.replace(/^www\./, "");

  if (image) { try { image = new URL(image, url).href; } catch { /* keep as-is */ } }

  return { title, description, image, publisher };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { url } = await req.json().catch(() => ({}));
    const target = typeof url === "string" ? toPublicHttpUrl(url) : null;
    if (!target) return json({ error: "INVALID_URL" }, 400);

    // Require an authenticated caller and rate-limit per uid. An unthrottled
    // authenticated fetch-proxy is still an SSRF probe surface, an anonymizing
    // relay (the target sees the Supabase egress IP, not the user), and a cost
    // amplifier — so gate it.
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await sb.auth.getUser();
    const callerUid = userData?.user?.id;
    if (!callerUid) return json({ error: "AUTH_REQUIRED" }, 401);
    if (rateLimited(callerUid)) return json({ error: "RATE_LIMITED" }, 429);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let resp: Response;
    try {
      // Follow redirects MANUALLY so every hop is re-validated against the SSRF
      // guard — redirect:"follow" would let a public host 302 us to an internal
      // address (http://[::1]/, 169.254.169.254, …) unchecked.
      let current = target;
      let hops = 0;
      for (;;) {
        resp = await fetch(current.href, {
          signal: controller.signal,
          redirect: "manual",
          headers: {
            "User-Agent": "IncognitoChatBot/1.0 (+link-preview)",
            "Accept": "text/html,application/xhtml+xml,*/*",
          },
        });
        if (resp.status >= 300 && resp.status < 400) {
          const loc = resp.headers.get("location");
          const next = loc ? toPublicHttpUrl(loc, current) : null;
          try { await resp.body?.cancel(); } catch { /* ignore */ }
          if (!next || ++hops > 4) return json({ data: null }, 200, { "Cache-Control": "public, max-age=3600" });
          current = next;
          continue;
        }
        break;
      }
    } finally {
      clearTimeout(timer);
    }

    const contentType = resp.headers.get("content-type") || "";
    if (!resp.ok || !contentType.includes("text/html")) {
      return json({ data: null }, 200, { "Cache-Control": "public, max-age=3600" });
    }

    // Read at most ~512KB and stop once <head> closes (meta tags live there).
    let html = "";
    const reader = resp.body?.getReader();
    if (reader) {
      const dec = new TextDecoder();
      const MAX = 512 * 1024;
      let total = 0;
      while (total < MAX) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        html += dec.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
      try { await reader.cancel(); } catch { /* ignore */ }
    } else {
      html = await resp.text();
    }

    const meta = extractMeta(html, target);
    if (!meta.title) return json({ data: null }, 200, { "Cache-Control": "public, max-age=3600" });

    return json({ data: meta }, 200, { "Cache-Control": "public, max-age=86400" });
  } catch (e) {
    console.error("link-preview error", e);
    return json({ data: null }, 200);
  }
});
