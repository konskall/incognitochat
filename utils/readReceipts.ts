import { Message, Presence } from '../types';

const INCO_BOT_UUID = '00000000-0000-0000-0000-000000000000';

// One member's broadcast read state: `pos` = the timestamp of the highest message
// they've read (skew-free, used to decide "has read up to here"); `at` = the
// wall-clock time of that latest read advance (the approximate "seen at").
export interface ReadReceipt { pos: string; at: string; }

export interface SeenEntry { uid: string; username: string; avatar: string; at: string; }

// Who (of the currently-CONNECTED participants — active or idle/backgrounded) has
// read up to `msg`: their read position is at/after the message's timestamp.
// Excludes the viewer, the message's own author, and the bot. Sorted newest-seen
// first. NOTE: only reflects members present in this session (receipts are
// broadcast, not persisted) — a member who read earlier then DISCONNECTED won't
// appear (they drop out of the participants roster).
export function computeSeenBy(
  msg: Message,
  receipts: Map<string, ReadReceipt>,
  participants: Presence[],
  selfUid: string | undefined,
): SeenEntry[] {
  if (!msg || !msg.createdAt) return [];
  const msgTime = new Date(msg.createdAt).getTime();
  if (Number.isNaN(msgTime)) return [];

  const out: SeenEntry[] = [];
  const added = new Set<string>();
  for (const p of participants) {
    if (!p || !p.uid || added.has(p.uid)) continue;
    if (p.uid === selfUid || p.uid === msg.uid || p.uid === INCO_BOT_UUID) continue;
    const r = receipts.get(p.uid);
    if (!r || !r.pos) continue;
    if (new Date(r.pos).getTime() >= msgTime) {
      added.add(p.uid);
      out.push({ uid: p.uid, username: p.username, avatar: p.avatar, at: r.at });
    }
  }
  // Newest read first (empty `at` sorts last).
  return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}
