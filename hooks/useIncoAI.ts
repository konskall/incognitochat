
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

  // Immediate log to verify the hook is mounting
  useEffect(() => {
    console.log("Inco AI Hook: Mounted/Updated", { 
      aiEnabled, 
      isOwner, 
      room: config.roomName,
      messagesCount: messages.length 
    });
  }, [aiEnabled, isOwner, messages.length]);

  useEffect(() => {
    if (!aiEnabled || messages.length === 0 || isResponding.current) return;

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || !lastMsg.text || lastMsg.type === 'system') return;
    if (lastMsg.id === lastProcessedId.current) return;
    if (lastMsg.uid === INCO_BOT_UUID) return;

    const lowerText = lastMsg.text.toLowerCase();
    
    // Trigger logic
    if (lowerText.includes('inco') || lowerText.includes('!test')) {
      if (!isOwner && !lowerText.includes('!test')) {
        console.warn("Inco AI: Not owner, trigger ignored.");
        return;
      }
      console.log("Inco AI: Trigger detected! Preparing response...");
      handleBotResponse(messages);
    }
  }, [messages, aiEnabled, isOwner]);

  const handleBotResponse = async (chatHistory: Message[]) => {
    let apiKey: string | undefined;
    
    // Safe access to process.env to avoid ReferenceError in Vite
    try {
      apiKey = typeof process !== 'undefined' ? process.env.API_KEY : undefined;
    } catch (e) {
      console.error("Inco AI: Could not access process.env", e);
    }
    
    if (!apiKey) {
      console.error("CRITICAL ERROR: API_KEY is undefined. Check your environment variables.");
      return;
    }
    
    isResponding.current = true;
    const triggerMsg = chatHistory[chatHistory.length - 1];
    lastProcessedId.current = triggerMsg.id;

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      const context = chatHistory
        .slice(-8)
        .map(m => `${m.username}: ${m.text}`)
        .join('\n');

      const systemInstruction = `You are "inco", the guardian of "${config.roomName}". 
      Respond to ${triggerMsg.username}. Keep it short and mysterious.`;

      console.log("Inco AI: Calling Gemini API...");
      const result = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Context:\n${context}\n\nInco, reply to the last message.`,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      const botText = result.text;
      if (!botText) throw new Error("Empty response from Gemini");

      console.log("Inco AI: Encrypting response...");
      const encryptedBotText = encryptMessage(botText, pin, roomKey);

      const { error } = await supabase.from('messages').insert({
        room_key: roomKey,
        uid: INCO_BOT_UUID,
        username: 'inco',
        avatar_url: 'https://api.dicebear.com/9.x/bottts/svg?seed=inco&backgroundColor=6366f1',
        text: encryptedBotText,
        type: 'text'
      });

      if (error) {
        console.error("Inco AI: Supabase Insert Error:", error);
      } else {
        console.log("Inco AI: Bot message sent to DB.");
      }

    } catch (error) {
      console.error("Inco AI: API or Process Error:", error);
    } finally {
      isResponding.current = false;
    }
  };
};
