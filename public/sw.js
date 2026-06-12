// Incognito Chat service worker — offline app shell + Web Push.

// Bumped on every push-logic change; the page can query it (INCO_GET_VERSION)
// and shows it in the UI, so a device running a stale SW is diagnosable
// without devtools (iOS especially).
const SW_VERSION = 'push-v9';

const CACHE = 'incognito-cache-v2';
// Page-written suppression beacon (see utils/swBridge.ts): MUST survive the
// activate-time cache cleanup below.
const STATE_CACHE = 'inco-state-v1';
const BEACON_FRESH_MS = 25000;
// WebKit enforces userVisibleOnly with a SILENT-PUSH BUDGET (~3 consecutive
// pushes without a shown notification revoke the subscription, with no
// visible-client exemption like Chrome's). So suppression must be bounded:
// after MAX_SILENT consecutive suppressed pushes we force-show the (tagged,
// collapsed) notification anyway — the page's INCO_PUSH_SHOWN handler closes
// it instantly when the user really is looking at that room, so on desktop
// it's invisible and on iOS it's an occasional flash instead of a revoked
// subscription (= every future push lost).
const MAX_SILENT = 2;
const SUPPRESS_COUNT_KEY = '__inco_suppress_n';
// Resolve the deploy base (e.g. "/incognitochat/") from the SW's own location so
// this works identically on GitHub Pages and in local dev.
const BASE = self.location.pathname.replace(/sw\.js$/, '');
const APP_SHELL = [
  BASE,
  BASE + 'index.html',
  BASE + 'favicon-96x96.png',
  BASE + 'site.webmanifest',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older versions (but never the page's state beacon).
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE && k !== STATE_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never touch cross-origin traffic (Supabase API/realtime, avatar CDNs, fonts).
  if (url.origin !== self.location.origin) return;
  // Stay out of the way of the Vite dev server so HMR keeps working.
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return;

  // App navigations: network-first so new deploys are picked up, falling back to
  // the cached shell so the app still opens offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(async () =>
          (await caches.match(req)) ||
          (await caches.match(BASE + 'index.html')) ||
          (await caches.match(BASE)) ||
          Response.error()
        )
    );
    return;
  }

  // Static assets (content-hashed JS/CSS, icons): stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// --- Web Push (delivered by the `send-push` Edge Function) ---
self.addEventListener('push', (event) => {
  // Do NOT gate on `self.Notification` here. In the iOS/WebKit service-worker
  // scope the `Notification` interface does not exist, so the old guard
  // (`self.Notification && self.Notification.permission === 'granted'`) was
  // ALWAYS falsy on iPhone/iPad and silently dropped every push — which is why
  // the installed PWA "got no notifications" on iOS. If a push was delivered at
  // all, the subscription already has permission, and the Push API's
  // `userVisibleOnly` contract REQUIRES showing a notification for every push
  // (iOS revokes the subscription otherwise), so always show one.
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch {
    // Malformed/empty payload — fall back to a generic message below.
  }

  const title = data.title || 'New Message';
  const tag = data.roomKey ? `room:${data.roomKey}` : undefined;
  const options = {
    body: data.body || 'You have a new message',
    icon: BASE + 'favicon-96x96.png',
    badge: BASE + 'favicon-96x96.png',
    vibrate: [100, 50, 100],
    // One stacked notification per room (collapses a burst into one) and a
    // stable handle the page can use to close it. renotify still alerts on each
    // new message instead of updating silently.
    tag,
    renotify: true,
    data: {
      url: data.url || BASE,
      roomKey: data.roomKey,
    },
    actions: [{ action: 'open', title: 'Open Chat' }],
  };

  // Suppress ONLY on an affirmative, FRESH signal; otherwise ALWAYS show.
  // Two independent channels (either suffices):
  //   1. The Cache Storage beacon the page heartbeats while visible — read
  //      synchronously here, no message round-trip (immune to the iOS/WebKit
  //      postMessage quirks). Stale beacon (>25s) is ignored, so a closed or
  //      backgrounded PWA can't suppress anything.
  //   2. The live INCO_QUERY_ACTIVE_ROOM round-trip to every open tab.
  // Suppression applies when the user is VIEWING THIS ROOM or is on the
  // DASHBOARD (which shows live unread badges — an OS banner there is noise).
  // A closed PWA / suspended tab answers neither and the push shows, so a
  // notification can never be lost to stale state. Asking BEFORE showing
  // matters on iOS: show-then-close still flashed the OS banner.
  // After showing we still broadcast INCO_PUSH_SHOWN so a tab that became
  // visible mid-flight can dismiss the stale banner (belt & suspenders).
  event.waitUntil(
    (async () => {
      const suppress = await shouldSuppressPush(data.roomKey);
      if (suppress) {
        // Bound the consecutive-silent streak (see MAX_SILENT above): stay
        // under WebKit's silent-push budget by force-showing every Nth push.
        const n = await readSuppressCount();
        if (n < MAX_SILENT) {
          await writeSuppressCount(n + 1);
          return;
        }
        // Fall through to show (and reset the counter below).
      }

      await writeSuppressCount(0);
      await self.registration.showNotification(title, options);
      try {
        const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of wins) {
          c.postMessage({ type: 'INCO_PUSH_SHOWN', roomKey: data.roomKey || null, tag });
        }
      } catch {
        // Best-effort only; the notification is already shown.
      }
    })()
  );
});

// --- "Is anyone looking at this room?" query, WITHOUT MessagePort transfer ---
// The first version transferred a MessageChannel port with the query, but
// MessagePort transfer from a service worker to a window has a history of
// silently failing on iOS/WebKit — the page never saw the port, the query timed
// out and the banner showed anyway. Plain postMessage in BOTH directions is
// reliable everywhere: the SW broadcasts INCO_QUERY_ACTIVE_ROOM {qid}, the page
// answers with INCO_ANSWER_ACTIVE_ROOM {qid, visible, activeRoomKey} via
// serviceWorker.postMessage, and we correlate by qid below.
let querySeq = 0;
const pendingRoomQueries = new Map(); // qid -> { roomKey, remaining, finish }

self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'INCO_GET_VERSION') {
    try {
      if (event.source) event.source.postMessage({ type: 'INCO_SW_VERSION', version: SW_VERSION });
    } catch { /* best-effort */ }
    return;
  }
  if (d.type !== 'INCO_ANSWER_ACTIVE_ROOM') return;
  const q = pendingRoomQueries.get(d.qid);
  if (!q) return;
  if (d.visible === true && (d.activeRoomKey === q.roomKey || d.onDashboard === true)) {
    q.finish(true);
    return;
  }
  q.remaining -= 1;
  if (q.remaining <= 0) q.finish(false);
});

// Consecutive-suppression counter, persisted next to the beacon so it survives
// SW restarts between pushes. Best-effort: any error reads as 0 / ignores.
async function readSuppressCount() {
  try {
    const cache = await caches.open(STATE_CACHE);
    const res = await cache.match(BASE + SUPPRESS_COUNT_KEY);
    if (!res) return 0;
    const v = await res.json();
    return typeof v === 'number' && v >= 0 ? v : 0;
  } catch {
    return 0;
  }
}
async function writeSuppressCount(n) {
  try {
    const cache = await caches.open(STATE_CACHE);
    await cache.put(BASE + SUPPRESS_COUNT_KEY, new Response(JSON.stringify(n)));
  } catch {
    // Best-effort only.
  }
}

const IS_IOS = /iPhone|iPad|iPod/i.test((self.navigator && self.navigator.userAgent) || '');

// Decide whether to keep this push silent. Beacon first (no round-trip), then
// the live tab query. Both are affirmative-only: any error, staleness or
// silence falls through to showing the notification.
async function shouldSuppressPush(roomKey) {
  if (!roomKey) return false;
  try {
    const cache = await caches.open(STATE_CACHE);
    const res = await cache.match(BASE + '__inco_state');
    if (res) {
      const s = await res.json();
      if (
        s &&
        s.visible === true &&
        typeof s.ts === 'number' &&
        Date.now() - s.ts < BEACON_FRESH_MS &&
        (s.activeRoomKey === roomKey || s.onDashboard === true)
      ) {
        // Guard the beacon's staleness window: if the PWA was KILLED without a
        // visibilitychange (crash/OOM/swipe), the beacon can read fresh+visible
        // for up to 25s with nobody actually there — suppressing then makes
        // Chrome show its generic "site updated in the background" junk banner.
        // Require a really-visible window client — except on iOS, where client
        // visibility misreports for live PWAs (the original zombie-client bug)
        // and Cache Storage beacon freshness is the trustworthy signal.
        if (IS_IOS) return true;
        try {
          const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
          if (wins.some((c) => c.visibilityState === 'visible')) return true;
          // Beacon claims visible but no visible client exists — stale kill
          // window. Fall through to the live query (which will show).
        } catch {
          return true; // matchAll failed — trust the fresh beacon.
        }
      }
    }
  } catch {
    // Beacon unreadable — fall through to the live query.
  }
  return anyLiveClientViewingRoom(roomKey);
}

// Resolves true on the first live "I'm visible and on this room" answer; false
// once all clients answered otherwise or after a short timeout — no answer
// means no suppression, we err toward notifying.
function anyLiveClientViewingRoom(roomKey) {
  if (!roomKey) return Promise.resolve(false);
  return clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((wins) => {
      if (wins.length === 0) return false;
      return new Promise((resolve) => {
        const qid = `q${++querySeq}`;
        let done = false;
        const finish = (val) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          pendingRoomQueries.delete(qid);
          resolve(val);
        };
        const timer = setTimeout(() => finish(false), 700);
        pendingRoomQueries.set(qid, { roomKey, remaining: wins.length, finish });

        wins.forEach((client) => {
          try {
            client.postMessage({ type: 'INCO_QUERY_ACTIVE_ROOM', qid });
          } catch {
            const q = pendingRoomQueries.get(qid);
            if (q) {
              q.remaining -= 1;
              if (q.remaining <= 0) q.finish(false);
            }
          }
        });
      });
    })
    .catch(() => false);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // The push payload's `url` is attacker-controllable (any room member can call
  // send-push with an arbitrary url). Only ever navigate within our own origin —
  // otherwise a notification could redirect the victim to a phishing page on tap.
  let targetUrl;
  try {
    const u = new URL(event.notification.data?.url || BASE, self.location.origin);
    targetUrl = u.origin === self.location.origin ? u.href : self.location.origin + BASE;
  } catch {
    targetUrl = self.location.origin + BASE;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          // Bring the existing window to the specific room when we can.
          if ('navigate' in client && client.url !== targetUrl) {
            return client
              .navigate(targetUrl)
              .then((c) => (c || client).focus())
              .catch(() => client.focus());
          }
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
