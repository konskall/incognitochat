import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { Message, ChatConfig, GroundingSource } from '../types';
import { encryptMessage } from '../utils/helpers';

const INCO_BOT_UUID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_BOT_AVATAR = 'https://api.dicebear.com/9.x/bottts/svg?seed=inco&backgroundColor=6366f1';

export const useIncoAI = (
  roomKey: string,
  pin: string,
  messages: Message[],
  config: ChatConfig,
  aiEnabled: boolean,
  aiAvatarUrl?: string,
  userUid?: string
) => {
  const lastProcessedId = useRef<string | null>(null);
  const isBusy = useRef<boolean>(false);
  const [isResponding, setIsResponding] = useState(false);
  const [isQuotaExhausted, setIsQuotaExhausted] = useState(false);

  useEffect(() => {
    if (!aiEnabled || messages.length === 0 || isQuotaExhausted) return;

    const lastMsg = messages[messages.length - 1];
    
    if (!lastMsg || !lastMsg.text || lastMsg.type === 'system') return;
    if (lastMsg.uid === INCO_BOT_UUID) return;
    // Only the author of the triggering message generates the reply. The bot
    // response is inserted client-side, so without this every member who has Inco
    // enabled would answer — producing one duplicate per online client. Gating on
    // the author guarantees exactly one responder.
    if (!userUid || lastMsg.uid !== userUid) return;
    if (lastMsg.id === lastProcessedId.current) return;
    if (isBusy.current) return;

    const lowerText = lastMsg.text.toLowerCase().trim();
    const mentionsInco = lowerText.includes('inco');
    const isReplyToBot = lastMsg.replyTo && 
      messages.find(m => m.id === lastMsg.replyTo?.id)?.uid === INCO_BOT_UUID;

    if (mentionsInco || isReplyToBot) {
      isBusy.current = true;
      lastProcessedId.current = lastMsg.id;
      
      const timer = setTimeout(() => {
        setIsResponding(true);
        handleBotResponse(messages, lastMsg);
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [messages, aiEnabled, isQuotaExhausted, userUid]);

  const handleBotResponse = async (chatHistory: Message[], triggerMsg: Message) => {
    try {
      const context = chatHistory
        .slice(-10)
        .filter(m => m.type !== 'system' && m.text)
        .map(m => `${m.username}: ${m.text.substring(0, 300)}`)
        .join('\n');

      // Gemini is called server-side (Edge Function `inco-ai`) so the API key is
      // never shipped to the browser. The function verifies room membership and
      // returns plaintext + grounding sources; we encrypt + insert client-side so
      // the room PIN / encryption key never leaves the device.
      const { data, error } = await supabase.functions.invoke('inco-ai', {
        body: {
          roomKey,
          roomName: config.roomName,
          context,
          triggerText: triggerMsg.text,
          triggerUsername: triggerMsg.username,
        },
      });

      if (error) {
        // 403 (not a member) / 503 (AI not configured) / 5xx — stay silent.
        console.error('Inco AI proxy error:', error);
        return;
      }

      if (data?.quota) {
        setIsQuotaExhausted(true);
        const errMsg = encryptMessage(
          "⚠️ I have exhausted my daily question quota. I will be available again tomorrow!",
          pin,
          roomKey
        );
        await supabase.from('messages').insert({
          room_key: roomKey,
          uid: INCO_BOT_UUID,
          username: 'inco',
          avatar_url: aiAvatarUrl || DEFAULT_BOT_AVATAR,
          text: errMsg,
          type: 'text',
        });
        return;
      }

      const botText: string | undefined = data?.text;
      if (!botText) return;
      const sources: GroundingSource[] = data?.sources || [];

      const encryptedBotText = encryptMessage(botText, pin, roomKey);

      await supabase.from('messages').insert({
        room_key: roomKey,
        uid: INCO_BOT_UUID,
        username: 'inco',
        avatar_url: aiAvatarUrl || DEFAULT_BOT_AVATAR,
        text: encryptedBotText,
        type: 'text',
        reply_to: {
          id: triggerMsg.id,
          username: triggerMsg.username,
          text: triggerMsg.text.substring(0, 100),
          isAttachment: !!triggerMsg.attachment,
        },
        grounding_metadata: sources,
      });
    } catch (error: any) {
      console.error("Inco AI Error:", error);
    } finally {
      isBusy.current = false;
      setIsResponding(false);
    }
  };

  return isResponding;
};
