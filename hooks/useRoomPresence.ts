
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { Presence, ChatConfig, User } from '../types';
import { RealtimeChannel } from '@supabase/supabase-js';

// How long a peer may keep showing as "typing" without a FRESH payload from
// them. The typing tab heartbeats every ~TYPING_HEARTBEAT_MS while keys are
// pressed, so a live typer refreshes well inside the TTL; a client that died
// mid-typing (killed PWA, network drop — its last payload says isTyping:true
// forever) expires here instead of sticking until the presence server times
// it out (30-60s+).
export const TYPING_TTL_MS = 6000;
const TYPING_HEARTBEAT_MS = 2000;

// Per-typer freshness record. Skew-immune by design: we never compare the
// sender's clock (onlineAt) against ours — we only watch whether the VALUE
// keeps changing, timed with the receiver's own clock.
export type TyperRecord = { username: string; onlineAt: string; firstSeenLocal: number };

// Update the freshness records from the latest presence sync. `candidates` are
// the peers whose payload claims isTyping && active right now; anyone absent
// from it stopped typing (or left) and is dropped immediately.
export function updateTypingRecords(
  prev: Map<string, TyperRecord>,
  candidates: Array<{ uid: string; username: string; onlineAt: string }>,
  now: number
): Map<string, TyperRecord> {
  const next = new Map<string, TyperRecord>();
  for (const c of candidates) {
    const rec = prev.get(c.uid);
    next.set(c.uid, rec && rec.onlineAt === c.onlineAt
      ? rec // payload unchanged — keep the original local timestamp ticking
      : { username: c.username, onlineAt: c.onlineAt, firstSeenLocal: now });
  }
  return next;
}

// The usernames whose typing claim is still fresh.
export function currentTypers(records: Map<string, TyperRecord>, now: number): string[] {
  return [...records.values()]
    .filter((r) => now - r.firstSeenLocal < TYPING_TTL_MS)
    .map((r) => r.username);
}

export const useRoomPresence = (
  roomKey: string,
  user: User | null,
  config: ChatConfig
) => {
  const [participants, setParticipants] = useState<Presence[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const lastTypingTrackRef = useRef(0);
  const typingRecordsRef = useRef<Map<string, TyperRecord>>(new Map());
  // Latest message timestamp this user has seen — broadcast via presence so
  // others can show a "seen" receipt. track() replaces the whole payload, so we
  // keep it in a ref and include it on every track call.
  const lastReadRef = useRef<string>('');
  // Mirror config into a ref. The visibilitychange handler and the subscribe-
  // time track() are bound ONCE inside the [user, roomKey] effect, so they'd
  // otherwise capture the config from the effect-run render — a mid-session
  // username/avatar change would keep broadcasting the OLD identity on every
  // visibility flip / reconnect until the room is re-entered.
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (!user || !roomKey) return;

    const channel = supabase.channel(`presence:${roomKey}`, {
      config: {
        presence: {
          key: user.uid,
        },
      },
    });

    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const newState = channel.presenceState();
        const members: Presence[] = [];
        const candidates: Array<{ uid: string; username: string; onlineAt: string }> = [];

        for (const key in newState) {
          const userPresences = newState[key] as unknown as Presence[];
          if (!userPresences || userPresences.length === 0) continue;
          // A user may be connected from several tabs: treat them as active if
          // ANY tab is active (and use that tab's payload) so a backgrounded
          // second tab can't mislabel them as idle.
          // Pick this user's FRESHEST presence (latest track wins). Prefer an
          // active tab so a backgrounded second tab can't mislabel them as idle,
          // but among the candidates take the most recent onlineAt: a stale entry
          // left behind by a reconnect must not pin someone as "typing" forever or
          // report an outdated status. Keep idle members visible (idle dot).
          const actives = userPresences.filter((u) => u.status === 'active');
          const pool = actives.length ? actives : userPresences;
          const p = pool.reduce((a, b) => ((b.onlineAt || '') > (a.onlineAt || '') ? b : a), pool[0]);
          members.push(p);
          if (p.uid !== user.uid && p.isTyping && p.status === 'active') {
            candidates.push({ uid: p.uid, username: p.username, onlineAt: p.onlineAt || '' });
          }
        }
        // Active members first, then idle — stable otherwise.
        members.sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1));
        setParticipants(members);
        // Typing goes through freshness records (see TYPING_TTL_MS): the claim
        // must be RECENT, not merely present — presenceState is a snapshot, so
        // a dead client's last isTyping:true payload would otherwise sit in
        // every future sync and stick "X is typing…" until the server-side
        // presence timeout (30-60s+).
        typingRecordsRef.current = updateTypingRecords(typingRecordsRef.current, candidates, Date.now());
        const _tu = currentTypers(typingRecordsRef.current, Date.now());
        // [TYPING-DEBUG] temporary — remove after diagnosis. Shows, on every
        // presence sync, the freshest payload per peer (t=isTyping, s=status),
        // who became a typing candidate, and the resulting typingUsers.
        try {
          console.log('[typing] sync', {
            self: (user.uid || '').slice(0, 6),
            peers: Object.entries(newState).map(([k, arr]) => {
              const list = arr as unknown as Presence[];
              const a = list && list.length
                ? (list.filter((u) => u.status === 'active')[0] || list[0])
                : null;
              return a ? `${a.username}:t=${a.isTyping}:s=${a.status}` : k.slice(0, 6);
            }),
            candidates: candidates.map((c) => c.username),
            typingUsers: _tu,
          });
        } catch { /* ignore */ }
        setTypingUsers(_tu);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await trackPresence({ status: 'active', isTyping: false });
        }
      });

    // Expire stale typers even when NO presence event arrives (a dead client
    // generates none — that's exactly the stuck case).
    const typingPrune = setInterval(() => {
      setTypingUsers((prev) => {
        const next = currentTypers(typingRecordsRef.current, Date.now());
        return next.length === prev.length && next.every((u, i) => u === prev[i]) ? prev : next;
      });
    }, 2000);

    // Handle visibility changes for presence
    const handleVisibilityChange = async () => {
        if (document.hidden) {
            // ALSO kill the local typing state, not just the broadcast:
            // background-tab timers are throttled, so the pending 2s stop-timer
            // may fire minutes late — and the next trackPresence (e.g. the
            // "active again" below) re-broadcasts isTyping from the ref, which
            // used to resurrect a stale "typing…" for everyone else.
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            isTypingRef.current = false;
            await trackPresence({ status: 'inactive', isTyping: false });
        } else {
            await trackPresence({ status: 'active' });
        }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(typingPrune);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      // removeChannel (not bare unsubscribe) frees the topic immediately, matching
      // every other channel consumer; a bare unsubscribe leaves the channel in
      // RealtimeClient.channels until the close ack, so a fast remount (React
      // StrictMode, quick exit→rejoin) would get the still-leaving channel and
      // its presence/typing bindings would silently no-op.
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [user, roomKey]);

  const trackPresence = async (overrides: Partial<Presence>) => {
    if (!channelRef.current || !user) return;
    await channelRef.current.track({
      uid: user.uid,
      username: configRef.current.username,
      avatar: configRef.current.avatarURL,
      // Preserve the live typing state by default. track() replaces the whole
      // payload, so a non-typing-related re-broadcast (e.g. setLastRead's
      // read-receipt update) must NOT silently flip isTyping back to false —
      // that's what was killing the "is typing…" indicator. Callers that mean to
      // change it (setTyping) pass an explicit override.
      isTyping: isTypingRef.current,
      onlineAt: new Date().toISOString(),
      status: 'active',
      lastReadAt: lastReadRef.current,
      ...overrides,
    });
  };

  // Mark messages up to `ts` as seen and re-broadcast (only when it advances).
  const setLastRead = (ts?: string) => {
    if (!ts || ts <= lastReadRef.current) return;
    lastReadRef.current = ts;
    trackPresence({});
  };

  const setTyping = (isTyping: boolean) => {
      if (!user) return;

      if (isTyping) {
        const now = Date.now();
        if (!isTypingRef.current) {
            isTypingRef.current = true;
            lastTypingTrackRef.current = now;
            console.log('[typing] send start'); // [TYPING-DEBUG] temporary
            trackPresence({ isTyping: true });
        } else if (now - lastTypingTrackRef.current > TYPING_HEARTBEAT_MS) {
            // Heartbeat while keys keep coming: refreshes onlineAt so receivers'
            // typing TTL (see TYPING_TTL_MS) treats us as live. Without it the
            // payload freezes at typing-start and a long message would expire
            // mid-typing — and a lost stop-message would stick forever.
            lastTypingTrackRef.current = now;
            console.log('[typing] send heartbeat'); // [TYPING-DEBUG] temporary
            trackPresence({ isTyping: true });
        }

        // Reset timeout to stop typing
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            isTypingRef.current = false;
            console.log('[typing] send stop (timeout)'); // [TYPING-DEBUG] temporary
            trackPresence({ isTyping: false });
        }, 2000);

      } else {
          // Force stop
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          isTypingRef.current = false;
          console.log('[typing] send stop (explicit)'); // [TYPING-DEBUG] temporary
          trackPresence({ isTyping: false });
      }
  };

  return {
    participants,
    typingUsers,
    setTyping,
    setLastRead,
    updatePresence: trackPresence
  };
};
