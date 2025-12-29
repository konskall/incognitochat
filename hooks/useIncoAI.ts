
import { useEffect, useRef, useState } from 'react';
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
  const [isResponding, setIsResponding] = useState(false);

  useEffect(() => {
    // The bot only triggers if AI is enabled and we are not already responding
    if (!aiEnabled || messages.length === 0 || isResponding) return;

    const lastMsg = messages[messages.length - 1];
    
    if (!lastMsg || !lastMsg.text || lastMsg.type === 'system') return;
    if (lastMsg.id === lastProcessedId.current) return;
    if (lastMsg.uid === INCO_BOT_UUID) return;

    // IMPORTANT: In this architecture, only ONE client should handle the bot response
    // to avoid multiple AI replies. We designate the Room Owner (Host) as the bot handler.
    if (!isOwner) return;

    const lowerText = lastMsg.text.toLowerCase().trim();
    
    if (lowerText.includes('inco') || lowerText.includes('!test')) {
      setIsResponding(true);
      handleBotResponse(messages);
    }
  }, [messages, aiEnabled, isOwner, isResponding]);

  const handleBotResponse = async (chatHistory: Message[]) => {
    // Try to get key from process.env (injected during build) or global scope
    const apiKey = (typeof process !== 'undefined' && process.env?.API_KEY) 
                   ? process.env.API_KEY 
                   : undefined;
    
    if (!apiKey) {
      console.warn("Inco AI: API_KEY not found in environment.");
      setIsResponding(false);
      return;
    }
    
    const triggerMsg = chatHistory[chatHistory.length - 1];
    lastProcessedId.current = triggerMsg.id;

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      const context = chatHistory
        .slice(-10)
        .map(m => `${m.username}: ${m.text}`)
        .join('\n');

      const systemInstruction = `You are "inco", the mysterious and wise guardian of the chat room "${config.roomName}". 
      You are speaking with ${triggerMsg.username}. 
      Keep your response very short (under 20 words). 
      Be helpful but maintain an aura of mystery.
      Never mention you are an AI.`;

      const result = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Recent conversation:\n${context}\n\nInco, respond to ${triggerMsg.username}'s last input.`,
        config: {
          systemInstruction,
          temperature: 0.8,
        },
      });

      const botText = result.text;
      if (!botText) throw new Error("Empty response");

      const encryptedBotText = encryptMessage(botText, pin, roomKey);

      await supabase.from('messages').insert({
        room_key: roomKey,
        uid: INCO_BOT_UUID,
        username: 'inco',
        avatar_url: 'https://api.dicebear.com/9.x/bottts/svg?seed=inco&backgroundColor=6366f1',
        text: encryptedBotText,
        type: 'text'
      });

    } catch (error) {
      console.error("Inco AI: Processing Error", error);
    } finally {
      setIsResponding(false);
    }
  };

  return isResponding;
};
