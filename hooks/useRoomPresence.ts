
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { Presence, ChatConfig, User } from '../types';
import { RealtimeChannel } from '@supabase/supabase-js';

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
  // Latest message timestamp this user has seen — broadcast via presence so
  // others can show a "seen" receipt. track() replaces the whole payload, so we
  // keep it in a ref and include it on every track call.
  const lastReadRef = useRef<string>('');

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
        const typers: string[] = [];

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
            typers.push(p.username);
          }
        }
        // Active members first, then idle — stable otherwise.
        members.sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1));
        setParticipants(members);
        setTypingUsers(typers);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await trackPresence({ status: 'active', isTyping: false });
        }
      });

    // Handle visibility changes for presence
    const handleVisibilityChange = async () => {
        if (document.hidden) {
            await trackPresence({ status: 'inactive', isTyping: false });
        } else {
            await trackPresence({ status: 'active' });
        }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (channelRef.current) {
         channel.unsubscribe();
      }
    };
  }, [user, roomKey]);

  const trackPresence = async (overrides: Partial<Presence>) => {
    if (!channelRef.current || !user) return;
    await channelRef.current.track({
      uid: user.uid,
      username: config.username,
      avatar: config.avatarURL,
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
        if (!isTypingRef.current) {
            isTypingRef.current = true;
            trackPresence({ isTyping: true });
        }
        
        // Reset timeout to stop typing
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            isTypingRef.current = false;
            trackPresence({ isTyping: false });
        }, 2000);

      } else {
          // Force stop
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          isTypingRef.current = false;
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
