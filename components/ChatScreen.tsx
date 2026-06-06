
import React, { useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { supabase, joinOrCreateRoom } from '../services/supabase';
import { ChatConfig, Message, User, Subscriber, Presence } from '../types';
import MessageList from './MessageList';
// WebRTC call logic is the heaviest component in the app (~43KB); load it
// lazily so entering a room paints the message list first.
const CallManager = lazy(() => import('./CallManager'));
import { initAudio, playBeep, decryptMessage } from '../utils/helpers';
import { subscribeToPushNotifications, unsubscribeFromPushNotifications } from '../utils/pushService';
import ChatHeader from './ChatHeader';
import ChatInput from './ChatInput';
import { DeleteChatModal, EmailAlertModal } from './ChatModals';
import AiAvatarModal from './AiAvatarModal';
import UserProfileModal from './UserProfileModal';
import RoomAppearanceModal from './RoomAppearanceModal';
import EphemeralModal, { formatTtl } from './EphemeralModal';
import PollComposerModal from './PollComposerModal';
import MediaGalleryModal from './MediaGalleryModal';
import { getRoomBackgroundStyle } from '../utils/roomBackgrounds';
import { WifiOff, Trash2, Home, RefreshCcw, Search, X, ChevronDown, Pin } from 'lucide-react';

// Hooks
import { useChatMessages } from '../hooks/useChatMessages';
import { useRoomPresence } from '../hooks/useRoomPresence';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useIncoAI } from '../hooks/useIncoAI';

const INCO_BOT_UUID = '00000000-0000-0000-0000-000000000000';

interface ChatScreenProps {
  config: ChatConfig;
  onExit: () => void;
}

// -- Custom Room Deleted Toast (Persistent) --
const RoomDeletedToast: React.FC<{ onExit: () => void, onRecreate: () => void }> = ({ onExit, onRecreate }) => {
    return createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-500">
            <div className="relative bg-slate-900/90 dark:bg-slate-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl p-8 max-w-sm w-full text-center overflow-hidden ring-1 ring-white/10">
                
                <div className="flex flex-col items-center gap-6">
                    <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.3)] ring-1 ring-red-500/50">
                         <Trash2 size={40} className="text-red-500" />
                    </div>
                    
                    <div className="space-y-3">
                        <h2 className="text-2xl font-bold text-white tracking-tight">The room was deleted</h2>
                        <p className="text-slate-300 text-sm font-medium leading-relaxed">
                            This room no longer exists. You can recreate it now or return to home.
                        </p>
                    </div>

                    <div className="flex flex-col gap-3 w-full">
                        <button 
                            onClick={onRecreate}
                            className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-900/20 transition-all transform active:scale-95 flex items-center justify-center gap-2"
                        >
                            <RefreshCcw size={18} />
                            Recreate Room
                        </button>

                        <button 
                            onClick={onExit}
                            className="w-full py-3.5 px-6 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-all transform active:scale-95 flex items-center justify-center gap-2"
                        >
                            <Home size={18} />
                            Return to Home
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

const ChatScreen: React.FC<ChatScreenProps> = ({ config, onExit }) => {
  const [user, setUser] = useState<User | null>(null);
  const [inputText, setInputText] = useState('');
  
  // UI States
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showAiAvatarModal, setShowAiAvatarModal] = useState(false);
  const [selectedUserPresence, setSelectedUserPresence] = useState<Presence | null>(null);
  const [selectedUserSubscriber, setSelectedUserSubscriber] = useState<Subscriber | null>(null);
  
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showParticipantsList, setShowParticipantsList] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  
  // Room Status
  const [roomDeleted, setRoomDeleted] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  
  // Room & Creator State
  const [isRoomReady, setIsRoomReady] = useState(false);
  const [roomCreatorId, setRoomCreatorId] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiAvatarUrl, setAiAvatarUrl] = useState('');

  // Room appearance (icon + wallpaper), owner-editable, propagated via realtime.
  const [roomAvatarUrl, setRoomAvatarUrl] = useState('');
  const [bgType, setBgType] = useState('preset');
  const [bgPreset, setBgPreset] = useState('dots');
  const [bgUrl, setBgUrl] = useState('');
  const [showRoomAppearance, setShowRoomAppearance] = useState(false);

  // Disappearing messages: per-room TTL in seconds (null = off).
  const [messageTtl, setMessageTtl] = useState<number | null>(null);
  const [showEphemeral, setShowEphemeral] = useState(false);

  // Pinned message (owner-set), poll composer, and media gallery.
  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(null);
  const [pinnedFallbackText, setPinnedFallbackText] = useState('');
  const [showPollComposer, setShowPollComposer] = useState(false);
  const [showGallery, setShowGallery] = useState(false);

  // Theme State - Default to Dark Mode
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') !== 'light';
  });

  // Edit & Reply State
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);

  // Notification, Sound & Vibration State
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [canVibrate, setCanVibrate] = useState(false);

  // Email Alert State
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  
  // File & Location handling state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const isFirstLoad = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null);
  const atBottomRef = useRef(true);

  // Scroll-to-bottom affordance + in-room search.
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // --- CUSTOM HOOKS INTEGRATION ---
  
  const handleNewMessageReceived = useCallback(async (msg: Message) => {
    if (msg.uid !== user?.uid && msg.type !== 'system') {
        if (soundEnabled) {
            initAudio();
            setTimeout(() => playBeep(), 10);
        }
        
        if (vibrationEnabled && canVibrate && 'vibrate' in navigator) {
            navigator.vibrate(200);
        }

        if (document.hidden && notificationsEnabled) {
            new Notification(`New message from ${msg.username}`, {
                body: msg.text || 'Sent an attachment',
                icon: 'https://konskall.github.io/incognitochat/favicon-96x96.png'
            });
        }
    }
  }, [user, soundEnabled, vibrationEnabled, notificationsEnabled, canVibrate]);

  const {
    messages,
    isUploading,
    hasMoreOlder,
    loadOlderMessages,
    sendMessage,
    editMessage,
    deleteMessage,
    reactToMessage,
    uploadFile,
    createPoll,
    votePoll,
    setPollClosed
  } = useChatMessages(config.roomKey, config.pin, user?.uid, handleNewMessageReceived, isRoomReady && !roomDeleted);

  const { participants, typingUsers, setTyping, setLastRead } = useRoomPresence(config.roomKey, user, config);

  // Kept in a ref so handleUserClick can stay referentially stable (presence
  // updates frequently; a fresh callback each time would defeat MessageList's memo).
  const participantsRef = useRef(participants);
  useEffect(() => { participantsRef.current = participants; }, [participants]);

  const handleRecordingComplete = async (blob: Blob, mimeType: string) => {
      try {
           const ext = mimeType.includes('mp4') || mimeType.includes('aac') ? 'mp4' : 'webm';
           const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mimeType });
           const attachment = await uploadFile(file);
           if (attachment) {
               await sendMessage("", config, attachment, null, null, 'text');
               notifySubscribers('message', 'Sent a voice message');
           }
      } catch (e) {
          console.error("Failed to upload voice", e);
      }
  };

  const {
      isRecording,
      recordingDuration,
      startRecording,
      stopRecording,
      cancelRecording
  } = useAudioRecorder(handleRecordingComplete);

  const isBotResponding = useIncoAI(config.roomKey, config.pin, messages, config, aiEnabled, aiAvatarUrl);

  const combinedTypingUsers = isBotResponding ? [...typingUsers, 'inco'] : typingUsers;

  // --- SIDE EFFECTS ---

  useEffect(() => {
    const root = document.documentElement;
    const darkColor = '#020617'; 
    const lightColor = '#f8fafc';
    const themeColor = isDarkMode ? darkColor : lightColor;

    if (isDarkMode) {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
    
    let meta = document.querySelector("meta[name='theme-color']");
    if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
    }
    meta.setAttribute('content', themeColor);
  }, [isDarkMode]);

  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    localStorage.setItem('theme', newTheme ? 'dark' : 'light');
    setShowSettingsMenu(false);
  };

  // Email notifications run SERVER-SIDE (Edge Function `notify-room`): it
  // verifies room membership, reads subscribers with the service role, applies
  // the cooldown, and sends via EmailJS. No subscriber emails or EmailJS keys
  // ever touch the client. Requires the EMAILJS_PRIVATE_KEY secret to be set
  // (otherwise the function returns 503 and this is a silent no-op).
  const notifySubscribers = async (action: 'message' | 'deleted' | 'joined', details: string) => {
      if (!config.roomKey || !user) return;
      if (action === 'joined') return;

      // Only skip notifying members who are ACTIVELY in the room right now;
      // backgrounded/idle members stay in `participants` but should still get a
      // push/email since they aren't looking at the chat.
      const excludeUids = participants.filter(p => p.status === 'active').map(p => p.uid);
      const pushTitle = action === 'deleted'
          ? `Room "${config.roomName}" was deleted`
          : `New message in ${config.roomName}`;

      // Email (notify-room) + Web Push (send-push) both run server-side; fire in
      // parallel, non-blocking. Each is a silent no-op if its secret isn't set.
      await Promise.allSettled([
          supabase.functions.invoke('notify-room', {
              body: {
                  roomKey: config.roomKey,
                  roomName: config.roomName,
                  senderName: config.username,
                  body: details,
                  action,
                  excludeUids,
                  link: window.location.href,
              },
          }),
          supabase.functions.invoke('send-push', {
              body: {
                  roomKey: config.roomKey,
                  roomName: config.roomName,
                  title: pushTitle,
                  body: action === 'deleted' ? details : `${config.username}: ${details}`,
                  url: window.location.href,
                  excludeUids,
              },
          }),
      ]);
  };

  useEffect(() => {
    const checkUser = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
             setUser({ 
                 uid: session.user.id, 
                 isAnonymous: session.user.is_anonymous ?? true,
                 email: session.user.email 
             });
        } else {
             const { data: anonData } = await supabase.auth.signInAnonymously();
             if (anonData.user) {
                 setUser({ uid: anonData.user.id, isAnonymous: true });
             }
        }
    };
    checkUser();

    const handleNetworkChange = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', handleNetworkChange);
    window.addEventListener('offline', handleNetworkChange);
    if ('Notification' in window && Notification.permission === 'granted') setNotificationsEnabled(true);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) setCanVibrate(true);

    return () => {
      window.removeEventListener('online', handleNetworkChange);
      window.removeEventListener('offline', handleNetworkChange);
    };
  }, []);

  const checkRoomStatus = useCallback(async () => {
    if (!config.roomKey) return;
    const { data, error } = await supabase
        .from('rooms')
        .select('room_key')
        .eq('room_key', config.roomKey)
        .maybeSingle();

    // Only treat as deleted when the row is CONFIRMED absent (no error).
    // A transient network/RLS error must not kick the user out of the room.
    if (!error && !data) {
        setRoomDeleted(true);
    }
  }, [config.roomKey]);

  const initRoom = useCallback(async () => {
    if (!user || !config.roomKey) return;
    try {
      // Joining (or creating) a room goes through the server-side RPC, which
      // verifies the PIN and registers membership. This is the only way to gain
      // access under the membership-gated RLS. Don't silently recreate a room we
      // already joined this session (so deletion is surfaced, not masked).
      const alreadyJoined = !!sessionStorage.getItem(`joined_${config.roomKey}`);

      const { data: room, error } = await joinOrCreateRoom({
        roomKey: config.roomKey,
        roomName: config.roomName,
        pin: config.pin,
        username: config.username,
        createIfMissing: !alreadyJoined,
      });

      if (error) {
        if (error.code === 'ROOM_DELETED') {
          setRoomDeleted(true);
        } else if (error.code === 'WRONG_PIN') {
          setAccessError('Wrong PIN for this room. Check the PIN and try again.');
        } else {
          setAccessError('Could not join the room. Please try again.');
        }
        return;
      }

      if (room) {
        setRoomCreatorId(room.created_by);
        setAiEnabled(!!room.ai_enabled);
        setAiAvatarUrl(room.ai_avatar_url || '');
        setRoomAvatarUrl(room.avatar_url || '');
        setBgType(room.background_type || 'preset');
        setBgPreset(room.background_preset || 'dots');
        setBgUrl(room.background_url || '');
        setMessageTtl(room.message_ttl_seconds ?? null);
        setPinnedMessageId(room.pinned_message_id ?? null);
        setIsRoomReady(true);
        setRoomDeleted(false);
        setAccessError(null);
        if (room.is_new) {
          await sendMessage(`Room created by ${config.username}`, config, null, null, null, 'system');
        }
      }
    } catch (e) {
      console.error("Error initializing room:", e);
      setAccessError('Could not join the room. Please try again.');
    }
  }, [user, config, sendMessage]);

  useEffect(() => {
    initRoom();

    const handleVisibility = () => {
        if (document.visibilityState === 'visible') {
            checkRoomStatus();
        }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', checkRoomStatus);

    return () => {
        document.removeEventListener('visibilitychange', handleVisibility);
        window.removeEventListener('focus', checkRoomStatus);
    };
  }, [user, config.roomKey, config.roomName, config.pin, checkRoomStatus, initRoom]);

  const handleRecreate = () => {
      // Clear the session flag so initRoom knows this is an intentional new creation
      sessionStorage.removeItem(`joined_${config.roomKey}`);
      // Re-run initialization
      initRoom();
  };

  useEffect(() => {
      if (isRoomReady && user && config.roomKey && !roomDeleted) {
          const checkSubscription = async () => {
              const { data } = await supabase
                .from('subscribers')
                .select('email')
                .eq('room_key', config.roomKey)
                .eq('uid', user.uid)
                .maybeSingle();

              if (data && data.email) {
                  setEmailAlertsEnabled(true);
                  setEmailAddress(data.email);
              } else if (user.email) {
                  setEmailAddress(user.email);
              }
          };
          checkSubscription();
      }
  }, [isRoomReady, user, config.roomKey, roomDeleted]);

  useEffect(() => {
      // Mark this room as joined for the session (used by initRoom to avoid
      // silently recreating a deleted room). We intentionally no longer post a
      // "joined the room" system message — they spammed the chat.
      if (isRoomReady && user && config.roomKey && !roomDeleted) {
          const sessionKey = `joined_${config.roomKey}`;
          if (!sessionStorage.getItem(sessionKey)) {
              sessionStorage.setItem(sessionKey, 'true');
          }
      }
  }, [isRoomReady, user, config.roomKey, roomDeleted]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
    setShowScrollDown(false);
    setNewMessageCount(0);
  }, []);

  // Track whether the user is parked at the bottom; mark messages as read when so.
  const handleMainScroll = useCallback(() => {
    const el = mainRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = atBottom;
    if (atBottom) {
        setShowScrollDown(false);
        setNewMessageCount(0);
        const last = messages[messages.length - 1];
        if (last) setLastRead(last.createdAt);
    }
  }, [messages, setLastRead]);

  useEffect(() => {
    if (!messagesEndRef.current || messages.length === 0) return;
    const last = messages[messages.length - 1];
    const isMine = last.uid === user?.uid;
    if (isFirstLoad.current) {
        messagesEndRef.current.scrollIntoView({ behavior: "auto" });
        isFirstLoad.current = false;
        setLastRead(last.createdAt);
    } else if (last.id !== lastMessageIdRef.current) {
        // New message at the bottom. Follow it only if it's mine or the user is
        // already parked at the bottom; otherwise surface the "new messages"
        // button instead of yanking them down. (Prepended history doesn't change
        // the last id, so "Load earlier" never triggers this.)
        if (isMine || atBottomRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
            setLastRead(last.createdAt);
        } else {
            setShowScrollDown(true);
            setNewMessageCount((c) => c + 1);
        }
    }
    lastMessageIdRef.current = last.id;
  }, [messages, user?.uid, setLastRead]);

  // "Seen" receipt: the id of my latest message that another online member has read.
  const seenMessageId = useMemo(() => {
    if (!user) return null;
    let myLast: Message | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].uid === user.uid && messages[i].type !== 'system') { myLast = messages[i]; break; }
    }
    if (!myLast) return null;
    const seen = participants.some((p) => p.uid !== user.uid && p.lastReadAt && new Date(p.lastReadAt) >= new Date(myLast!.createdAt));
    return seen ? myLast.id : null;
  }, [messages, participants, user]);

  const isOwner = user?.uid === roomCreatorId;

  // --- Pinned message ---
  const pinnedMessage = useMemo(
    () => messages.find((m) => m.id === pinnedMessageId) || null,
    [messages, pinnedMessageId]
  );

  // If the pinned message is older than the loaded page, fetch a small preview
  // for the banner (decrypting its text/poll question client-side).
  useEffect(() => {
    if (!pinnedMessageId || pinnedMessage) { setPinnedFallbackText(''); return; }
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('messages')
        .select('text, attachment, poll')
        .eq('id', pinnedMessageId)
        .maybeSingle();
      if (!active || !data) return;
      let preview = '';
      if (data.poll) preview = decryptMessage((data.poll as any).question || '', config.pin, config.roomKey) || 'Poll';
      else if (data.text) preview = decryptMessage(data.text, config.pin, config.roomKey);
      else if (data.attachment) preview = '📎 ' + ((data.attachment as any).name || 'Attachment');
      setPinnedFallbackText(preview);
    })();
    return () => { active = false; };
  }, [pinnedMessageId, pinnedMessage, config.pin, config.roomKey]);

  const pinnedPreviewText = pinnedMessage
    ? (pinnedMessage.poll
        ? (pinnedMessage.poll.question || 'Poll')
        : (pinnedMessage.text || (pinnedMessage.attachment ? '📎 ' + pinnedMessage.attachment.name : 'Message')))
    : pinnedFallbackText;

  const scrollToPinned = useCallback(() => {
    if (!pinnedMessageId) return;
    const el = document.getElementById(`msg-${pinnedMessageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-blue-400', 'rounded-2xl');
      setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400', 'rounded-2xl'), 1600);
    }
  }, [pinnedMessageId]);

  const handlePinMessage = useCallback(async (msg: Message) => {
    if (user?.uid !== roomCreatorId || !config.roomKey) return;
    setPinnedMessageId(msg.id); // optimistic; RLS only lets the owner write this
    const { error } = await supabase.from('rooms').update({ pinned_message_id: msg.id }).eq('room_key', config.roomKey);
    if (error) console.error('Pin failed', error);
  }, [user, roomCreatorId, config.roomKey]);

  const handleUnpinMessage = useCallback(async () => {
    if (user?.uid !== roomCreatorId || !config.roomKey) return;
    setPinnedMessageId(null);
    const { error } = await supabase.from('rooms').update({ pinned_message_id: null }).eq('room_key', config.roomKey);
    if (error) console.error('Unpin failed', error);
  }, [user, roomCreatorId, config.roomKey]);

  // --- Polls ---
  const handleCreatePoll = useCallback(async (question: string, options: string[], multi: boolean) => {
    await createPoll(question, options, multi, config);
    notifySubscribers('message', 'Created a poll');
  }, [createPoll, config]);

  const handleToggleClosedPoll = useCallback((msg: Message, closed: boolean) => {
    setPollClosed(msg.id, closed).catch(() => {});
  }, [setPollClosed]);

  // All image/video attachments in the room, newest-first, for the media gallery.
  const galleryItems = useMemo(
    () => [...messages]
      .filter((m) => m.attachment && (m.attachment.type.startsWith('image/') || m.attachment.type.startsWith('video/')))
      .reverse()
      .map((m) => ({ url: m.attachment!.url, name: m.attachment!.name, type: m.attachment!.type })),
    [messages]
  );

  useEffect(() => {
    if (!config.roomKey || !isRoomReady || roomDeleted) return;
    const roomStatusChannel = supabase.channel(`room_status:${config.roomKey}`)
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'rooms',
        filter: `room_key=eq.${config.roomKey}`
      }, () => {
        setRoomDeleted(true);
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rooms',
        filter: `room_key=eq.${config.roomKey}`
      }, (payload) => {
        if (payload.new) {
            if (payload.new.ai_enabled !== undefined) setAiEnabled(payload.new.ai_enabled);
            if (payload.new.ai_avatar_url !== undefined) setAiAvatarUrl(payload.new.ai_avatar_url || '');
            // Room appearance changes propagate live to everyone in the room.
            if (payload.new.avatar_url !== undefined) setRoomAvatarUrl(payload.new.avatar_url || '');
            if (payload.new.background_type !== undefined) setBgType(payload.new.background_type || 'preset');
            if (payload.new.background_preset !== undefined) setBgPreset(payload.new.background_preset || 'dots');
            if (payload.new.background_url !== undefined) setBgUrl(payload.new.background_url || '');
            if (payload.new.message_ttl_seconds !== undefined) setMessageTtl(payload.new.message_ttl_seconds ?? null);
            if (payload.new.pinned_message_id !== undefined) setPinnedMessageId(payload.new.pinned_message_id ?? null);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(roomStatusChannel); };
  }, [config.roomKey, isRoomReady, roomDeleted]);

  const handleExitChat = async () => {
      // No "left the room" system message — it spammed the chat.
      sessionStorage.removeItem(`joined_${config.roomKey}`);
      onExit();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputText(e.target.value);
      setTyping(true);
  };

  const handleSend = async (e?: React.FormEvent) => {
      e?.preventDefault();
      if ((!inputText.trim() && !selectedFile) || !user || roomDeleted) return;

      // Snapshot what the user is sending so we can restore it if the send fails
      // — clearing the composer optimistically must not silently eat their
      // message/file/reply on error (BUG-2).
      const textToSend = inputText.trim();
      const fileToSend = selectedFile;
      const replyToSend = replyingTo;
      const editingId = editingMessageId;

      setInputText('');
      setTyping(false);
      setSelectedFile(null);
      setReplyingTo(null);

      try {
          if (editingId) {
              await editMessage(editingId, textToSend);
              setEditingMessageId(null);
          } else {
              let attachment = null;
              if (fileToSend) {
                  attachment = await uploadFile(fileToSend);
              }
              await sendMessage(textToSend, config, attachment, replyToSend, null, 'text');
              notifySubscribers('message', textToSend || 'Sent a file');
          }
      } catch (err) {
          console.error('Send failed', err);
          // Put the composer back the way it was so nothing is lost.
          setInputText(textToSend);
          setSelectedFile(fileToSend);
          setReplyingTo(replyToSend);
          if (editingId) setEditingMessageId(editingId);
      }
  };

  const handleSendLocation = async () => {
       if (!navigator.geolocation || !user || roomDeleted) return;
       setIsGettingLocation(true);
       navigator.geolocation.getCurrentPosition(async (pos) => {
           try {
               await sendMessage("📍 Shared a location", config, null, null, { lat: pos.coords.latitude, lng: pos.coords.longitude }, 'text');
               notifySubscribers('message', 'Shared a location');
           } catch(e) { console.error(e); }
           finally { setIsGettingLocation(false); }
       });
  };

  const handleEditMessage = useCallback((msg: Message) => {
      setInputText(msg.text);
      setEditingMessageId(msg.id);
      setReplyingTo(null);
      setSelectedFile(null);
  }, []);
  
  const handleReply = useCallback((msg: Message) => {
      setReplyingTo(msg);
      setEditingMessageId(null);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
      }
      if (e.key === 'Escape') {
          setEditingMessageId(null);
          setReplyingTo(null);
          setInputText('');
      }
  };

  const handleDeleteChat = async () => {
      if (!config.roomKey) return;
      setIsDeleting(true);
      try {
           await notifySubscribers('deleted', 'Room was deleted by host');
           
           const { data: files } = await supabase.storage.from('attachments').list(config.roomKey);
           if (files && files.length > 0) {
               const filesToRemove = files.map(x => `${config.roomKey}/${x.name}`);
               await supabase.storage.from('attachments').remove(filesToRemove);
           }
           
           await supabase.from('rooms').delete().eq('room_key', config.roomKey);
           onExit();
      } catch(e) {
          console.error("Delete failed", e);
          setIsDeleting(false);
      }
  };
  
  const toggleNotifications = async () => {
      if (notificationsEnabled) {
          setNotificationsEnabled(false);
          // Unregister this device's push subscription for the room.
          if (user) await unsubscribeFromPushNotifications(user.uid, config.roomKey);
      } else {
          const p = await Notification.requestPermission();
          if (p === 'granted') {
              setNotificationsEnabled(true);
              // Register a Web Push subscription so the user gets notified even
              // when the tab/app is closed (Edge Function `send-push` delivers).
              if (user) await subscribeToPushNotifications(user.uid, config.roomKey);
          }
      }
      setShowSettingsMenu(false);
  };

  const handleEmailToggle = async () => {
      if (!user || !config.roomKey) return;
      if (emailAlertsEnabled) {
          await supabase.from('subscribers')
            .update({ email: '' })
            .eq('room_key', config.roomKey)
            .eq('uid', user.uid);

          setEmailAlertsEnabled(false);
          setEmailAddress('');
          setShowEmailModal(false);
      } else {
          if (!emailAddress && user.email) {
              setEmailAddress(user.email);
          }
          setShowEmailModal(true);
      }
  };

  const saveEmailSubscription = async () => {
      if (!user || !config.roomKey || !emailAddress.includes('@')) {
          alert("Please enter a valid email.");
          return;
      }
      setIsSavingEmail(true);
      try {
          // The membership row already exists (created by join_or_create_room),
          // so we UPDATE it. Direct INSERT into subscribers is blocked by RLS.
          await supabase.from('subscribers')
            .update({
              username: config.username,
              email: emailAddress,
              last_notified_at: new Date().toISOString()
            })
            .eq('room_key', config.roomKey)
            .eq('uid', user.uid);

          setEmailAlertsEnabled(true);
          setShowEmailModal(false);
          setShowSettingsMenu(false);
      } catch (e: any) {
          console.error("Error saving email:", e);
          alert("Failed to subscribe.");
      } finally {
          setIsSavingEmail(false);
      }
  };

  const handleToggleAI = async () => {
    const isOwner = user?.uid === roomCreatorId;
    if (!isOwner || !config.roomKey) return;
    const newState = !aiEnabled;
    try {
      await supabase
        .from('rooms')
        .update({ ai_enabled: newState })
        .eq('room_key', config.roomKey);
      
      setAiEnabled(newState);
      await sendMessage(`Inco AI ${newState ? 'enabled' : 'disabled'} by ${config.username}`, config, null, null, null, 'system');
    } catch (e) {
      console.error("Failed to toggle AI", e);
    }
  };

  const handleUserClick = useCallback(async (uid: string, username: string, avatar: string) => {
      if (uid === INCO_BOT_UUID) return;

      const activeUser = participantsRef.current.find(p => p.uid === uid);

      const userToDisplay: Presence = activeUser || {
          uid,
          username,
          avatar,
          status: 'inactive',
          isTyping: false,
          onlineAt: ''
      };

      setSelectedUserPresence(userToDisplay);

      try {
          const { data } = await supabase
            .from('subscribers')
            .select('*')
            .eq('room_key', config.roomKey)
            .eq('uid', uid)
            .maybeSingle();

          if (data) {
              setSelectedUserSubscriber(data as Subscriber);
              if (!activeUser) {
                  setSelectedUserPresence(prev => prev ? ({...prev, onlineAt: data.last_notified_at || ''}) : null);
              }
          }
      } catch (e) {
          console.error("Failed to fetch user subscriber info", e);
      }
  }, [config.roomKey]);

  return (
    <div className="fixed inset-0 flex flex-col h-[100dvh] w-full bg-slate-100 dark:bg-slate-900 max-w-5xl mx-auto shadow-2xl overflow-hidden z-50 md:relative md:inset-auto md:rounded-2xl md:my-4 md:h-[95vh] md:border border-white/40 dark:border-slate-800 transition-colors">
      
      {roomDeleted && <RoomDeletedToast onExit={handleExitChat} onRecreate={handleRecreate} />}

      {accessError && createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-slate-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl p-8 max-w-sm w-full text-center ring-1 ring-white/10">
            <div className="flex flex-col items-center gap-6">
              <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center ring-1 ring-amber-500/50">
                <Trash2 size={40} className="text-amber-400" />
              </div>
              <div className="space-y-3">
                <h2 className="text-2xl font-bold text-white tracking-tight">Can't enter room</h2>
                <p className="text-slate-300 text-sm font-medium leading-relaxed">{accessError}</p>
              </div>
              <button
                onClick={onExit}
                className="w-full py-3.5 px-6 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-all transform active:scale-95 flex items-center justify-center gap-2"
              >
                <Home size={18} />
                Return to Home
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {isOffline && (
        <div className="absolute top-20 left-0 right-0 flex justify-center z-40 pointer-events-none animate-in slide-in-from-top-4 fade-in duration-300">
          <div className="flex items-center gap-2.5 px-4 py-2 bg-slate-900/90 dark:bg-white/90 backdrop-blur-md rounded-full shadow-2xl border border-white/10 dark:border-slate-200/20">
              <div className="bg-red-500/20 p-1.5 rounded-full">
                <WifiOff size={14} className="text-red-500 animate-pulse" />
              </div>
              <span className="text-xs font-bold text-white dark:text-slate-900">Offline</span>
          </div>
        </div>
      )}

      {user && isRoomReady && !roomDeleted && (
          <Suspense fallback={null}>
            <CallManager
              user={user}
              config={config}
              users={participants}
              showParticipants={showParticipantsList}
              onCloseParticipants={() => setShowParticipantsList(false)}
              roomCreatorId={roomCreatorId}
            />
          </Suspense>
      )}

      <ChatHeader
        config={config}
        participants={participants}
        isRoomReady={isRoomReady && !roomDeleted}
        showParticipantsList={showParticipantsList}
        setShowParticipantsList={setShowParticipantsList}
        showSettingsMenu={showSettingsMenu}
        setShowSettingsMenu={setShowSettingsMenu}
        canVibrate={canVibrate}
        vibrationEnabled={vibrationEnabled}
        setVibrationEnabled={setVibrationEnabled}
        soundEnabled={soundEnabled}
        setSoundEnabled={setSoundEnabled}
        notificationsEnabled={notificationsEnabled}
        toggleNotifications={toggleNotifications}
        emailAlertsEnabled={emailAlertsEnabled}
        setShowEmailModal={setShowEmailModal}
        isDarkMode={isDarkMode}
        toggleTheme={toggleTheme}
        setShowDeleteModal={setShowDeleteModal}
        onExit={handleExitChat}
        isOwner={user?.uid === roomCreatorId}
        isGoogleUser={user ? !user.isAnonymous : false}
        aiEnabled={aiEnabled}
        onToggleAI={handleToggleAI}
        onOpenAiAvatar={() => setShowAiAvatarModal(true)}
        onToggleSearch={() => { setShowSearch((s) => { const next = !s; if (!next) setSearchQuery(''); return next; }); }}
        onOpenGallery={() => setShowGallery(true)}
        roomAvatarUrl={roomAvatarUrl}
        onOpenRoomAppearance={() => setShowRoomAppearance(true)}
        messageTtlLabel={formatTtl(messageTtl)}
        onOpenEphemeral={() => setShowEphemeral(true)}
      />

      {showSearch && (
        <div className="px-3 py-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 z-20 animate-in slide-in-from-top-2 duration-200">
          <Search size={16} className="text-slate-400 shrink-0" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setSearchQuery(''); setShowSearch(false); } }}
            placeholder="Search messages in this room…"
            className="flex-1 bg-transparent outline-none text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
          />
          <button onClick={() => { setSearchQuery(''); setShowSearch(false); }} aria-label="Close search" className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <X size={16} />
          </button>
        </div>
      )}

      {pinnedMessageId && pinnedPreviewText && !roomDeleted && (
        <div className="flex items-stretch bg-blue-50/90 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-900/40 z-10 animate-in slide-in-from-top-1 duration-200">
          <button onClick={scrollToPinned} className="flex items-center gap-2.5 px-4 py-2 text-left flex-1 min-w-0 hover:bg-blue-100/70 dark:hover:bg-blue-900/30 transition">
            <Pin size={15} className="text-blue-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-blue-500 leading-none mb-0.5">Pinned message</p>
              <p className="text-xs text-slate-600 dark:text-slate-300 truncate">{pinnedPreviewText}</p>
            </div>
          </button>
          {isOwner && (
            <button onClick={handleUnpinMessage} aria-label="Unpin message" className="px-3 text-slate-400 hover:text-red-500 hover:bg-blue-100/70 dark:hover:bg-blue-900/30 transition">
              <X size={16} />
            </button>
          )}
        </div>
      )}

      <main
        ref={mainRef}
        onScroll={handleMainScroll}
        className="relative flex-1 overflow-y-auto overscroll-contain p-4 pb-20 transition-colors"
        style={getRoomBackgroundStyle({ type: bgType, preset: bgPreset, url: bgUrl }, isDarkMode)}
      >
        <MessageList
            messages={messages}
            currentUserUid={user?.uid || ''}
            roomOwnerUid={roomCreatorId || undefined}
            onEdit={handleEditMessage}
            onDelete={deleteMessage}
            onReply={handleReply}
            onReact={reactToMessage}
            onUserClick={handleUserClick}
            hasMoreOlder={hasMoreOlder}
            onLoadEarlier={loadOlderMessages}
            searchQuery={showSearch ? searchQuery : ''}
            seenMessageId={seenMessageId}
            messageTtlSeconds={messageTtl}
            isOwner={isOwner}
            pinnedMessageId={pinnedMessageId}
            onPin={handlePinMessage}
            onUnpin={handleUnpinMessage}
            onVotePoll={votePoll}
            onToggleClosedPoll={handleToggleClosedPoll}
        />
        <div ref={messagesEndRef} />
      </main>

      {showScrollDown && !roomDeleted && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute bottom-24 right-4 z-30 flex items-center gap-1.5 pl-3 pr-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-xl shadow-blue-900/30 transition-all active:scale-95 animate-in fade-in slide-in-from-bottom-2"
          aria-label="Scroll to latest messages"
        >
          <ChevronDown size={18} />
          {newMessageCount > 0 && (
            <span className="text-xs font-bold">{newMessageCount} new</span>
          )}
        </button>
      )}

      {!roomDeleted && (
        <ChatInput
            inputText={inputText}
            setInputText={setInputText}
            handleSend={handleSend}
            handleInputChange={handleInputChange}
            handleKeyDown={handleKeyDown}
            isRecording={isRecording}
            recordingDuration={recordingDuration}
            startRecording={startRecording}
            stopRecording={stopRecording}
            cancelRecording={cancelRecording}
            selectedFile={selectedFile}
            setSelectedFile={setSelectedFile}
            isUploading={isUploading}
            isGettingLocation={isGettingLocation}
            handleSendLocation={handleSendLocation}
            editingMessageId={editingMessageId}
            cancelEdit={() => { setEditingMessageId(null); setInputText(''); }}
            replyingTo={replyingTo}
            cancelReply={() => setReplyingTo(null)}
            isOffline={isOffline}
            isRoomReady={isRoomReady}
            typingUsers={combinedTypingUsers}
            onOpenPoll={() => setShowPollComposer(true)}
        />
      )}

      <DeleteChatModal 
        show={showDeleteModal} 
        onCancel={() => setShowDeleteModal(false)} 
        onConfirm={handleDeleteChat} 
        isDeleting={isDeleting} 
      />

      <EmailAlertModal 
        show={showEmailModal} 
        onCancel={() => setShowEmailModal(false)} 
        onSave={saveEmailSubscription} 
        isSaving={isSavingEmail} 
        emailAlertsEnabled={emailAlertsEnabled} 
        onToggleOff={handleEmailToggle} 
        emailAddress={emailAddress} 
        setEmailAddress={setEmailAddress} 
      />

      <AiAvatarModal
        show={showAiAvatarModal}
        onClose={() => setShowAiAvatarModal(false)}
        currentAvatarUrl={aiAvatarUrl}
        roomKey={config.roomKey}
        onUpdate={(newUrl) => setAiAvatarUrl(newUrl)}
      />

      <RoomAppearanceModal
        show={showRoomAppearance}
        onClose={() => setShowRoomAppearance(false)}
        roomKey={config.roomKey}
        roomName={config.roomName}
        isDarkMode={isDarkMode}
        current={{ avatarUrl: roomAvatarUrl, bgType, bgPreset, bgUrl }}
        onUpdate={(next) => { setRoomAvatarUrl(next.avatarUrl); setBgType(next.bgType); setBgPreset(next.bgPreset); setBgUrl(next.bgUrl); }}
      />

      <EphemeralModal
        show={showEphemeral}
        onClose={() => setShowEphemeral(false)}
        roomKey={config.roomKey}
        currentTtl={messageTtl}
        onUpdate={(ttl) => {
          setMessageTtl(ttl);
          const label = formatTtl(ttl);
          sendMessage(label ? `Disappearing messages set to ${label} by ${config.username}` : `Disappearing messages turned off by ${config.username}`, config, null, null, null, 'system');
        }}
      />

      <PollComposerModal
        show={showPollComposer}
        onClose={() => setShowPollComposer(false)}
        onCreate={handleCreatePoll}
      />

      <MediaGalleryModal
        show={showGallery}
        onClose={() => setShowGallery(false)}
        items={galleryItems}
      />

      {selectedUserPresence && (
          <UserProfileModal
            user={selectedUserPresence}
            subscriberInfo={selectedUserSubscriber}
            isRoomOwner={selectedUserPresence.uid === roomCreatorId}
            onClose={() => { setSelectedUserPresence(null); setSelectedUserSubscriber(null); }}
          />
      )}
    </div>
  );
};

export default ChatScreen;
