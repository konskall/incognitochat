
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { ChatConfig, User } from '../types';

export const useRoomManagement = (config: ChatConfig, user: User | null, onExit: () => void) => {
  const [isRoomReady, setIsRoomReady] = useState(false);
  const [roomDeleted, setRoomDeleted] = useState(false);
  const [roomCreatorId, setRoomCreatorId] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiAvatarUrl, setAiAvatarUrl] = useState('');

  const checkRoomStatus = useCallback(async () => {
    const { data } = await supabase.from('rooms').select('room_key').eq('room_key', config.roomKey).maybeSingle();
    if (!data) setRoomDeleted(true);
  }, [config.roomKey]);

  const initRoom = useCallback(async () => {
    if (!user) return;
    const { data: room } = await supabase.from('rooms').select('*').eq('room_key', config.roomKey).maybeSingle();

    if (room) {
      setRoomCreatorId(room.created_by);
      setAiEnabled(!!room.ai_enabled);
      setAiAvatarUrl(room.ai_avatar_url || '');
      setIsRoomReady(true);
      setRoomDeleted(false);
    } else {
      const { error } = await supabase.from('rooms').insert({
        room_key: config.roomKey,
        room_name: config.roomName,
        pin: config.pin,
        created_by: user.uid
      });
      if (!error) setRoomCreatorId(user.uid);
      setIsRoomReady(true);
    }
  }, [user, config]);

  const deleteRoom = async () => {
    await supabase.from('rooms').delete().eq('room_key', config.roomKey);
    onExit();
  };

  useEffect(() => {
    initRoom();
    window.addEventListener('focus', checkRoomStatus);
    return () => window.removeEventListener('focus', checkRoomStatus);
  }, [initRoom, checkRoomStatus]);

  return { isRoomReady, roomDeleted, roomCreatorId, aiEnabled, setAiEnabled, aiAvatarUrl, setAiAvatarUrl, deleteRoom, handleRecreate: initRoom };
};
