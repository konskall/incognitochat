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
     * 1. Check if text contains "inco"
     * 2. Check if the message is a reply to an Inco bot message
     */
    const mentionsInco = lowerText.includes('inco');
    
    // Find if the message being replied to was sent by the bot
    const isReplyToBot = lastMsg.replyTo && 
      messages.find(m => m.id === lastMsg.replyTo?.id)?.uid === INCO_BOT_UUID;

    if (mentionsInco || isReplyToBot) {
      setIsResponding(true);
      handleBotResponse(messages);
    }
  }, [messages, aiEnabled, isOwner, isResponding]);

  const handleBotResponse = async (chatHistory: Message[]) => {
    // Access the injected API key
    const apiKey = process.env.API_KEY;
    
    if (!apiKey) {
      console.error("Inco AI: API_KEY is missing from environment!");
      setIsResponding(false);
      return;
    }
    
    const triggerMsg = chatHistory[chatHistory.length - 1];
    lastProcessedId.current = triggerMsg.id;

    try {
      // Create a new GoogleGenAI instance right before making an API call to ensure it uses current key
      const ai = new GoogleGenAI({ apiKey });
      
      // Send last 15 messages for better context in replies
      const context = chatHistory
        .slice(-15)
        .map(m => `${m.username}: ${m.text}`)
        .join('\n');

      const systemInstruction = `You are "inco", a helpful assistant on chat room "${config.roomName}". 
      You are currently speaking with ${triggerMsg.username}. 
      Keep your responses short and direct (under 20 words). 
      Be helpful and useful. Focus on helping with questions. If the user is replying to you, continue the conversation naturally.
      Never mention you are an AI or a bot.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Recent conversation context:\n${context}\n\nInco, respond to ${triggerMsg.username}'s last message.`,
        config: {
          systemInstruction,
          temperature: 0.8,
        },
      });

      const botText = response.text;
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
        type: 'text',
        // We add a reply link back to the user's message to maintain the thread
        reply_to: {
            id: triggerMsg.id,
            username: triggerMsg.username,
            text: triggerMsg.text,
            isAttachment: !!triggerMsg.attachment
        }
      });

    } catch (error) {
      console.error("Inco AI: Processing Error", error);
    } finally {
      setIsResponding(false);
    }
  };

  return isResponding;
};
