// Bridge between the page and the Web Push service worker (public/sw.js).
//
// Two messages:
// 1. INCO_QUERY_ACTIVE_ROOM — the SW asks (via MessageChannel, BEFORE showing a
//    push notification) whether this tab is visible AND viewing the push's
//    room. We answer with { visible, activeRoomKey }; an affirmative answer is
//    the ONLY thing that suppresses the notification. A closed/suspended tab
//    can't answer, so the SW's timeout falls through to showing — reliability
//    is never hostage to a stale visibility reading. Asking first (instead of
//    show-then-close) is what keeps the iOS banner from flashing while you're
//    reading that exact room.
// 2. INCO_PUSH_SHOWN — after the SW shows a notification, it tells open tabs.
//    If THIS tab is visible and on that room (e.g. it became visible while the
//    push was in flight), we close the now-stale notification.

let activeRoomKey: string | null = null;

// Called by ChatScreen on mount / room change, reset to null on unmount (back to
// the dashboard) so dashboard-open users always get notified for any room.
export function setActiveRoom(key: string | null): void {
  activeRoomKey = key;
}

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data as { type?: string; roomKey?: string | null; tag?: string } | null;
    if (!data) return;

    if (data.type === 'INCO_QUERY_ACTIVE_ROOM') {
      const port = event.ports && event.ports[0];
      if (!port) return;
      port.postMessage({
        visible: document.visibilityState === 'visible',
        activeRoomKey,
      });
      return;
    }

    if (data.type !== 'INCO_PUSH_SHOWN') return;

    // Only auto-dismiss when we're certain: this tab is on screen AND showing
    // the exact room the push was for. Anything else (hidden tab, different room)
    // leaves the notification alone.
    if (document.visibilityState !== 'visible') return;
    if (!data.roomKey || data.roomKey !== activeRoomKey) return;

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
}
