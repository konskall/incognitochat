
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/supabase';
import { Message, Attachment } from '../types';
import { decryptMessage, encryptMessage } from '../utils/helpers';

export const useChatMessages = (
  roomKey: string,
  pin: string,
  userUid: string | undefined, 
  onNewMessage?: (msg: Message) => void
) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const onNewMessageRef = useRef(onNewMessage);

  useEffect(() => {
    onNewMessageRef.current = onNewMessage;
  }, [onNewMessage]);

  // Load initial messages function (reusable for refreshes)
  const fetchMessages = useCallback(async () => {
    if (!roomKey) return;
    
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('room_key', roomKey)
      .order('created_at', { ascending: true });

    if (error) {
      console.error("Fetch error:", error);
      return;
    }

    if (data) {
      const msgs: Message[] = data.map((d) => ({
        id: d.id,
        text: decryptMessage(d.text || '', pin, roomKey),
        uid: d.uid,
        username: d.username,
        avatarURL: d.avatar_url,
        createdAt: d.created_at,
        attachment: d.attachment,
        location: d.location,
        isEdited: false, 
        reactions: d.reactions || {},
        replyTo: d.reply_to,
        type: d.type || 'text',
      }));
      
      setMessages(msgs);
    }
  }, [roomKey, pin]);

  // Initial load and visibility listener
  useEffect(() => {
    fetchMessages();

    // Fix for Mobile Backgrounding:
    // When user returns to tab, refresh messages to get anything missed during sleep
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log("App became visible, syncing messages...");
        fetchMessages();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [fetchMessages]);

  // Real-time Subscription
  useEffect(() => {
    if (!roomKey) return;

    const channel = supabase
      .channel(`messages:${roomKey}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `room_key=eq.${roomKey}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const d = payload.new;
            const newMsg: Message = {
              id: d.id,
              text: decryptMessage(d.text || '', pin, roomKey),
              uid: d.uid,
              username: d.username,
              avatarURL: d.avatar_url,
              createdAt: d.created_at,
              attachment: d.attachment,
              location: d.location,
              reactions: d.reactions || {},
              replyTo: d.reply_to,
              type: d.type || 'text',
            };
            
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
            
            if (onNewMessageRef.current) {
                onNewMessageRef.current(newMsg);
            }

          } else if (payload.eventType === 'UPDATE') {
            const d = payload.new;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === d.id
                  ? {
                      ...m,
                      text: decryptMessage(d.text || '', pin, roomKey),
                      reactions: d.reactions || {},
                      isEdited: true, 
                    }
                  : m
              )
            );
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old.id;
            if (deletedId) {
              setMessages((prev) => prev.filter((m) => m.id !== deletedId));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomKey, pin]);

  const sendMessage = useCallback(
    async (
      text: string,
      config: { username: string; avatarURL: string },
      attachment: Attachment | null = null,
      replyTo: Message | null = null,
      location: { lat: number; lng: number } | null = null,
      type: 'text' | 'system' = 'text'
    ) => {
      if (!userUid || !roomKey) return;
      
      if(attachment) setIsUploading(true);

      try {
        const encryptedText = encryptMessage(text, pin, roomKey);

        await supabase.from('messages').insert({
          room_key: roomKey,
          uid: userUid,
          username: config.username,
          avatar_url: config.avatarURL,
          text: encryptedText,
          type: type,
          attachment: attachment,
          reactions: {},
          location: location,
          reply_to: replyTo
            ? {
                id: replyTo.id,
                username: replyTo.username,
                text: replyTo.text || 'Attachment',
                isAttachment: !!replyTo.attachment,
              }
            : null,
        });
      } catch (e) {
        console.error('Send message failed', e);
        throw e;
      } finally {
        if(attachment) setIsUploading(false);
      }
    },
    [roomKey, pin, userUid]
  );

  const editMessage = useCallback(async (msgId: string, newText: string) => {
    try {
      const encryptedText = encryptMessage(newText, pin, roomKey);
      await supabase
        .from('messages')
        .update({
          text: encryptedText,
        })
        .eq('id', msgId);
    } catch (e) {
      console.error('Edit failed', e);
    }
  }, [pin, roomKey]);

  const deleteMessage = useCallback(async (msgId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    try {
      await supabase.from('messages').delete().eq('id', msgId);
    } catch (e) {
      console.error('Delete failed', e);
    }
  }, []);

  const reactToMessage = useCallback(
    async (msg: Message, emoji: string) => {
      if (!userUid) return;
      const currentReactions = msg.reactions || {};
      const userList = currentReactions[emoji] || [];
      let newList: string[];

      if (userList.includes(userUid)) {
        newList = userList.filter((u) => u !== userUid);
      } else {
        newList = [...userList, userUid];
      }

      const updatedReactions = { ...currentReactions, [emoji]: newList };
       setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id ? { ...m, reactions: updatedReactions } : m
        )
      );

      await supabase
        .from('messages')
        .update({ reactions: updatedReactions })
        .eq('id', msg.id);
    },
    [userUid]
  );

  const uploadFile = async (file: File): Promise<Attachment | null> => {
    if (!userUid) return null;
    setIsUploading(true);
    try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `${roomKey}/${fileName}`;
    
        const { error } = await supabase.storage
          .from('attachments')
          .upload(filePath, file);
    
        if (error) throw error;
    
        const { data: { publicUrl } } = supabase.storage
          .from('attachments')
          .getPublicUrl(filePath);
    
        return {
          url: publicUrl,
          name: file.name,
          type: file.type,
          size: file.size,
        };
    } catch (e) {
        console.error("Upload error", e);
        throw e;
    } finally {
        setIsUploading(false);
    }
  };

  return {
    messages,
    isUploading,
    sendMessage,
    editMessage,
    deleteMessage,
    reactToMessage,
    uploadFile,
    refreshMessages: fetchMessages
  };
};
