import * as Sentry from '@sentry/react';

// Public client DSN — safe to ship in the bundle (it only identifies WHERE to
// send events; it is not a secret), exactly like the Supabase anon key in
// services/supabaseConfig.ts. Paste your Sentry project's DSN below. While it is
// empty, initSentry() is a no-op, so nothing is ever sent.
//   Find it: Sentry → Settings → Projects → <project> → Client Keys (DSN).
const SENTRY_DSN = 'https://9daec6985e7cf5c6cf727738ce780e11@o4511616170393600.ingest.de.sentry.io/4511616424018000';

let started = false;

// Strip the query string from a URL. The invite deep-link is `/?room=NAME&pin=PIN`,
// so a raw room PIN (and room name) could otherwise ride along in an event's
// request URL or in navigation/fetch breadcrumbs. We never want that off-device.
function stripQuery(url: string): string {
  if (typeof url !== 'string') return url;
  const i = url.indexOf('?');
  const h = url.indexOf('#');
  const cut = Math.min(i === -1 ? url.length : i, h === -1 ? url.length : h);
  return url.slice(0, cut);
}

// Error monitoring ONLY. Deliberately NO Session Replay (it would record chat
// content + masked or not, it's the wrong fit for a privacy-first anonymous chat)
// and NO performance tracing (route-less SPA + a free Sentry tier). Both are easy
// opt-ins later by adding the respective integration. Initialised lazily and only
// in production builds so local `vite dev` stays silent.
export function initSentry(): void {
  if (started || !SENTRY_DSN || !import.meta.env.PROD) return;
  started = true;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    // No integrations key → keep Sentry's safe defaults (global error +
    // unhandledrejection handlers, breadcrumbs, dedupe) but DON'T add the
    // browser-tracing or replay integrations, i.e. errors only.
    sendDefaultPii: false, // never attach IP address or request headers
    beforeSend(event) {
      // Scrub any query string the SDK attached to the event URL.
      if (event.request?.url) event.request.url = stripQuery(event.request.url);
      return event;
    },
    beforeBreadcrumb(crumb) {
      // Scrub query strings from navigation / fetch / xhr breadcrumb URLs.
      const data = crumb.data as Record<string, unknown> | undefined;
      if (data) {
        for (const key of ['url', 'from', 'to']) {
          if (typeof data[key] === 'string') data[key] = stripQuery(data[key] as string);
        }
      }
      return crumb;
    },
  });
}

// Thin wrapper so call sites (e.g. ErrorBoundary) report errors without importing
// the SDK directly. No-op until a DSN is set / Sentry is initialised.
export function captureException(error: unknown, componentStack?: string | null): void {
  if (!started) return;
  Sentry.captureException(
    error,
    componentStack ? { contexts: { react: { componentStack } } } : undefined,
  );
}
