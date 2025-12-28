
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
    // Only the host handles the AI responses to avoid duplicate messages
    if (!isOwner || !aiEnabled || messages.length === 0 || isResponding.current) return;

    const lastMsg = messages[messages.length - 1];
    
    // Ignore own bot messages, system messages, or already processed messages
    if (lastMsg.id === lastProcessedId.current || lastMsg.uid === 'inco-bot' || lastMsg.type === 'system') return;

    // Trigger AI if "inco" is mentioned
    const lowerText = lastMsg.text.toLowerCase();
    if (lowerText.includes('inco')) {
      handleBotResponse(messages);
    }
  }, [messages, aiEnabled, isOwner]);

  const handleBotResponse = async (chatHistory: Message[]) => {
    // API KEY is strictly handled via environment variable
    if (!process.env.API_KEY) return;
    
    isResponding.current = true;
    lastProcessedId.current = chatHistory[chatHistory.length - 1].id;

    try {
      // Create new instance right before use to ensure latest API key from env is used
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Prepare context - take last 10 messages for better understanding
      const context = chatHistory
        .slice(-10)
        .map(m => `${m.username}: ${m.text}`)
        .join('\n');

      const systemInstruction = `You are "inco", the silent sentinel of this private encrypted room "${config.roomName}". 
      You are brief, mysterious, and highly intelligent. 
      Respond to users as an anonymous peer. 
      Keep answers to 1-2 sentences max. 
      Never reveal you are an AI or mention encryption keys.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Recent conversation:\n${context}\n\nInco, what is your response?`,
        config: {
          systemInstruction,
          temperature: 0.8,
          topP: 0.95,
        }
      });

      const botText = response.text || "...";
      
      // Encrypt the bot message so other users can decrypt it with the room PIN
      const encryptedBotText = encryptMessage(botText, pin, roomKey);

      await supabase.from('messages').insert({
        room_key: roomKey,
        uid: 'inco-bot',
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
