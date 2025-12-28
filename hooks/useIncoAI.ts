
import { useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { supabase } from '../services/supabase';
import { Message, ChatConfig } from '../types';
import { encryptMessage } from '../utils/helpers';

// Constant UUID for the Bot
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
  const isResponding = useRef(false);

  useEffect(() => {
    // Only the host triggers the AI to prevent duplicate responses
    if (!isOwner || !aiEnabled || messages.length === 0 || isResponding.current) return;

    const lastMsg = messages[messages.length - 1];
    
    // Safety checks
    if (!lastMsg || !lastMsg.text) return;
    if (lastMsg.id === lastProcessedId.current) return;
    if (lastMsg.uid === INCO_BOT_UUID || lastMsg.type === 'system') return;

    // The bot triggers if the message contains its name
    const lowerText = lastMsg.text.toLowerCase();
    if (lowerText.includes('inco')) {
      handleBotResponse(messages);
    }
  }, [messages, aiEnabled, isOwner]);

  const handleBotResponse = async (chatHistory: Message[]) => {
    if (!process.env.API_KEY) {
      console.warn("Inco AI: Missing API_KEY in environment variables.");
      return;
    }
    
    isResponding.current = true;
    const triggerMsg = chatHistory[chatHistory.length - 1];
    lastProcessedId.current = triggerMsg.id;

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Get a small window of context for better responses
      const context = chatHistory
        .slice(-6)
        .map(m => `${m.username}: ${m.text}`)
        .join('\n');

      const systemInstruction = `You are "inco", the mysterious, wise, and slightly cryptic guardian of this encrypted chat room called "${config.roomName}". 
      - Speak like a real human, but stay anonymous.
      - Keep responses short (under 30 words).
      - Never say you are an AI. 
      - The person you are talking to is ${triggerMsg.username}.
      - Respond naturally to their last comment.`;

      const result = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Conversation context:\n${context}\n\nInco, reply to ${triggerMsg.username}:`,
        config: {
          systemInstruction,
          temperature: 0.9,
          topP: 0.8,
        },
      });

      const botText = result.text || "...";
      const encryptedBotText = encryptMessage(botText, pin, roomKey);

      const { error } = await supabase.from('messages').insert({
        room_key: roomKey,
        uid: INCO_BOT_UUID,
        username: 'inco',
        avatar_url: 'https://api.dicebear.com/9.x/bottts/svg?seed=inco&backgroundColor=6366f1',
        text: encryptedBotText,
        type: 'text'
      });

      if (error) throw error;

    } catch (error) {
      console.error("Inco AI Critical Error:", error);
    } finally {
      isResponding.current = false;
    }
  };
};
