
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
        const activeUsers: Presence[] = [];
        const typers: string[] = [];

        for (const key in newState) {
          const userPresences = newState[key] as unknown as Presence[];
          if (userPresences && userPresences.length > 0) {
            const p = userPresences[0];
            if (p.status !== 'inactive') {
              activeUsers.push(p);
            }
            if (p.uid !== user.uid && p.isTyping && p.status !== 'inactive') {
              typers.push(p.username);
            }
          }
        }
        setParticipants(activeUsers);
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
      ...overrides,
    });
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
    updatePresence: trackPresence
  };
};
