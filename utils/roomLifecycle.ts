import { supabase } from '../services/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// How long to wait for the transient room_status channel to subscribe before
// sending anyway — bounded so a down realtime never hangs the delete flow.
const SUBSCRIBE_TIMEOUT_MS = 1500;

export interface RoomDeletedPayload { deletedBy?: string; }

// Defensive parse of an untrusted `room_deleted` broadcast payload (it originates
// from another client). Only a string `deletedBy` is accepted; anything else → {}.
export function parseRoomDeletedPayload(payload: unknown): RoomDeletedPayload {
  if (
    payload && typeof payload === 'object' &&
    typeof (payload as { deletedBy?: unknown }).deletedBy === 'string'
  ) {
    return { deletedBy: (payload as { deletedBy: string }).deletedBy };
  }
  return {};
}

// Best-effort: broadcast that a room was deleted on its room_status lifecycle
// channel (the same channel + event ChatScreen emits on an in-room delete), so
// other members' dashboards and any in-room clients react live. If `existing`
// (a channel already subscribed to room_status:<roomKey>) is supplied, send on
// it directly; otherwise open a short-lived channel. NEVER throws into the
// delete flow — a missed broadcast just falls back to a dashboard refresh.
export async function broadcastRoomDeleted(
  roomKey: string,
  deletedBy: string,
  existing?: RealtimeChannel | null,
): Promise<void> {
  const message = { type: 'broadcast' as const, event: 'room_deleted', payload: { deletedBy } };
  try {
    if (existing) {
      await existing.send(message);
      return;
    }
    const ch = supabase.channel(`room_status:${roomKey}`);
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      ch.subscribe((status) => { if (status === 'SUBSCRIBED') finish(); });
      // Don't hang the delete flow if realtime is unavailable.
      setTimeout(finish, SUBSCRIBE_TIMEOUT_MS);
    });
    try {
      await ch.send(message);
    } finally {
      supabase.removeChannel(ch);
    }
  } catch {
    /* best-effort */
  }
}
