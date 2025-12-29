
import { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { supabase } from '../services/supabase';
import { Message, ChatConfig } from '../types';
import { encryptMessage } from '../utils/helpers';

const INCO_BOT_UUID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_BOT_AVATAR = 'https://api.dicebear.com/9.x/bottts/svg?seed=inco&backgroundColor=6366f1';

export const useIncoAI = (
  roomKey: string,
  pin: string,
  messages: Message[],
  config: ChatConfig,
  aiEnabled: boolean,
  aiAvatarUrl?: string
) => {
  const lastProcessedId = useRef<string | null>(null);
  const isBusy = useRef<boolean>(false); // Mutex lock για αποφυγή διπλών κλήσεων
  const [isResponding, setIsResponding] = useState(false);

  useEffect(() => {
    // 1. Βασικοί έλεγχοι αν το AI είναι ενεργό
    if (!aiEnabled || messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];
    
    // 2. Έλεγχος αν το μήνυμα είναι έγκυρο για απάντηση
    if (!lastMsg || !lastMsg.text || lastMsg.type === 'system') return;
    if (lastMsg.uid === INCO_BOT_UUID) return; // Το bot δεν απαντά στον εαυτό του
    if (lastMsg.id === lastProcessedId.current) return; // Έχει ήδη υποβληθεί σε επεξεργασία
    
    // ΚΡΙΣΙΜΟ: Αν το bot επεξεργάζεται ήδη απάντηση, αγνόησε το νέο trigger
    if (isBusy.current) return;

    const lowerText = lastMsg.text.toLowerCase().trim();
    const mentionsInco = lowerText.includes('inco');
    
    // Έλεγχος αν είναι απάντηση σε μήνυμα του bot
    const isReplyToBot = lastMsg.replyTo && 
      messages.find(m => m.id === lastMsg.replyTo?.id)?.uid === INCO_BOT_UUID;

    if (mentionsInco || isReplyToBot) {
      // ΑΚΑΡΙΑΙΟ ΚΛΕΙΔΩΜΑ (Ref update is synchronous)
      isBusy.current = true;
      lastProcessedId.current = lastMsg.id;
      setIsResponding(true);
      
      // Ξεκινάμε την ασύγχρονη διαδικασία
      handleBotResponse(messages, lastMsg);
    }
  }, [messages, aiEnabled]);

  const handleBotResponse = async (chatHistory: Message[], triggerMsg: Message) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const context = chatHistory
        .slice(-8)
        .filter(m => m.type !== 'system' && m.text)
        .map(m => `${m.username}: ${m.text.substring(0, 300)}`)
        .join('\n');

      const systemInstruction = `You are "inco", a helpful chat room assistant in the chat room "${config.roomName}". 
      User "${triggerMsg.username}" just sent a message or replied to you.
      CRITICAL RULES:
      - ALWAYS respond in the language the user is using. If they write in GREEK, you MUST respond in GREEK.
      - Never say you are an AI or bot.
      - Keep it short (max 20 words).
      - Focus on helping with questions.
      - Be natural, like a human participant.`;

      const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      ];

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Context:\n${context}\n\nUser ${triggerMsg.username} said: ${triggerMsg.text}\nRespond directly to them:`,
        config: {
          systemInstruction,
          temperature: 0.8,
          safetySettings,
        },
      });

      const botText = response.text;
      if (!botText) throw new Error("Empty response");

      const encryptedBotText = encryptMessage(botText, pin, roomKey);

      await supabase.from('messages').insert({
        room_key: roomKey,
        uid: INCO_BOT_UUID,
        username: 'inco',
        avatar_url: aiAvatarUrl || DEFAULT_BOT_AVATAR,
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
      console.error("Inco AI Error:", error);
      
      // Εμφάνιση μηνύματος σφάλματος μόνο αν είναι πραγματικό σφάλμα ορίου (429)
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        try {
          const limitMessage = "Έφτασα το ημερήσιο όριο σκέψης μου! Χρειάζομαι λίγη ξεκούραση για να αναπληρώσω το μυστήριό μου... Δοκίμασε ξανά σε λίγο. ✨";
          const encryptedLimitText = encryptMessage(limitMessage, pin, roomKey);

          await supabase.from('messages').insert({
            room_key: roomKey,
            uid: INCO_BOT_UUID,
            username: 'inco',
            avatar_url: aiAvatarUrl || DEFAULT_BOT_AVATAR,
            text: encryptedLimitText,
            type: 'text'
          });
        } catch (dbError) {
          console.error("DB error on limit message", dbError);
        }
      }
    } finally {
      // ΞΕΚΛΕΙΔΩΜΑ (Απελευθέρωση του mutex)
      isBusy.current = false;
      setIsResponding(false);
    }
  };

  return isResponding;
};
