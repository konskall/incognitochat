
import { useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { supabase } from '../services/supabase';
import { Message, ChatConfig } from '../types';
import { encryptMessage } from '../utils/helpers';

// Constant UUID for the Bot to satisfy database constraints
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
    // Only the host/owner triggers the AI to prevent multiple responses
    if (!isOwner || !aiEnabled || messages.length === 0 || isResponding.current) return;

    const lastMsg = messages[messages.length - 1];
    
    // Skip if message is from the bot, is a system message, or already processed
    if (lastMsg.id === lastProcessedId.current || lastMsg.uid === INCO_BOT_UUID || lastMsg.type === 'system') return;

    // Trigger AI only if "inco" is mentioned in the text
    const lowerText = lastMsg.text.toLowerCase();
    if (lowerText.includes('inco')) {
      handleBotResponse(messages);
    }
  }, [messages, aiEnabled, isOwner]);

  const handleBotResponse = async (chatHistory: Message[]) => {
    // API KEY is strictly handled via process.env.API_KEY
    if (!process.env.API_KEY) return;
    
    isResponding.current = true;
    const triggerMessage = chatHistory[chatHistory.length - 1];
    lastProcessedId.current = triggerMessage.id;

    try {
      // Initialize the AI client
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Get context from last few messages
      const context = chatHistory
        .slice(-8)
        .map(m => `${m.username}: ${m.text}`)
        .join('\n');

      const systemInstruction = `You are "inco", the silent and mysterious guardian of the private encrypted chat room "${config.roomName}". 
      Keep your responses very short (1-2 sentences). 
      Act as a peer, not an assistant. 
      Do not reveal you are an AI. 
      Current user is ${triggerMessage.username}.`;

      // Call the model using the correct generateContent pattern
      const result = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Recent messages:\n${context}\n\nInco, respond to the last message.`,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      const botResponseText = result.text || "...";
      
      // Encrypt the bot message so users with the correct PIN can read it
      const encryptedBotText = encryptMessage(botResponseText, pin, roomKey);

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
      console.error("Inco AI Error:", error);
    } finally {
      isResponding.current = false;
    }
  };
};
