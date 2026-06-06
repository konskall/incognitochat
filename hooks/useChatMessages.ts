
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/supabase';
import { Message, Attachment, Poll, ReplyInfo, GroundingSource } from '../types';
import { decryptMessage, encryptMessage } from '../utils/helpers';

// Shape of a raw `messages` row as it comes back from Postgres / realtime
// (snake_case, encrypted text, jsonb columns) before `mapRow` decrypts + maps it.
interface RawPoll {
  question: string;
  options: { id: string; text: string }[];
  votes: { [optionId: string]: string[] };
  multi?: boolean;
  closed?: boolean;
}

interface MessageRow {
  id: string;
  text: string | null;
  uid: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
  attachment?: Attachment | null;
  location?: { lat: number; lng: number } | null;
  is_edited?: boolean | null;
  reactions?: { [emoji: string]: string[] } | null;
  reply_to?: ReplyInfo | null;
  type?: string | null;
  grounding_metadata?: GroundingSource[] | null;
  poll?: RawPoll | null;
}

// How many messages to load per page. The initial load fetches the most recent
// page; older history is pulled in on demand instead of downloading + decrypting
// the entire room history up-front (PERF-4).
const MESSAGES_PAGE_SIZE = 50;

export const useChatMessages = (
  roomKey: string,
  pin: string,
  userUid: string | undefined,
  onNewMessage?: (msg: Message) => void,
  // Only fetch/subscribe once room membership is established (RLS gates reads
  // on membership, so fetching before the join RPC completes returns nothing).
  enabled: boolean = true
) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const onNewMessageRef = useRef(onNewMessage);
  useEffect(() => {
    onNewMessageRef.current = onNewMessage;
  }, [onNewMessage]);

  // Mirror of `messages` so the stable load-older / fetch-newer callbacks can
  // read the current oldest/latest row without stale closures.
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Poll question + option text are client-encrypted at rest (same AES as
  // message text); decrypt them here. Vote uid lists stay plaintext.
  const mapPoll = useCallback((raw: RawPoll | null | undefined): Poll | null => {
    if (!raw) return null;
    return {
      question: decryptMessage(raw.question || '', pin, roomKey),
      options: Array.isArray(raw.options)
        ? raw.options.map((o) => ({ id: o.id, text: decryptMessage(o.text || '', pin, roomKey) }))
        : [],
      votes: raw.votes || {},
      multi: !!raw.multi,
      closed: !!raw.closed,
    };
  }, [pin, roomKey]);

  const mapRow = useCallback((d: MessageRow): Message => ({
    id: d.id,
    text: decryptMessage(d.text || '', pin, roomKey),
    uid: d.uid,
    username: d.username,
    avatarURL: d.avatar_url || '',
    createdAt: d.created_at,
    attachment: d.attachment || undefined,
    location: d.location || undefined,
    isEdited: d.is_edited ?? false,
    reactions: d.reactions || {},
    replyTo: d.reply_to ?? null,
    type: (d.type || 'text') as Message['type'],
    groundingMetadata: d.grounding_metadata || [],
    poll: mapPoll(d.poll),
  }), [pin, roomKey, mapPoll]);

  // Initial load: the most recent page only (newest-first from the DB, reversed
  // to chronological order for display).
  const fetchInitial = useCallback(async () => {
    if (!roomKey || !enabled) return;

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('room_key', roomKey)
      .order('created_at', { ascending: false })
      .limit(MESSAGES_PAGE_SIZE);

    if (error) {
      console.error("Fetch error:", error);
      return;
    }
    if (data) {
      setMessages(data.map(mapRow).reverse());
      setHasMoreOlder(data.length === MESSAGES_PAGE_SIZE);
    }
  }, [roomKey, enabled, mapRow]);

  // Pull the previous page of older messages and prepend them (the UI calls this
  // from the "Load earlier" button).
  const loadOlderMessages = useCallback(async () => {
    if (!roomKey || !enabled || isLoadingOlder) return;
    const oldest = messagesRef.current[0]?.createdAt;
    if (!oldest) return;

    setIsLoadingOlder(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_key', roomKey)
        .lt('created_at', oldest)
        .order('created_at', { ascending: false })
        .limit(MESSAGES_PAGE_SIZE);

      if (error) {
        console.error("Load older failed", error);
        return;
      }
      if (data) {
        const older = data.map(mapRow).reverse();
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const fresh = older.filter((m) => !seen.has(m.id));
          return fresh.length ? [...fresh, ...prev] : prev;
        });
        setHasMoreOlder(data.length === MESSAGES_PAGE_SIZE);
      }
    } finally {
      setIsLoadingOlder(false);
    }
  }, [roomKey, enabled, isLoadingOlder, mapRow]);

  // On tab refocus, recover only messages newer than what we already have —
  // realtime can miss inserts while the socket is asleep, and this is far
  // cheaper than the old full refetch of the whole history (PERF-4).
  const fetchNewer = useCallback(async () => {
    if (!roomKey || !enabled) return;
    const latest = messagesRef.current[messagesRef.current.length - 1]?.createdAt;
    if (!latest) {
      fetchInitial();
      return;
    }
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('room_key', roomKey)
      .gt('created_at', latest)
      .order('created_at', { ascending: true });

    if (error) {
      console.error("Fetch newer failed", error);
      return;
    }
    if (data && data.length) {
      const newer = data.map(mapRow);
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const fresh = newer.filter((m) => !seen.has(m.id));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    }
  }, [roomKey, enabled, mapRow, fetchInitial]);

  useEffect(() => {
    if (!roomKey || !enabled) return;

    let didInitialFetch = false;
    const runInitialFetch = () => {
      if (didInitialFetch) return;
      didInitialFetch = true;
      fetchInitial();
    };

    // Subscribe BEFORE loading history and only fetch once the channel is live,
    // so a message inserted in the gap between the initial read and the live
    // subscription can't slip through (BUG-9). Dedup in the INSERT/fetch handlers
    // absorbs the overlap. A timeout fallback still loads history if realtime is
    // slow or unavailable, so the room is never left stuck empty.
    const channel = supabase
      .channel(`messages:${roomKey}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `room_key=eq.${roomKey}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newMsg = mapRow(payload.new as MessageRow);

            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });

            if (onNewMessageRef.current) {
                onNewMessageRef.current(newMsg);
            }

          } else if (payload.eventType === 'UPDATE') {
            const d = payload.new;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === d.id
                  ? {
                      ...m,
                      text: decryptMessage(d.text || '', pin, roomKey),
                      reactions: d.reactions || {},
                      // Only flag as edited when the DB row says so — a
                      // reaction-only UPDATE must not mark a message "(edited)".
                      isEdited: d.is_edited ?? m.isEdited,
                      // Poll votes / closed-state changes propagate live.
                      poll: d.poll ? mapPoll(d.poll) : m.poll,
                    }
                  : m
              )
            );
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old.id;
            if (deletedId) {
              setMessages((prev) => prev.filter((m) => m.id !== deletedId));
            }
          }
        }
      )
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        // First connect: load the initial page. On a later reconnect: only pull
        // what we missed, so already-loaded older history isn't reset.
        if (!didInitialFetch) runInitialFetch();
        else fetchNewer();
      });

    const fallbackTimer = setTimeout(runInitialFetch, 2500);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchNewer();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', fetchNewer);

    return () => {
      clearTimeout(fallbackTimer);
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', fetchNewer);
    };
  }, [roomKey, pin, enabled, mapRow, mapPoll, fetchInitial, fetchNewer]);

  const sendMessage = useCallback(
    async (
      text: string,
      config: { username: string; avatarURL: string },
      attachment: Attachment | null = null,
      replyTo: Message | null = null,
      location: { lat: number; lng: number } | null = null,
      type: 'text' | 'system' = 'text'
    ) => {
      if (!userUid || !roomKey) return;
      
      if(attachment) setIsUploading(true);

      try {
        const encryptedText = encryptMessage(text, pin, roomKey);

        const { error } = await supabase.from('messages').insert({
          room_key: roomKey,
          uid: userUid,
          username: config.username,
          avatar_url: config.avatarURL,
          text: encryptedText,
          type: type,
          attachment: attachment,
          reactions: {},
          location: location,
          reply_to: replyTo
            ? {
                id: replyTo.id,
                username: replyTo.username,
                text: replyTo.text || 'Attachment',
                isAttachment: !!replyTo.attachment,
              }
            : null,
        });

        if (error) throw error;

      } catch (e) {
        console.error('Send message failed', e);
        throw e;
      } finally {
        if(attachment) setIsUploading(false);
      }
    },
    [roomKey, pin, userUid]
  );

  // Create a poll as a dedicated message (type='poll'). Question + option text
  // are encrypted just like a normal message before being written.
  const createPoll = useCallback(
    async (
      question: string,
      options: string[],
      multi: boolean,
      config: { username: string; avatarURL: string }
    ) => {
      if (!userUid || !roomKey) return;
      const cleanOptions = options.map((t) => t.trim()).filter(Boolean);
      if (!question.trim() || cleanOptions.length < 2) {
        throw new Error('A poll needs a question and at least two options.');
      }
      const encOptions = cleanOptions.map((t, i) => ({
        id: `o${i}_${Math.random().toString(36).slice(2, 8)}`,
        text: encryptMessage(t, pin, roomKey),
      }));
      const poll = {
        question: encryptMessage(question.trim(), pin, roomKey),
        options: encOptions,
        votes: {},
        multi: !!multi,
        closed: false,
      };
      const { error } = await supabase.from('messages').insert({
        room_key: roomKey,
        uid: userUid,
        username: config.username,
        avatar_url: config.avatarURL,
        text: '',
        type: 'poll',
        poll,
        reactions: {},
      });
      if (error) throw error;
    },
    [roomKey, pin, userUid]
  );

  // Toggle the current user's vote on a poll option. Optimistic; the server
  // merge is atomic via the vote_poll RPC (no last-write-wins clobber).
  const votePoll = useCallback(
    async (msg: Message, optionId: string) => {
      if (!userUid || !msg.poll || msg.poll.closed) return;
      const original = msg.poll;
      const votes: { [k: string]: string[] } = {};
      for (const [k, v] of Object.entries(original.votes || {})) votes[k] = [...v];
      const current = votes[optionId] || [];

      if (current.includes(userUid)) {
        votes[optionId] = current.filter((u) => u !== userUid);
      } else {
        if (!original.multi) {
          for (const k of Object.keys(votes)) votes[k] = votes[k].filter((u) => u !== userUid);
        }
        votes[optionId] = [...(votes[optionId] || []), userUid];
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, poll: { ...original, votes } } : m))
      );

      const { error } = await supabase.rpc('vote_poll', {
        p_message_id: msg.id,
        p_option_id: optionId,
      });
      if (error) {
        console.error('Vote failed', error);
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, poll: original } : m))
        );
      }
    },
    [userUid]
  );

  // Close (or reopen) a poll — author or room owner only (enforced server-side).
  const setPollClosed = useCallback(async (msgId: string, closed: boolean) => {
    const { error } = await supabase.rpc('set_poll_closed', {
      p_message_id: msgId,
      p_closed: closed,
    });
    if (error) {
      console.error('Close poll failed', error);
      throw error;
    }
  }, []);

  const editMessage = useCallback(async (msgId: string, newText: string) => {
    const encryptedText = encryptMessage(newText, pin, roomKey);
    const { error } = await supabase
      .from('messages')
      .update({
        text: encryptedText,
        is_edited: true,
      })
      .eq('id', msgId);
    // Rethrow so the caller can restore the edit input instead of losing it.
    if (error) {
      console.error('Edit failed', error);
      throw error;
    }
  }, [pin, roomKey]);

  const deleteMessage = useCallback(async (msgId: string) => {
    // Optimistically remove, then roll back if the server rejects it — otherwise
    // the message silently vanishes from this client while still living in the DB
    // (BUG-2).
    const removed = messagesRef.current.find((m) => m.id === msgId);
    setMessages((prev) => prev.filter((m) => m.id !== msgId));

    const { error } = await supabase.from('messages').delete().eq('id', msgId);
    if (error) {
      console.error('Delete failed', error);
      if (removed) {
        setMessages((prev) =>
          prev.some((m) => m.id === msgId)
            ? prev
            : [...prev, removed].sort(
                (a, b) =>
                  new Date(a.createdAt as any).getTime() -
                  new Date(b.createdAt as any).getTime()
              )
        );
      }
    }
  }, []);

  const reactToMessage = useCallback(
    async (msg: Message, emoji: string) => {
      if (!userUid) return;
      const currentReactions = msg.reactions || {};
      const userList = currentReactions[emoji] || [];
      let newList: string[];

      if (userList.includes(userUid)) {
        newList = userList.filter((u) => u !== userUid);
      } else {
        newList = [...userList, userUid];
      }

      const updatedReactions = { ...currentReactions, [emoji]: newList };
      if (newList.length === 0) {
        delete updatedReactions[emoji];
      }
      // Optimistic update; server merge is atomic via the RPC.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id ? { ...m, reactions: updatedReactions } : m
        )
      );

      // toggle_reaction is a SECURITY DEFINER RPC: it merges reactions
      // atomically (no last-write-wins clobber) and is the only way to update
      // another member's message row under the strict UPDATE policy.
      const { error } = await supabase.rpc('toggle_reaction', {
        p_message_id: msg.id,
        p_emoji: emoji,
      });
      if (error) {
        console.error('Reaction failed', error);
        // Roll back optimistic update on failure.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id ? { ...m, reactions: currentReactions } : m
          )
        );
      }
    },
    [userUid]
  );

  const uploadFile = async (file: File): Promise<Attachment | null> => {
    if (!userUid) return null;
    setIsUploading(true);
    try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `${roomKey}/${fileName}`;
    
        const { error } = await supabase.storage
          .from('attachments')
          .upload(filePath, file);
    
        if (error) throw error;
    
        const { data: { publicUrl } } = supabase.storage
          .from('attachments')
          .getPublicUrl(filePath);
    
        return {
          url: publicUrl,
          name: file.name,
          type: file.type,
          size: file.size,
        };
    } catch (e) {
        console.error("Upload error", e);
        throw e;
    } finally {
        setIsUploading(false);
    }
  };

  return {
    messages,
    isUploading,
    hasMoreOlder,
    isLoadingOlder,
    loadOlderMessages,
    sendMessage,
    editMessage,
    deleteMessage,
    reactToMessage,
    uploadFile,
    createPoll,
    votePoll,
    setPollClosed,
    refreshMessages: fetchInitial
  };
};
