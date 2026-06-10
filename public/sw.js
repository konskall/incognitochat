// Incognito Chat service worker — offline app shell + Web Push.

const CACHE = 'incognito-cache-v1';
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
      // Drop caches from older versions.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
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

  // Suppress ONLY on a live, affirmative answer; otherwise ALWAYS show.
  // We ask every open tab (MessageChannel) whether it is visible AND currently
  // viewing this push's room. Only a running page can answer — a closed PWA,
  // suspended tab or zombie client entry simply doesn't reply and the short
  // timeout falls through to showNotification, so a notification can never be
  // lost to a stale visibility reading. Asking BEFORE showing matters on iOS:
  // show-then-close still flashed the OS banner while the user was reading that
  // exact room. After showing we still broadcast INCO_PUSH_SHOWN so a tab that
  // became visible mid-flight can dismiss the stale banner (belt & suspenders).
  event.waitUntil(
    (async () => {
      const viewing = await anyLiveClientViewingRoom(data.roomKey);
      if (viewing) return;

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

// Ask every window client whether it is visible AND viewing `roomKey` right
// now (utils/swBridge.ts answers INCO_QUERY_ACTIVE_ROOM). Resolves true on the
// first affirmative answer; false once all clients answered otherwise or after
// a short timeout — no answer means no suppression, we err toward notifying.
function anyLiveClientViewingRoom(roomKey) {
  if (!roomKey) return Promise.resolve(false);
  return clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((wins) => {
      if (wins.length === 0) return false;
      return new Promise((resolve) => {
        let remaining = wins.length;
        let done = false;
        const finish = (val) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(val);
        };
        const timer = setTimeout(() => finish(false), 600);

        wins.forEach((client) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (e) => {
            const d = e.data || {};
            if (d.visible === true && d.activeRoomKey === roomKey) {
              finish(true);
              return;
            }
            remaining -= 1;
            if (remaining <= 0) finish(false);
          };
          try {
            client.postMessage({ type: 'INCO_QUERY_ACTIVE_ROOM' }, [channel.port2]);
          } catch {
            remaining -= 1;
            if (remaining <= 0) finish(false);
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
