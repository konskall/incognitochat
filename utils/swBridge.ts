// Bridge between the page and the Web Push service worker (public/sw.js).
//
// Two messages:
// 1. INCO_QUERY_ACTIVE_ROOM {qid} — the SW asks (BEFORE showing a push
//    notification) whether this tab is visible AND viewing the push's room. We
//    answer INCO_ANSWER_ACTIVE_ROOM {qid, visible, activeRoomKey} with a PLAIN
//    postMessage back to the service worker — deliberately no MessageChannel:
//    transferring a MessagePort from a SW to a window silently fails on some
//    iOS/WebKit versions, which made the query time out and the banner show
//    anyway. An affirmative answer is the ONLY thing that suppresses the
//    notification; a closed/suspended tab can't answer, so the SW's timeout
//    falls through to showing.
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
      const answer = {
        type: 'INCO_ANSWER_ACTIVE_ROOM',
        qid: (data as { qid?: string }).qid,
        visible: document.visibilityState === 'visible',
        activeRoomKey,
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
