// Bridge between the page and the Web Push service worker (public/sw.js).
//
// The SW always shows a push notification (reliability first), then tells open
// tabs it did (INCO_PUSH_SHOWN). If THIS tab is visible AND already viewing the
// room the push is for, we close the notification — so a message in the room
// you're actively reading doesn't linger, while a message in a DIFFERENT room
// (or while the app is backgrounded/closed, where no tab answers) stays.

let activeRoomKey: string | null = null;

// Called by ChatScreen on mount / room change, reset to null on unmount (back to
// the dashboard) so dashboard-open users never auto-close anything.
export function setActiveRoom(key: string | null): void {
  activeRoomKey = key;
}

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data as { type?: string; roomKey?: string | null; tag?: string } | null;
    if (!data || data.type !== 'INCO_PUSH_SHOWN') return;

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
