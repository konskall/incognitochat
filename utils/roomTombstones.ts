// Local "tombstones" for free rooms (rooms.expires_at). The free 24h purge cron
// hard-deletes the room and cascades the member's subscribers row, leaving NO
// server trace. To still show "this room auto-deleted — recreate?" on the
// dashboard after the user was away, we cache the minimum needed to render +
// recreate, per user, in localStorage. Display-only; the server stays source of
// truth. Cleared on dismiss / delete / logout.

export interface RoomTombstone {
  room_key: string;
  room_name: string;
  pin: string;
  created_by: string;
  expires_at: string; // ISO 24h deadline
  name: string;       // display label (display_name || room_name)
}

const keyFor = (uid: string) => `roomTombstones_${uid}`;

export function readTombstones(uid: string): Record<string, RoomTombstone> {
  try {
    const raw = localStorage.getItem(keyFor(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, RoomTombstone>) : {};
  } catch { return {}; }
}

export function upsertTombstone(uid: string, t: RoomTombstone): void {
  try {
    const all = readTombstones(uid);
    all[t.room_key] = t;
    localStorage.setItem(keyFor(uid), JSON.stringify(all));
  } catch { /* storage blocked/full — display-only, safe to skip */ }
}

export function removeTombstone(uid: string, roomKey: string): void {
  try {
    const all = readTombstones(uid);
    if (!(roomKey in all)) return;
    delete all[roomKey];
    localStorage.setItem(keyFor(uid), JSON.stringify(all));
  } catch { /* ignore */ }
}
