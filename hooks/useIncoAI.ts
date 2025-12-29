
import { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { supabase } from '../services/supabase';
import { Message, ChatConfig } from '../types';
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

  useEffect(() => {
    if (!aiEnabled || messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];
    
    // Έλεγχοι εγκυρότητας
    if (!lastMsg || !lastMsg.text || lastMsg.type === 'system') return;
    if (lastMsg.uid === INCO_BOT_UUID) return; 
    if (lastMsg.id === lastProcessedId.current) return;
    if (isBusy.current) return;

    const lowerText = lastMsg.text.toLowerCase().trim();
    const mentionsInco = lowerText.includes('inco');
    const isReplyToBot = lastMsg.replyTo && 
      messages.find(m => m.id === lastMsg.replyTo?.id)?.uid === INCO_BOT_UUID;

    if (mentionsInco || isReplyToBot) {
      // Άμεσο κλείδωμα
      isBusy.current = true;
      lastProcessedId.current = lastMsg.id;
      
      // Μικρή καθυστέρηση για αποφυγή race conditions από το React Strict Mode
      const timer = setTimeout(() => {
        setIsResponding(true);
        handleBotResponse(messages, lastMsg);
      }, 200);

      return () => clearTimeout(timer);
    }
  }, [messages, aiEnabled]);

  const handleBotResponse = async (chatHistory: Message[], triggerMsg: Message) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const context = chatHistory
        .slice(-8)
        .filter(m => m.type !== 'system' && m.text)
        .map(m => `${m.username}: ${m.text.substring(0, 300)}`)
        .join('\n');

      const systemInstruction = `You are "inco", a friendly assistant in "${config.roomName}". 
      User "${triggerMsg.username}" is talking to you.
      
      LANG_RULES:
      - If user writes GREEK, you MUST respond ONLY in GREEK.
      - If user writes ENGLISH, you MUST respond ONLY in ENGLISH.
      
      PERSONALITY:
      - Short natural answers (max 15 words).
      - Never say you are an AI.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Context:\n${context}\n\nUser ${triggerMsg.username} said: ${triggerMsg.text}\nRespond directly:`,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      const botText = response.text;
      if (!botText) return;

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
            isAttachment: !!triggerMsg.attachment
        }
      });

    } catch (error: any) {
      console.error("Inco AI Error:", error);
      // ΔΕΝ δημοσιεύουμε πλέον μήνυμα σφάλματος στο chat για να αποφύγουμε τα διπλά μηνύματα
    } finally {
      isBusy.current = false;
      setIsResponding(false);
    }
  };

  return isResponding;
};
