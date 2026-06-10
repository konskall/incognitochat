// Bridge between the page and the Web Push service worker (public/sw.js).
//
// When a push arrives while the app is open and visible, the SW asks each
// visible tab "which room are you looking at right now?" (INCO_QUERY_ACTIVE_ROOM).
// We answer here. The SW then stays silent ONLY if a visible tab is already on
// the same room as the push — so a message in the room you're staring at doesn't
// pop an OS notification, but a message in a DIFFERENT room still notifies you
// even with the app open.

let activeRoomKey: string | null = null;

// Called by ChatScreen on mount / room change, and reset to null on unmount
// (i.e. when you leave the room for the dashboard). On the dashboard activeRoomKey
// is null, so it never matches a push's roomKey → you get notified for any room.
export function setActiveRoom(key: string | null): void {
  activeRoomKey = key;
}

// Register the responder exactly once, on module import.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data as { type?: string } | null;
    if (!data || data.type !== 'INCO_QUERY_ACTIVE_ROOM') return;
    const port = event.ports && event.ports[0];
    if (!port) return;
    port.postMessage({
      visible: document.visibilityState === 'visible',
      activeRoomKey,
    });
  });
}
