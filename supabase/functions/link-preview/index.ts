// Supabase Edge Function: link-preview
//
// WHY: link previews used to be fetched client-side from api.microlink.io —
// rate-limited, flaky, and it leaked every visited URL from every client to a
// third party. This fetches the Open Graph metadata server-side instead, with a
// long Cache-Control so the CDN can serve repeats.
//
// Safety: verify_jwt is enabled (so this isn't an open proxy), it only fetches
// public http(s) hosts (basic SSRF guard), times out, and caps how much HTML it
// reads. SUPABASE_URL / SUPABASE_ANON_KEY are injected by the platform.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

// Reject obviously-private / local targets (basic SSRF guard).
function toPublicHttpUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1") return null;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return null;
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let resp: Response;
    try {
      resp = await fetch(target.href, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "IncognitoChatBot/1.0 (+link-preview)",
          "Accept": "text/html,application/xhtml+xml,*/*",
        },
      });
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
