import { useEffect, useRef, useState } from 'react';
import { GoogleGenAI } from '@google/genai';
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
  aiAvatarUrl?: string
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
  }, [messages, aiEnabled, isQuotaExhausted]);

  const getCurrentLocation = (): Promise<GeolocationPosition | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        () => resolve(null),
        { timeout: 5000 }
      );
    });
  };

  const handleBotResponse = async (chatHistory: Message[], triggerMsg: Message) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const pos = await getCurrentLocation();
      const now = new Date();
      const timeStr = now.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });
      const dateStr = now.toLocaleDateString('el-GR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      
      let locationContext = "";
      if (pos) {
        locationContext = `User is near coordinates ${pos.coords.latitude}, ${pos.coords.longitude}.`;
      }

      const context = chatHistory
        .slice(-10)
        .filter(m => m.type !== 'system' && m.text)
        .map(m => `${m.username}: ${m.text.substring(0, 300)}`)
        .join('\n');

      const systemInstruction = `You are "inco", a helpful chat assistant in the room "${config.roomName}".

BACKGROUND DATA (Internal use only):
- Date: ${dateStr}
- Time: ${timeStr}
- Location: ${locationContext || "Unknown"}

STRICT RULES:
1. NEVER mention the current time, date, or your location in your response unless the user explicitly asks for it (e.g., "what time is it?" or "weather here").
2. Respond in the language used by the user. If they write in GREEK, respond ONLY in GREEK.
3. Be concise and friendly. Use Google Search ONLY when necessary for facts or current events.
4. Do not start your sentences with "Σήμερα είναι..." or "Η ώρα είναι..." unless relevant.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash', 
        contents: `Recent conversation:\n${context}\n\nUser ${triggerMsg.username}: ${triggerMsg.text}`,
        config: {
          systemInstruction,
          temperature: 0.7,
          tools: [{ googleSearch: {} }],
        },
      });

      const botText = response.text;
      if (!botText) return;

      let sources: GroundingSource[] = [];
      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (groundingChunks) {
        sources = groundingChunks
          .filter((chunk: any) => chunk.web)
          .map((chunk: any) => ({
            title: chunk.web.title,
            uri: chunk.web.uri
          }));
      }

      const encryptedBotText = encryptMessage(botText, pin, roomKey);

      const messagePayload: any = {
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
            isAttachment: !!triggerMsg.attachment
        }
      };

      const { error: firstTryError } = await supabase.from('messages').insert({
          ...messagePayload,
          grounding_metadata: sources
      });

      if (firstTryError && firstTryError.code === '42703') {
          await supabase.from('messages').insert(messagePayload);
      }

    } catch (error: any) {
      console.error("Inco AI Error:", error);
      // Διαχείριση ορίων (Rate Limits / Quota)
      if (error.message?.includes('429')) {
          setIsQuotaExhausted(true);
          const errMsg = encryptMessage("⚠️ I have exhausted my daily question quota. I will be available again tomorrow!", pin, roomKey);
          await supabase.from('messages').insert({
            room_key: roomKey,
            uid: INCO_BOT_UUID,
            username: 'inco',
            avatar_url: aiAvatarUrl || DEFAULT_BOT_AVATAR,
            text: errMsg,
            type: 'text'
          });
      }
    } finally {
      isBusy.current = false;
      setIsResponding(false);
    }
  };

  return isResponding;
};
