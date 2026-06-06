
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
          const p = userPresences.find((u) => u.status === 'active') || userPresences[0];
          // Keep everyone who is in the room — including backgrounded ("inactive"/idle)
          // members — so they stay visible (rendered with an idle dot) instead of
          // vanishing the moment they switch tabs. The status field carries the nuance.
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
      isTyping: false,
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
