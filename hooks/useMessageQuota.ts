import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { Tier, messagesRemaining } from '../utils/entitlements';

// Remaining sends today in this room for the current user. null = unlimited
// (Ultra) or not-yet-known. `bump` changes after each send to trigger a refetch.
// The DB is authoritative; this is display-only.
export function useMessageQuota(roomKey: string | undefined, tier: Tier, bump: number): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    if (!roomKey) { setRemaining(null); return; }
    if (messagesRemaining(tier, 0) === null) { setRemaining(null); return; } // unlimited -> no counter
    (async () => {
      try {
        const { data, error } = await supabase.rpc('messages_sent_today', { p_room_key: roomKey });
        if (error) throw error;
        if (alive) setRemaining(messagesRemaining(tier, (data as number) ?? 0));
      } catch (e) {
        console.error('useMessageQuota failed', e);
        if (alive) setRemaining(null);
      }
    })();
    return () => { alive = false; };
  }, [roomKey, tier, bump]);
  return remaining;
}
