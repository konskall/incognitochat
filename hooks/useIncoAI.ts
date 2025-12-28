
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
    // Basic safety checks
    if (!aiEnabled || messages.length === 0 || isResponding) return;

    const lastMsg = messages[messages.length - 1];
    
    // Ignore if not a text message, if it's a system message, or if it's from the bot itself
    if (!lastMsg || !lastMsg.text || lastMsg.type === 'system') return;
    if (lastMsg.id === lastProcessedId.current) return;
    if (lastMsg.uid === INCO_BOT_UUID) return;

    const lowerText = lastMsg.text.toLowerCase().trim();
    
    /**
     * TRIGGER LOGIC
     * We respond if the message contains "inco" or "!test"
     */
    if (lowerText.includes('inco') || lowerText.includes('!test')) {
      handleBotResponse(messages);
    }
  }, [messages, aiEnabled, isOwner, isResponding]);

  const handleBotResponse = async (chatHistory: Message[]) => {
    let apiKey: string | undefined;
    
    try {
      // Compatibility for different environments
      apiKey = typeof process !== 'undefined' ? process.env.API_KEY : undefined;
    } catch (e) {
      console.error("Inco AI: Env access error", e);
    }
    
    if (!apiKey) {
      console.error("Inco AI: API_KEY is missing!");
      return;
    }
    
    setIsResponding(true);
    const triggerMsg = chatHistory[chatHistory.length - 1];
    lastProcessedId.current = triggerMsg.id;

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      // Send last 10 messages for context
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

      // Encrypt for the room
      const encryptedBotText = encryptMessage(botText, pin, roomKey);

      // Insert into Supabase
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
