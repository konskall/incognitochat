import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { Message, ChatConfig, GroundingSource } from '../types';
import { encryptMessage } from '../utils/crypto';
import { buildIncoTurns } from '../utils/incoContext';
import { reverseGeocodeCity } from '../utils/geocode';
import { stripIncoMarkdown } from '../utils/incoFormat';

const INCO_BOT_UUID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_BOT_AVATAR = 'https://api.dicebear.com/9.x/bottts/svg?seed=inco&backgroundColor=6366f1';

export const useIncoAI = (
  roomKey: string,
  pin: string,
  messages: Message[],
  config: ChatConfig,
  aiEnabled: boolean,
  aiAvatarUrl?: string,
  userUid?: string
) => {
  const lastProcessedId = useRef<string | null>(null);
  const isBusy = useRef<boolean>(false);
  const seeded = useRef<boolean>(false);
  const [isResponding, setIsResponding] = useState(false);
  const [isQuotaExhausted, setIsQuotaExhausted] = useState(false);

  useEffect(() => {
    if (messages.length === 0) return;

    // Seed on the first non-empty render: never answer pre-existing history (or
    // a stale unanswered mention left from a previous mount) — only messages
    // that arrive AFTER we mount. Without this, re-entering a room whose newest
    // message is your own inco-mention fired a ghost/duplicate reply.
    if (!seeded.current) {
      seeded.current = true;
      lastProcessedId.current = messages[messages.length - 1].id;
      return;
    }

    if (!aiEnabled || isQuotaExhausted) return;

    const lastMsg = messages[messages.length - 1];

    if (!lastMsg || !lastMsg.text || lastMsg.type === 'system') return;
    // Never trigger on a not-yet-persisted optimistic message: its id is a
    // temp_… that doesn't exist server-side (the bot reply would carry a dangling
    // reply_to.id), and re-triggering after it reconciles can double-bill Gemini.
    // The bot must fire only on the reconciled real row. (temp-exclusion invariant)
    if (lastMsg.status) return;
    if (lastMsg.uid === INCO_BOT_UUID) return;
    // Only the author of the triggering message generates the reply. The bot
    // response is inserted client-side, so without this every member who has Inco
    // enabled would answer — producing one duplicate per online client. Gating on
    // the author guarantees exactly one responder.
    if (!userUid || lastMsg.uid !== userUid) return;
    if (lastMsg.id === lastProcessedId.current) return;
    if (isBusy.current) return;

    const lowerText = lastMsg.text.toLowerCase().trim();
    // Match "inco" as a whole word (optionally @-mentioned), NOT as a substring —
    // otherwise ordinary words like "incoming", "income", "incomplete" and the
    // app's own name "incognito" would spuriously summon the bot.
    const mentionsInco = /(^|[^a-z0-9])@?inco([^a-z0-9]|$)/i.test(lowerText);
    const isReplyToBot = lastMsg.replyTo &&
      messages.find(m => m.id === lastMsg.replyTo?.id)?.uid === INCO_BOT_UUID;

    if (mentionsInco || isReplyToBot) {
      // Call directly — NO cancellable setTimeout. The trigger is the user's own
      // already-committed message, so there's nothing to debounce; the old timer
      // was cancelled by the effect cleanup whenever any realtime event landed
      // within 500ms, which left isBusy stuck true and wedged the bot forever.
      isBusy.current = true;
      lastProcessedId.current = lastMsg.id;
      setIsResponding(true);
      handleBotResponse(messages, lastMsg);
    }
  }, [messages, aiEnabled, isQuotaExhausted, userUid]);

  const handleBotResponse = async (chatHistory: Message[], triggerMsg: Message) => {
    try {
      // aiAvatarUrl is room-controlled (any member can set it via "Customize AI
      // look"), so it can be a javascript:/data:/http: URL. It gets written
      // verbatim into messages.avatar_url and later rendered as <img src>, so
      // enforce the same https-only policy safeAvatarUrl applies elsewhere —
      // falling back to the bot's own default rather than the generic person.
      const safeAiAvatar = aiAvatarUrl && /^https:\/\//i.test(aiAvatarUrl) ? aiAvatarUrl : DEFAULT_BOT_AVATAR;
      // Conversation as proper turns (the bot's own msgs as 'model'), so inco
      // follows the thread on follow-ups. The trigger is the last user turn.
      const history = buildIncoTurns(chatHistory, INCO_BOT_UUID);
      // The user's LOCAL date/time, formatted on-device (the edge runs in UTC).
      const clientDateTime = new Date().toLocaleString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
      });

      const baseBody = {
        roomKey,
        roomName: config.roomName,
        history,
        triggerText: triggerMsg.text,
        triggerUsername: triggerMsg.username,
        clientDateTime,
      };

      // Gemini is called server-side (Edge Function `inco-ai`) so the API key is
      // never shipped to the browser. We encrypt + insert the reply client-side so
      // the room PIN / encryption key never leaves the device.
      let { data, error } = await supabase.functions.invoke('inco-ai', { body: baseBody });
      if (error) { console.error('Inco AI proxy error:', error); return; }

      // Location protocol: the model asked for the user's location. Request GPS
      // ONCE (on-demand consent), reverse-geocode to a CITY NAME client-side, and
      // re-invoke. Denial / unavailable / geocode-fail → re-invoke with a denied
      // flag so inco asks for the city instead of stalling. (Coords never leave the
      // device except to OSM Nominatim for the lookup; only the city is sent on.)
      if ((data as { needLocation?: boolean })?.needLocation) {
        let city: string | null = null;
        if (navigator.geolocation) {
          try {
            const pos = await new Promise<GeolocationPosition>((res, rej) =>
              navigator.geolocation.getCurrentPosition(res, rej, { timeout: 15000, maximumAge: 600000 }),
            );
            city = await reverseGeocodeCity(pos.coords.latitude, pos.coords.longitude);
          } catch { city = null; }
        }
        const second = await supabase.functions.invoke('inco-ai', {
          body: city ? { ...baseBody, locationCity: city } : { ...baseBody, locationDenied: true },
        });
        if (second.error) { console.error('Inco AI proxy error (loc):', second.error); return; }
        data = second.data;
      }

      if (data?.quota) {
        setIsQuotaExhausted(true);
        const errMsg = encryptMessage(
          "⚠️ I have exhausted my daily question quota. I will be available again tomorrow!",
          pin,
          roomKey
        );
        await supabase.from('messages').insert({
          room_key: roomKey,
          uid: INCO_BOT_UUID,
          username: 'inco',
          avatar_url: safeAiAvatar,
          text: errMsg,
          type: 'text',
        });
        return;
      }

      const rawBotText: string | undefined = data?.text;
      if (!rawBotText) return;
      // Defensively strip any markdown the model emitted despite the plain-text
      // prompt (the bubble renders raw text, so **bold**/`code`/"* " would show
      // literally). If stripping somehow empties it, fall back to the raw text.
      const botText = stripIncoMarkdown(rawBotText) || rawBotText;
      const sources: GroundingSource[] = data?.sources || [];

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
          // Encrypt the quoted excerpt at rest, same as the message body.
          text: encryptMessage(triggerMsg.text.substring(0, 100), pin, roomKey),
          isAttachment: !!triggerMsg.attachment,
        },
        grounding_metadata: sources,
      });
    } catch (error: any) {
      console.error("Inco AI Error:", error);
    } finally {
      isBusy.current = false;
      setIsResponding(false);
    }
  };

  return isResponding;
};
