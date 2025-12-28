
import { useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { supabase } from '../services/supabase';
import { Message, ChatConfig } from '../types';
import { encryptMessage } from '../utils/helpers';

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
    if (!isOwner || !aiEnabled || messages.length === 0 || isResponding.current) return;

    const lastMsg = messages[messages.length - 1];
    if (lastMsg.id === lastProcessedId.current || lastMsg.uid === 'inco-bot' || lastMsg.type === 'system') return;

    const lowerText = lastMsg.text.toLowerCase();
    if (lowerText.includes('inco')) {
      handleBotResponse(messages);
    }
  }, [messages, aiEnabled, isOwner]);

  const handleBotResponse = async (chatHistory: Message[]) => {
    isResponding.current = true;
    lastProcessedId.current = chatHistory[chatHistory.length - 1].id;

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      // Prepare context - take last 10 messages for better understanding
      const context = chatHistory
        .slice(-10)
        .map(m => `${m.username}: ${m.text}`)
        .join('\n');

      const prompt = `You are "inco", an intelligent AI assistant in an anonymous encrypted chat room called "${config.roomName}". 
      The following is the recent conversation context:
      ${context}
      
      Please respond to the last message or provide a helpful suggestion/comment. 
      Keep your response short, friendly, and respectful. Do not mention technical details about encryption or keys. 
      Respond as if you are a member of this private space.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });

      const botText = response.text || "I'm listening...";
      
      // Encrypt bot message
      const encryptedBotText = encryptMessage(botText, pin, roomKey);

      await supabase.from('messages').insert({
        room_key: roomKey,
        uid: 'inco-bot',
        username: 'inco',
        avatar_url: 'https://api.dicebear.com/9.x/bottts/svg?seed=inco',
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
