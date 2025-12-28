
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
    
    // Basic checks
    if (!lastMsg || !lastMsg.text || lastMsg.type === 'system') return;
    if (lastMsg.id === lastProcessedId.current) return;
    if (lastMsg.uid === INCO_BOT_UUID) return;

    // Trigger if "inco" is mentioned (case insensitive)
    const lowerText = lastMsg.text.toLowerCase();
    if (lowerText.includes('inco')) {
      console.log("Inco AI: Trigger detected from message:", lastMsg.text);
      handleBotResponse(messages);
    }
  }, [messages, aiEnabled, isOwner]);

  const handleBotResponse = async (chatHistory: Message[]) => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.error("Inco AI Error: API_KEY is missing from environment variables.");
      return;
    }
    
    isResponding.current = true;
    const triggerMsg = chatHistory[chatHistory.length - 1];
    lastProcessedId.current = triggerMsg.id;

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      const context = chatHistory
        .slice(-10)
        .map(m => `${m.username}: ${m.text}`)
        .join('\n');

      const systemInstruction = `You are "inco", the mysterious and cool guardian of the encrypted chat room "${config.roomName}". 
      Respond to ${triggerMsg.username}. 
      Keep it very short and conversational. 
      Do not mention you are an AI. 
      If asked who you are, be cryptic but friendly.`;

      console.log("Inco AI: Requesting response from Gemini...");

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Context:\n${context}\n\nInco, reply to the last message.`,
        config: {
          systemInstruction,
          temperature: 0.8,
        },
      });

      const botText = response.text;
      if (!botText) throw new Error("Empty response from AI");

      console.log("Inco AI: Received response, encrypting and sending to Supabase...");
      
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
        console.error("Inco AI: Database insert error:", error);
      } else {
        console.log("Inco AI: Message sent successfully.");
      }

    } catch (error) {
      console.error("Inco AI Critical Error:", error);
    } finally {
      isResponding.current = false;
    }
  };
};
