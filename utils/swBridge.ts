// Bridge between the page and the Web Push service worker (public/sw.js).
//
// Suppression state travels over TWO independent channels (the SW suppresses a
// push only on an affirmative, fresh signal from either — anything stale or
// absent falls through to showing, so a notification can never be lost):
//
// 1. Cache Storage BEACON (primary). The page writes
//    {visible, activeRoomKey, onDashboard, ts} to a well-known cache entry on
//    every state change + a 15s heartbeat while visible. The SW reads it
//    synchronously in the push handler — no message round-trip, which makes it
//    immune to the iOS/WebKit message-delivery quirks below. The short TTL
//    (sw.js accepts it for ~25s) means a killed/backgrounded PWA stops
//    heartbeating and pushes show again within seconds.
//
// 2. INCO_QUERY_ACTIVE_ROOM {qid} postMessage round-trip (fallback). The SW
//    asks every open tab; we answer INCO_ANSWER_ACTIVE_ROOM
//    {qid, visible, activeRoomKey, onDashboard} with a PLAIN postMessage —
//    deliberately no MessageChannel: transferring a MessagePort from a SW to a
//    window silently fails on some iOS/WebKit versions.
//    CRITICAL: navigator.serviceWorker.startMessages() MUST be called — per
//    spec, messages from the SW are BUFFERED until .onmessage is assigned or
//    startMessages() runs. Desktop Chrome is lenient with addEventListener
//    alone, WebKit is not — without this call the iPhone never saw the query,
//    the SW timed out and the banner showed while the user was reading that
//    exact room.
//
// 3. INCO_PUSH_SHOWN — after the SW shows a notification, it tells open tabs.
//    If THIS tab is visible and on that room (or on the dashboard, which shows
//    live unread badges), we close the now-stale notification.

const STATE_CACHE = 'inco-state-v1';
const STATE_PATH = `${import.meta.env.BASE_URL}__inco_state`;

let activeRoomKey: string | null = null;
let onDashboard = false;

// Persist the current "what is the user looking at" state where the SW can
// read it without the page being awake. Best-effort: no Cache Storage (old
// browsers / some private modes) just means the SW falls back to the query.
function writeStateBeacon(): void {
  if (typeof caches === 'undefined' || typeof document === 'undefined') return;
  const state = {
    visible: document.visibilityState === 'visible',
    activeRoomKey,
    onDashboard,
    ts: Date.now(),
  };
  caches
    .open(STATE_CACHE)
    .then((c) =>
      c.put(
        STATE_PATH,
        new Response(JSON.stringify(state), { headers: { 'Content-Type': 'application/json' } })
      )
    )
    .catch(() => {});
}

// Called by ChatScreen on mount / room change, reset to null on unmount.
export function setActiveRoom(key: string | null): void {
  activeRoomKey = key;
  writeStateBeacon();
}

// Called by DashboardScreen on mount/unmount. While the dashboard is visible it
// already shows live unread badges + previews, so OS notifications are noise.
export function setDashboardActive(active: boolean): void {
  onDashboard = active;
  writeStateBeacon();
}

// The SW fires INCO_PUSHSUBSCRIPTION_CHANGED after the browser rotates the push
// endpoint (it re-subscribes with the VAPID key, but only the page has the auth
// + room context to persist the new endpoint to the DB). A mounted screen
// registers a re-subscribe callback here so the DB row is refreshed WITHOUT
// waiting for the next room re-open.
let pushSubscriptionChangedHandler: (() => void) | null = null;
export function onPushSubscriptionChanged(cb: (() => void) | null): void {
  pushSubscriptionChangedHandler = cb;
}

// Ask the service worker which version it runs (shown in the UI so a device
// can be checked for a stale SW without devtools — iOS especially). Falls back
// to the registration's active worker when there's no controller yet (first
// visit / hard reload). null = no SW answered: none registered, or a PRE-v8 SW
// that doesn't know INCO_GET_VERSION — i.e. exactly the stale case worth seeing.
export function getSwVersion(timeoutMs = 2000): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      resolve(null);
      return;
    }
    const onMsg = (event: MessageEvent) => {
      const d = event.data as { type?: string; version?: string } | null;
      if (d?.type === 'INCO_SW_VERSION') {
        cleanup();
        resolve(d.version || null);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('message', onMsg);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    navigator.serviceWorker.addEventListener('message', onMsg);
    const ask = (sw: ServiceWorker | null | undefined) => {
      if (sw) sw.postMessage({ type: 'INCO_GET_VERSION' });
    };
    if (navigator.serviceWorker.controller) {
      ask(navigator.serviceWorker.controller);
    } else {
      // .ready never rejects; if no SW ever registers the timeout resolves null.
      navigator.serviceWorker.ready.then((reg) => ask(reg.active)).catch(() => {});
    }
  });
}

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data as { type?: string; roomKey?: string | null; tag?: string } | null;
    if (!data) return;

    if (data.type === 'INCO_PUSHSUBSCRIPTION_CHANGED') {
      try { pushSubscriptionChangedHandler?.(); } catch { /* best-effort */ }
      return;
    }

    if (data.type === 'INCO_QUERY_ACTIVE_ROOM') {
      const answer = {
        type: 'INCO_ANSWER_ACTIVE_ROOM',
        qid: (data as { qid?: string }).qid,
        visible: document.visibilityState === 'visible',
        activeRoomKey,
        onDashboard,
      };
      // Reply to the asking SW; fall back to the controller (same SW in practice).
      const src = event.source as ServiceWorker | null;
      if (src && typeof src.postMessage === 'function') {
        src.postMessage(answer);
      } else if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage(answer);
      }
      return;
    }

    if (data.type !== 'INCO_PUSH_SHOWN') return;

    // Only auto-dismiss when we're certain: this tab is on screen AND showing
    // the exact room the push was for, or the dashboard (live badges). Anything
    // else (hidden tab, different room) leaves the notification alone.
    if (document.visibilityState !== 'visible') return;
    if (!data.roomKey) return;
    if (data.roomKey !== activeRoomKey && !onDashboard) return;

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg || !reg.getNotifications) return;
      reg.getNotifications(data.tag ? { tag: data.tag } : undefined).then((notes) => {
        notes.forEach((n) => {
          // Belt-and-suspenders: match on the room carried in the payload too,
          // in case several rooms share the (rare) untagged path.
          if (!data.tag && n.data && n.data.roomKey && n.data.roomKey !== data.roomKey) return;
          n.close();
        });
      });
    });
  });

  // See the header comment: without this, WebKit buffers all SW->page messages
  // forever when only addEventListener was used — the iOS suppression query
  // never arrived. Safe everywhere; idempotent.
  if (typeof navigator.serviceWorker.startMessages === 'function') {
    navigator.serviceWorker.startMessages();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', writeStateBeacon);
    // Heartbeat keeps the beacon fresh while the user is actually looking at
    // the app; a backgrounded/killed PWA stops writing and the beacon expires.
    setInterval(() => {
      if (document.visibilityState === 'visible') writeStateBeacon();
    }, 15000);
  }
}
