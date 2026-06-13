
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { Presence, ChatConfig, User } from '../types';
import { RealtimeChannel } from '@supabase/supabase-js';

// Typing is delivered over Realtime BROADCAST, NOT presence meta. Presence
// reliably propagates membership (join/leave) and the INITIAL meta, but a
// same-key meta UPDATE (the typing heartbeat / the stop re-track) is NOT
// re-delivered to other clients — the observed payload froze at the first value
// (onlineAt stuck), so the old onlineAt-change freshness scheme EXPIRED live
// typers and the indicator never showed reliably. Broadcast delivers every
// message: the sender heartbeats `typing:true` while keys come, the receiver
// keeps a per-uid expiry the heartbeat refreshes, and a stop event (or a dead
// client that simply stops heartbeating) clears it.
export const TYPING_TTL_MS = 5000;     // receiver: drop a typer this long after its last 'typing' broadcast
const TYPING_HEARTBEAT_MS = 2000;      // sender: re-broadcast cadence while typing

export type TypingRecord = { username: string; expiresAt: number };
export type TypingEvent = { uid: string; username: string; typing: boolean };

// Apply one typing broadcast to the receiver's per-uid records (immutable).
export function applyTypingEvent(
  records: Map<string, TypingRecord>,
  ev: TypingEvent,
  now: number,
  ttl: number = TYPING_TTL_MS,
): Map<string, TypingRecord> {
  const next = new Map(records);
  if (ev.typing) next.set(ev.uid, { username: ev.username, expiresAt: now + ttl });
  else next.delete(ev.uid);
  return next;
}

// Usernames whose typing claim hasn't expired yet.
export function liveTypers(records: Map<string, TypingRecord>, now: number): string[] {
  return [...records.values()].filter((r) => r.expiresAt > now).map((r) => r.username);
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
  // Per-uid typing expiry, fed by 'typing' broadcasts (see top comment).
  const typingExpiryRef = useRef<Map<string, TypingRecord>>(new Map());
  // Latest message timestamp this user has seen — broadcast via presence so
  // others can show a "seen" receipt. track() replaces the whole payload, so we
  // keep it in a ref and include it on every track call.
  const lastReadRef = useRef<string>('');
  // Mirror config into a ref. The visibilitychange handler and the subscribe-
  // time track()/sendTyping are bound ONCE inside the [user, roomKey] effect, so
  // they'd otherwise capture the config from the effect-run render — a mid-session
  // username/avatar change would keep broadcasting the OLD identity until re-entry.
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

        for (const key in newState) {
          const userPresences = newState[key] as unknown as Presence[];
          if (!userPresences || userPresences.length === 0) continue;
          // Pick this user's FRESHEST presence (latest track wins). Prefer an
          // active tab so a backgrounded second tab can't mislabel them as idle,
          // but among the candidates take the most recent onlineAt: a stale entry
          // left behind by a reconnect must not report an outdated status. Keep
          // idle members visible (idle dot).
          const actives = userPresences.filter((u) => u.status === 'active');
          const pool = actives.length ? actives : userPresences;
          const p = pool.reduce((a, b) => ((b.onlineAt || '') > (a.onlineAt || '') ? b : a), pool[0]);
          members.push(p);
        }
        // Active members first, then idle — stable otherwise.
        members.sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1));
        setParticipants(members);
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const ev = payload as Partial<TypingEvent> | null;
        console.log('[typing] recv', ev?.username, ev?.typing); // [TYPING-DEBUG] temporary
        // Ignore malformed payloads and our own echo (self filtered by uid).
        if (!ev || typeof ev.uid !== 'string' || ev.uid === user.uid) return;
        typingExpiryRef.current = applyTypingEvent(
          typingExpiryRef.current,
          { uid: ev.uid, username: typeof ev.username === 'string' ? ev.username : '', typing: !!ev.typing },
          Date.now(),
        );
        setTypingUsers(liveTypers(typingExpiryRef.current, Date.now()));
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await trackPresence({ status: 'active' });
        }
      });

    // Expire typers whose heartbeat stopped (dead client / a stop broadcast that
    // never arrived), even when no further broadcast comes in.
    const typingPrune = setInterval(() => {
      const now = Date.now();
      for (const [uid, rec] of typingExpiryRef.current) {
        if (rec.expiresAt <= now) typingExpiryRef.current.delete(uid);
      }
      const next = liveTypers(typingExpiryRef.current, now);
      setTypingUsers((prev) =>
        next.length === prev.length && next.every((u, i) => u === prev[i]) ? prev : next
      );
    }, 1500);

    // Handle visibility changes for presence
    const handleVisibilityChange = async () => {
        if (document.hidden) {
            // Stop typing locally + tell the room (background-tab timers are
            // throttled, so the pending 2s stop-timer may fire minutes late).
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            isTypingRef.current = false;
            sendTyping(false);
            await trackPresence({ status: 'inactive' });
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

  // Broadcast a typing state to the room over the channel's broadcast bus (NOT
  // presence meta — see the top-of-file comment for why).
  const sendTyping = (typing: boolean) => {
    if (!channelRef.current || !user) return;
    console.log('[typing] send', typing); // [TYPING-DEBUG] temporary
    channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { uid: user.uid, username: configRef.current.username, typing },
    });
  };

  const setTyping = (isTyping: boolean) => {
      if (!user) return;

      if (isTyping) {
        const now = Date.now();
        if (!isTypingRef.current) {
            isTypingRef.current = true;
            lastTypingTrackRef.current = now;
            sendTyping(true);
        } else if (now - lastTypingTrackRef.current > TYPING_HEARTBEAT_MS) {
            // Heartbeat while keys keep coming: refreshes the receiver's expiry
            // (see TYPING_TTL_MS) so a long message doesn't expire mid-typing.
            lastTypingTrackRef.current = now;
            sendTyping(true);
        }

        // Reset timeout to stop typing
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            isTypingRef.current = false;
            sendTyping(false);
        }, 2000);

      } else {
          // Force stop
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          isTypingRef.current = false;
          sendTyping(false);
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
