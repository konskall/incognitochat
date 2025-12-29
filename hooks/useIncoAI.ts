import { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { supabase } from '../services/supabase';
import { Message, ChatConfig } from '../types';
import { encryptMessage } from '../utils/helpers';

const INCO_BOT_UUID = '00000000-0000-0000-0000-000000000000';

export const useIncoAI = (
  roomKey: string,
  pin: string,
  isOwner: boolean,
  messages: Message[],
  config: ChatConfig,
  aiEnabled: boolean
) => {
  const lastProcessedId = useRef<string | null>(null);
  const [isResponding, setIsResponding] = useState(false);

  useEffect(() => {
    if (!aiEnabled || messages.length === 0 || isResponding) return;

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || !lastMsg.text || lastMsg.type === 'system') return;
    if (lastMsg.id === lastProcessedId.current) return;
    if (lastMsg.uid === INCO_BOT_UUID) return;

    const lowerText = lastMsg.text.toLowerCase().trim();
    const mentionsInco = lowerText.includes('inco');
    const isReplyToBot = lastMsg.replyTo && 
      messages.find(m => m.id === lastMsg.replyTo?.id)?.uid === INCO_BOT_UUID;

    if (mentionsInco || isReplyToBot) {
      setIsResponding(true);
      handleBotResponse(messages);
    }
  }, [messages, aiEnabled, isResponding]);

  const handleBotResponse = async (chatHistory: Message[]) => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      setIsResponding(false);
      return;
    }
    
    const triggerMsg = chatHistory[chatHistory.length - 1];
    lastProcessedId.current = triggerMsg.id;

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      // Περιορισμός του context στα τελευταία 10 μηνύματα για εξοικονόμηση tokens
      const context = chatHistory
        .slice(-10)
        .filter(m => m.type !== 'system' && m.text)
        .map(m => `${m.username}: ${m.text.substring(0, 300)}`) // Κόβουμε πολύ μεγάλα μηνύματα
        .join('\n');

      const systemInstruction = `You are "inco", a helpful assistant in the encrypted chat room "${config.roomName}". 
      User "${triggerMsg.username}" just sent a message or replied to you.
      Guidelines:
      - Response must be under 20 words.
      - Be helpful and useful. Focus on helping with questions.
      - If the user is replying to you, continue the conversation naturally.
      - Never mention you are an AI.
      - Language: Respond in the same language as the user.`;

      // Ρυθμίσεις για να μην κόβεται η απάντηση από τα φίλτρα ασφαλείας της Google
      const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      ];

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Previous messages:\n${context}\n\nRespond to: ${triggerMsg.username}`,
        config: {
          systemInstruction,
          temperature: 0.7, // Ελαφρώς χαμηλότερο για πιο σταθερές απαντήσεις
          safetySettings,
        },
      });

      const botText = response.text;
      if (!botText) throw new Error("Blocked or Empty response");

      const encryptedBotText = encryptMessage(botText, pin, roomKey);

      await supabase.from('messages').insert({
        room_key: roomKey,
        uid: INCO_BOT_UUID,
        username: 'inco',
        avatar_url: 'https://api.dicebear.com/9.x/bottts/svg?seed=inco&backgroundColor=6366f1',
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
      // Αν έχουμε Rate Limit (429), περιμένουμε λίγο πριν το επόμενο
      if (error.message?.includes('429')) {
        console.error("Inco AI: Rate limit exceeded. Try again in a few seconds.");
      } else {
        console.error("Inco AI Error:", error);
      }
    } finally {
      setIsResponding(false);
    }
  };

  return isResponding;
};
