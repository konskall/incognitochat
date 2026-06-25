
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/supabase';
import { Message, Attachment, Poll, ReplyInfo, GroundingSource } from '../types';
import { decryptMessage, encryptMessage } from '../utils/crypto';
import { makeTempId, buildTempMessage, reconcileTemp, markMessageStatus } from '../utils/optimisticSend';

// Result of a send/retry. The optimistic typed-text path NEVER throws and
// resolves with this; ChatScreen parses `error` with parseTierError (which
// needs `tier`, a ChatScreen concern — the hook stays tier-agnostic).
export type SendOutcome = { ok: true } | { ok: false; error: unknown };

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

  // Last-seen ciphertext per message id. A reaction/vote UPDATE re-delivers the
  // full row but never changes `text`, so this lets the UPDATE handler skip the
  // AES decrypt and reuse the already-decrypted plaintext.
  const cipherCacheRef = useRef<Map<string, string>>(new Map());
  // ciphertext (exact bytes sent) -> tempId, so the realtime echo of OUR OWN
  // message can be matched back to its temp bubble (random IV means we cannot
  // re-derive the ciphertext, so we record it at send time).
  const pendingSendsRef = useRef<Map<string, string>>(new Map());
  // Throttle the refocus resync: visibilitychange and window 'focus' fire
  // back-to-back on tab return, which used to issue two identical round-trips.
  const lastResyncRef = useRef(0);

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

  const mapRow = useCallback((d: MessageRow): Message => {
    cipherCacheRef.current.set(d.id, d.text || '');
    return {
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
    // The quoted excerpt is now encrypted at rest just like the message body.
    // Only decrypt strings in our IV:cipher format (32-hex IV + ':'); legacy
    // plaintext quotes already in the DB are passed through untouched, so they
    // aren't mangled by the legacy base64-decode fallback or shown as "🔒".
    replyTo: d.reply_to
      ? {
          ...d.reply_to,
          text: /^[0-9a-f]{32}:/i.test(d.reply_to.text || '')
            ? decryptMessage(d.reply_to.text, pin, roomKey)
            : (d.reply_to.text || ''),
        }
      : null,
    type: (d.type || 'text') as Message['type'],
    groundingMetadata: d.grounding_metadata || [],
    poll: mapPoll(d.poll),
    };
  }, [pin, roomKey, mapPoll]);

  // Initial load: the most recent page only (newest-first from the DB, reversed
  // to chronological order for display).
  const fetchInitial = useCallback(async () => {
    if (!roomKey || !enabled) return;

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('room_key', roomKey)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
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

  // Reconcile the messages we currently hold against the server. Realtime can
  // miss UPDATE/DELETE events while the socket sleeps (backgrounded mobile tab),
  // so fetchNewer (inserts only) is not enough: a message another member deleted
  // would linger on screen, and edits/reactions/poll votes would stay stale. We
  // re-read the held ids and drop the gone ones + refresh changed fields.
  const reconcileHeld = useCallback(async () => {
    if (!roomKey || !enabled) return;
    // Exclude not-yet-persisted optimistic messages: their temp ids are not
    // valid uuids, so including them makes .in('id', …) raise 22P02 and abort
    // the whole pass (a lingering 'failed' temp would break reconcile on every
    // refocus). They have no server row to reconcile against anyway.
    const ids = messagesRef.current.filter((m) => !m.status).map((m) => m.id);
    if (ids.length === 0) return;
    // Chunk the id list: a single .in('id', ids) with a few hundred 36-char UUIDs
    // can blow past PostgREST/proxy URL-length limits and fail silently, which
    // would stop reconciliation exactly on the heavily-scrolled rooms it exists
    // for. The room filter also lets Postgres use the room index. Abort the whole
    // pass on any chunk error so a partial fetch can't be misread as deletions.
    const CHUNK = 100;
    const byId = new Map<string, MessageRow>();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_key', roomKey)
        .in('id', slice);
      if (error || !data) {
        console.error('reconcileHeld failed', error);
        return;
      }
      for (const r of data as MessageRow[]) byId.set(r.id, r);
    }
    setMessages((prev) => {
      let changed = false;
      const next: Message[] = [];
      for (const m of prev) {
        if (m.status) { next.push(m); continue; } // keep in-flight/failed optimistic messages
        const row = byId.get(m.id);
        if (!row) { changed = true; continue; } // deleted while away — drop it
        // Only re-map (re-decrypt + re-allocate) when a tracked field actually
        // changed; otherwise reuse the existing object so MessageItem's React.memo
        // holds and the whole window isn't re-decrypted on every refocus. text is
        // compared via the ciphertext cache; reactions/poll-votes/closed/is_edited
        // are plaintext on both the row and the mapped message.
        const prevCipher = cipherCacheRef.current.get(m.id);
        const cipherSame = prevCipher !== undefined && prevCipher === (row.text || '');
        const editSame = (row.is_edited ?? false) === m.isEdited;
        const reactionsSame = JSON.stringify(row.reactions || {}) === JSON.stringify(m.reactions || {});
        const pollSame =
          (row.poll?.closed ?? false) === (m.poll?.closed ?? false) &&
          JSON.stringify(row.poll?.votes || null) === JSON.stringify(m.poll?.votes || null);
        if (cipherSame && editSame && reactionsSame && pollSame) {
          next.push(m);
        } else {
          next.push(mapRow(row));
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [roomKey, enabled, mapRow]);

  // Pull the previous page of older messages and prepend them (the UI calls this
  // from the "Load earlier" button).
  const loadOlderMessages = useCallback(async () => {
    if (!roomKey || !enabled || isLoadingOlder) return;
    const oldest = messagesRef.current.find((m) => !m.status)?.createdAt;
    if (!oldest) return;

    setIsLoadingOlder(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_key', roomKey)
        // lte (not lt) + id-dedup below: a strict lt permanently skips the
        // remaining rows of a group that shares `oldest`'s timestamp when the
        // page boundary cuts through it. The secondary id order keeps
        // equal-timestamp rows in a stable, repeatable sequence across pages.
        .lte('created_at', oldest)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
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
    // Persisted rows only — an optimistic temp at the tail carries a CLIENT
    // timestamp that could skip a concurrent peer message under clock skew.
    const persisted = messagesRef.current.filter((m) => !m.status);
    const latest = persisted[persisted.length - 1]?.createdAt;
    if (!latest) {
      // Full (re)load ONLY when nothing is held. If we hold only optimistic
      // temps (no persisted row yet — e.g. first message in a fresh room),
      // fetchInitial would REPLACE messages and wipe the temp (losing a
      // 'failed' bubble's Retry); skip — Path A/B will surface the real row.
      if (messagesRef.current.length === 0) fetchInitial();
      return;
    }
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      // gte (not gt): two rows can share the same created_at (a user msg + the
      // Inco reply, or same-ms inserts). A strict gt would permanently drop a
      // same-timestamp row whose INSERT was missed while the socket slept; the
      // id-dedup below removes the boundary row we already hold.
      .gte('created_at', latest)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      // Bound the catch-up burst: without a limit a long background gap could pull
      // (and synchronously AES-decrypt) hundreds of rows on resume, freezing the UI
      // + spiking egress. A FULL page back means a large gap → reset path below.
      .limit(MESSAGES_PAGE_SIZE);

    if (error) {
      console.error("Fetch newer failed", error);
      return;
    }
    if (!data || !data.length) return;

    // Large gap: too many missed to decrypt inline. Reset to the most-recent page
    // (like the initial load) but KEEP any in-flight optimistic temps so a 'failed'
    // bubble's Retry survives. "Load earlier" refills older history on demand.
    if (data.length === MESSAGES_PAGE_SIZE) {
      const { data: recent, error: rErr } = await supabase
        .from('messages')
        .select('*')
        .eq('room_key', roomKey)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(MESSAGES_PAGE_SIZE);
      if (rErr || !recent) return;
      const page = recent.map(mapRow).reverse();
      const pageIds = new Set(page.map((m) => m.id));
      setMessages((prev) => [...page, ...prev.filter((m) => m.status && !pageIds.has(m.id))]);
      setHasMoreOlder(recent.length === MESSAGES_PAGE_SIZE);
      return;
    }

    const newer = data.map(mapRow);
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const fresh = newer.filter((m) => !seen.has(m.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, [roomKey, enabled, mapRow, fetchInitial]);

  // Full refocus/reconnect recovery: pull missed inserts AND reconcile the held
  // window (deletes/edits/reactions/votes). Throttled so the visibilitychange +
  // focus pair doesn't double-fire.
  const resync = useCallback(() => {
    const now = Date.now();
    if (now - lastResyncRef.current < 1000) return;
    lastResyncRef.current = now;
    fetchNewer();
    reconcileHeld();
  }, [fetchNewer, reconcileHeld]);

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
            const raw = payload.new as MessageRow;
            // Path A: our own optimistic send echoing back. Replace its temp
            // bubble in place instead of appending a duplicate. Matched on the
            // exact ciphertext we recorded at send time (random IV ⇒ can't re-derive).
            if (raw.uid === userUid && pendingSendsRef.current.has(raw.text || '')) {
              const tempId = pendingSendsRef.current.get(raw.text || '')!;
              pendingSendsRef.current.delete(raw.text || '');
              const matchedReal = mapRow(raw);
              setMessages((prev) => reconcileTemp(prev, tempId, matchedReal));
              return;
            }
            const newMsg = mapRow(payload.new as MessageRow);

            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              // Insert at the correct chronological position (created_at, then id)
              // rather than always appending: two near-simultaneous inserts (a user
              // message + the Inco reply, or two senders at once) can arrive in a
              // commit order that doesn't match created_at, and a plain push would
              // render them — and any reply quote — out of order until a reload.
              const t = new Date(newMsg.createdAt).getTime();
              let i = prev.length;
              while (i > 0) {
                const p = prev[i - 1];
                const pt = new Date(p.createdAt).getTime();
                if (pt < t || (pt === t && p.id <= newMsg.id)) break;
                i--;
              }
              return i === prev.length ? [...prev, newMsg] : [...prev.slice(0, i), newMsg, ...prev.slice(i)];
            });

            if (onNewMessageRef.current) {
                onNewMessageRef.current(newMsg);
            }

          } else if (payload.eventType === 'UPDATE') {
            const d = payload.new;
            // Reaction/vote updates re-deliver the row with unchanged ciphertext;
            // only re-run AES decrypt when the ciphertext actually changed.
            const prevCipher = cipherCacheRef.current.get(d.id);
            const textUnchanged = prevCipher !== undefined && prevCipher === (d.text || '');
            cipherCacheRef.current.set(d.id, d.text || '');
            setMessages((prev) =>
              prev.map((m) =>
                m.id === d.id
                  ? {
                      ...m,
                      text: textUnchanged ? m.text : decryptMessage(d.text || '', pin, roomKey),
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
              cipherCacheRef.current.delete(deletedId);
              setMessages((prev) => prev.filter((m) => m.id !== deletedId));
            }
          }
        }
      )
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        // First connect: load the initial page. On a later reconnect: pull what
        // we missed AND reconcile the held window (deletes/edits happened while
        // the socket was down), so already-loaded older history isn't reset.
        if (!didInitialFetch) runInitialFetch();
        else resync();
      });

    const fallbackTimer = setTimeout(runInitialFetch, 2500);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') resync();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', resync);

    return () => {
      clearTimeout(fallbackTimer);
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', resync);
      // Per-room ciphertext cache: drop it on room switch so it can't grow
      // unbounded across rooms over a long-lived PWA session.
      cipherCacheRef.current.clear();
      pendingSendsRef.current.clear();
    };
  }, [roomKey, pin, enabled, userUid, mapRow, mapPoll, fetchInitial, fetchNewer, resync]);

  const sendMessage = useCallback(
    async (
      text: string,
      config: { username: string; avatarURL: string },
      attachment: Attachment | null = null,
      replyTo: Message | null = null,
      location: { lat: number; lng: number } | null = null,
      type: 'text' | 'system' = 'text'
    ): Promise<SendOutcome> => {
      if (!userUid || !roomKey) return { ok: false, error: new Error('Not ready') };

      // Optimistic only for a plain typed text message. Attachments (own upload
      // progress UI), location and system messages keep the original behavior.
      const optimistic = type === 'text' && !attachment && !location;

      if (!optimistic) {
        if (attachment) setIsUploading(true);
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
                  // Encrypt the quoted excerpt too — otherwise a verbatim plaintext
                  // copy of the replied-to message would persist in reply_to.text
                  // even though the original row's text column is encrypted.
                  text: encryptMessage(replyTo.text || 'Attachment', pin, roomKey),
                  isAttachment: !!replyTo.attachment,
                }
              : null,
          });
          if (error) throw error;
          return { ok: true };
        } catch (e) {
          console.error('Send message failed', e);
          throw e; // unchanged contract for attachment/location/system callers
        } finally {
          if (attachment) setIsUploading(false);
        }
      }

      // --- optimistic typed-text path (never throws) ---
      const encryptedText = encryptMessage(text, pin, roomKey);
      const tempId = makeTempId();
      const replyInfo = replyTo
        ? { id: replyTo.id, username: replyTo.username, text: replyTo.text || 'Attachment', isAttachment: !!replyTo.attachment }
        : null;
      const temp = buildTempMessage({
        tempId,
        text,
        uid: userUid,
        username: config.username,
        avatarURL: config.avatarURL,
        createdAt: new Date().toISOString(),
        replyTo: replyInfo,
      });
      pendingSendsRef.current.set(encryptedText, tempId);
      setMessages((prev) => [...prev, temp]);

      const { data, error } = await supabase
        .from('messages')
        .insert({
          room_key: roomKey,
          uid: userUid,
          username: config.username,
          avatar_url: config.avatarURL,
          text: encryptedText,
          type: 'text',
          attachment: null,
          reactions: {},
          location: null,
          reply_to: replyTo
            ? {
                id: replyTo.id,
                username: replyTo.username,
                text: encryptMessage(replyTo.text || 'Attachment', pin, roomKey),
                isAttachment: !!replyTo.attachment,
              }
            : null,
        })
        .select('id, created_at')
        .single();

      if (error || !data) {
        pendingSendsRef.current.delete(encryptedText);
        setMessages((prev) => markMessageStatus(prev, tempId, 'failed'));
        return { ok: false, error: error ?? new Error('Insert returned no row') };
      }

      // Path B: reconcile temp -> real (idempotent vs the echo path above).
      cipherCacheRef.current.set(data.id, encryptedText);
      const realMsg: Message = { ...temp, id: data.id, createdAt: data.created_at, status: undefined };
      pendingSendsRef.current.delete(encryptedText);
      setMessages((prev) => reconcileTemp(prev, tempId, realMsg));
      return { ok: true };
    },
    [roomKey, pin, userUid]
  );

  // Retry a failed typed-text message in place (reuses its tempId). Re-encrypts
  // (new IV ⇒ new ciphertext; refresh the pending map), flips status back to
  // 'sending', re-inserts, reconciles. Never throws; resolves with the outcome.
  const retryMessage = useCallback(
    async (tempId: string): Promise<SendOutcome> => {
      if (!userUid || !roomKey) return { ok: false, error: new Error('Not ready') };
      const msg = messagesRef.current.find((m) => m.id === tempId);
      if (!msg) return { ok: false, error: new Error('Message not found') };

      const encryptedText = encryptMessage(msg.text, pin, roomKey);
      // Drop any stale pending entry pointing at this temp, then record the new one.
      for (const [c, t] of pendingSendsRef.current) if (t === tempId) pendingSendsRef.current.delete(c);
      pendingSendsRef.current.set(encryptedText, tempId);
      setMessages((prev) => markMessageStatus(prev, tempId, 'sending'));

      const { data, error } = await supabase
        .from('messages')
        .insert({
          room_key: roomKey,
          uid: userUid,
          username: msg.username,
          avatar_url: msg.avatarURL,
          text: encryptedText,
          type: 'text',
          attachment: null,
          reactions: {},
          location: null,
          reply_to: msg.replyTo
            ? {
                id: msg.replyTo.id,
                username: msg.replyTo.username,
                text: encryptMessage(msg.replyTo.text || 'Attachment', pin, roomKey),
                isAttachment: !!msg.replyTo.isAttachment,
              }
            : null,
        })
        .select('id, created_at')
        .single();

      if (error || !data) {
        pendingSendsRef.current.delete(encryptedText);
        setMessages((prev) => markMessageStatus(prev, tempId, 'failed'));
        return { ok: false, error: error ?? new Error('Insert returned no row') };
      }

      cipherCacheRef.current.set(data.id, encryptedText);
      const realMsg: Message = { ...msg, id: data.id, createdAt: data.created_at, status: undefined };
      pendingSendsRef.current.delete(encryptedText);
      setMessages((prev) => reconcileTemp(prev, tempId, realMsg));
      return { ok: true };
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
        // Re-fetch the authoritative poll rather than restoring the pre-vote
        // snapshot — `original` is stale relative to other members' concurrent
        // votes that may already have arrived via realtime, and restoring it
        // would visibly drop their votes until the next UPDATE.
        const { data } = await supabase.from('messages').select('poll').eq('id', msg.id).maybeSingle();
        const fresh = data?.poll ? mapPoll(data.poll as RawPoll) : original;
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, poll: fresh } : m))
        );
      }
    },
    [userUid, mapPoll]
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
    // Optimistic local update (mirrors delete/react): the edited text renders
    // instantly and survives a missed realtime UPDATE echo on a foregrounded tab.
    // Prime cipherCacheRef with the new ciphertext so the eventual echo is treated
    // as text-unchanged (no redundant re-decrypt). Snapshot for rollback.
    const before = messagesRef.current.find((m) => m.id === msgId);
    const prevCipher = cipherCacheRef.current.get(msgId);
    cipherCacheRef.current.set(msgId, encryptedText);
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, text: newText, isEdited: true } : m))
    );
    const { error } = await supabase
      .from('messages')
      .update({
        text: encryptedText,
        is_edited: true,
      })
      .eq('id', msgId);
    // Roll back the optimistic edit (text + flag only, preserving any concurrent
    // reaction/vote changes) and rethrow so the caller can restore the input.
    if (error) {
      console.error('Edit failed', error);
      if (prevCipher !== undefined) cipherCacheRef.current.set(msgId, prevCipher);
      if (before) {
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, text: before.text, isEdited: before.isEdited } : m))
        );
      }
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
        // Re-read the authoritative reactions rather than restoring the pre-click
        // snapshot — a peer's concurrent reaction may already have arrived via
        // realtime during the await, and restoring `currentReactions` would visibly
        // drop it until the next UPDATE. Mirrors the votePoll failure path.
        const { data } = await supabase.from('messages').select('reactions').eq('id', msg.id).maybeSingle();
        const fresh = ((data?.reactions as { [emoji: string]: string[] } | null) ?? currentReactions) || {};
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id ? { ...m, reactions: fresh } : m
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
          // Filenames are random + immutable, so cache hard (1 year). Stops every
          // scroll-back / room re-open from re-downloading media against the
          // limited Storage egress, and speeds up repeat media render on mobile.
          .upload(filePath, file, { cacheControl: '31536000' });
    
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
    retryMessage,
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
