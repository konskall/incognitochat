
import React, { useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { supabase, joinOrCreateRoom } from '../services/supabase';
import { ChatConfig, Message, User, Subscriber, Presence } from '../types';
import MessageList from './MessageList';
// WebRTC call logic is the heaviest component in the app (~43KB); load it
// lazily so entering a room paints the message list first.
const CallManager = lazy(() => import('./CallManager'));
import { initAudio, playBeep, cleanUrl, beginThemeTransition } from '../utils/helpers';
import { decryptMessage } from '../utils/crypto';
import { subscribeToPushNotifications, unsubscribeFromPushNotifications } from '../utils/pushService';
import { setActiveRoom, onPushSubscriptionChanged } from '../utils/swBridge';
import ChatHeader from './ChatHeader';
import ChatInput from './ChatInput';
import { DeleteChatModal, EmailAlertModal } from './ChatModals';
import AiAvatarModal from './AiAvatarModal';
import UserProfileModal from './UserProfileModal';
import RoomAppearanceModal from './RoomAppearanceModal';
import EphemeralModal, { formatTtl } from './EphemeralModal';
import RoomExpiryModal from './RoomExpiryModal';
import MicErrorModal from './MicErrorModal';
import PollComposerModal from './PollComposerModal';
import MediaGalleryModal from './MediaGalleryModal';
import RoomInfoModal from './RoomInfoModal';
import MembersHistoryModal from './MembersHistoryModal';
import { flashToast } from './MessageActionMenu';
import { getRoomBackgroundStyle } from '../utils/roomBackgrounds';
import { expiryShortLabel } from '../utils/roomLifecycle';
import { parseTierError } from '../utils/tierGatingErrors';
import { WifiOff, Trash2, Home, RefreshCcw, Search, X, ChevronDown, Pin, Sparkles } from 'lucide-react';

// Hooks
import { useChatMessages } from '../hooks/useChatMessages';
import { useRoomPresence } from '../hooks/useRoomPresence';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useIncoAI } from '../hooks/useIncoAI';
import { useEntitlements } from '../hooks/useEntitlements';
import { useMessageQuota } from '../hooks/useMessageQuota';
import UpgradeModal from './UpgradeModal';

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

// -- Soft upgrade nudge --
// Shown once per room per day when a free user is halfway through the daily
// message allowance. Non-blocking (unlike UpgradeModal): a corner card that
// auto-dismisses and is tappable to open the upgrade sheet.
const QuotaNudgeToast: React.FC<{ left: number; onUpgrade: () => void; onClose: () => void }> = ({ left, onUpgrade, onClose }) => {
  useEffect(() => {
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-x-0 bottom-24 z-[150] flex justify-center px-4 pointer-events-none animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="pointer-events-auto w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-black/5 dark:ring-white/10 overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-fuchsia-500" />
        <div className="flex items-start gap-3 p-3.5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-500">
            <Sparkles size={18} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800 dark:text-white">{left} message{left === 1 ? '' : 's'} left today</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Upgrade for more messages, custom rooms &amp; more.</p>
            <div className="mt-2.5 flex items-center gap-2">
              <button onClick={onUpgrade} className="rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white shadow transition hover:opacity-90 active:scale-95">See plans</button>
              <button onClick={onClose} className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800">Not now</button>
            </div>
          </div>
          <button onClick={onClose} aria-label="Dismiss" className="-m-1 shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800"><X size={16} /></button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const ChatScreen: React.FC<ChatScreenProps> = ({ config, onExit }) => {
  const [user, setUser] = useState<User | null>(null);
  const [inputText, setInputText] = useState('');

  // --- Monetization plumbing (Phase 3) ---
  // Resolve this member's effective tier + entitlements (DB-authoritative mirror).
  const { tier, ent, loading: entLoading } = useEntitlements(user?.uid);

  // A shared upgrade prompt: child components call promptUpgrade(...) when a
  // gated feature is tapped; this opens the UpgradeModal.
  const [upgradePrompt, setUpgradePrompt] = useState<
    { featureLabel: string; requiredTier: 'basic' | 'ultra'; reason?: string } | null
  >(null);

  const promptUpgrade = useCallback(
    (featureLabel: string, requiredTier: 'basic' | 'ultra', reason?: string) =>
      setUpgradePrompt({ featureLabel, requiredTier, reason }),
    []
  );

  // Per-room daily message-quota counter (display-only; DB is authoritative).
  // `quotaBump` is incremented after each successful send to trigger a refetch.
  const [quotaBump, setQuotaBump] = useState(0);
  const quotaLeft = useMessageQuota(config.roomKey, tier, quotaBump);

  // Soft upgrade nudge: when a free user is halfway through the daily allowance
  // (<=5 left), show a one-per-room-per-day, non-blocking toast.
  // MUST wait for entitlements to resolve: during the load window `tier` defaults
  // to 'free', so a PAID user who has sent >=5 msgs would briefly compute
  // quotaLeft<=5 and get the nudge before their real tier lands. Gate on
  // !entLoading (same fix as the lock-flash) so only genuinely-free users see it.
  const [showQuotaNudge, setShowQuotaNudge] = useState(false);
  useEffect(() => {
    if (entLoading || tier !== 'free' || quotaLeft === null) return;
    if (quotaLeft > 5 || quotaLeft <= 0) return;
    const key = `quotaNudge_${config.roomKey}_${new Date().toISOString().slice(0, 10)}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    setShowQuotaNudge(true);
  }, [entLoading, tier, quotaLeft, config.roomKey]);

  // UI States
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showAiAvatarModal, setShowAiAvatarModal] = useState(false);
  const [selectedUserPresence, setSelectedUserPresence] = useState<Presence | null>(null);
  const [selectedUserSubscriber, setSelectedUserSubscriber] = useState<Subscriber | null>(null);
  
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showParticipantsList, setShowParticipantsList] = useState(false);
  const [showMembers, setShowMembers] = useState(false); // join-history list
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
  // Preload a room's custom background image so the chat area shows the room's
  // gradient preset (not a gray blank) until the image is decoded, then swaps to
  // it. onerror leaves the gradient up rather than a broken/gray image.
  const [bgReady, setBgReady] = useState(false);
  useEffect(() => {
    if (bgType !== 'image' || !bgUrl) { setBgReady(false); return; }
    setBgReady(false);
    const img = new Image();
    img.onload = () => setBgReady(true);
    img.src = bgUrl;
    return () => { img.onload = null; };
  }, [bgType, bgUrl]);
  const [showRoomAppearance, setShowRoomAppearance] = useState(false);

  // Disappearing messages: per-room TTL in seconds (null = off).
  const [messageTtl, setMessageTtl] = useState<number | null>(null);
  const [showEphemeral, setShowEphemeral] = useState(false);
  // Auto-delete room: the whole room self-destructs after this much inactivity.
  const [roomExpiry, setRoomExpiry] = useState<number | null>(null);
  const [showRoomExpiry, setShowRoomExpiry] = useState(false);
  // Free rooms auto-delete at this ISO timestamp (24h from creation; null =
  // permanent). Surfaced as a countdown in Room info so free users are warned.
  const [roomExpiresAt, setRoomExpiresAt] = useState<string | null>(null);

  // Drives the live countdown pills — the free-tier 24h expiry (expires_at) AND
  // the inactivity auto-delete (auto_delete_seconds). Only ticks while at least
  // one timer is active, so there's no always-on timer otherwise.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!roomExpiresAt && !roomExpiry) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, [roomExpiresAt, roomExpiry]);

  // Pinned message (owner-set), poll composer, and media gallery.
  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(null);
  const [pinnedFallbackText, setPinnedFallbackText] = useState('');
  const [showPollComposer, setShowPollComposer] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showRoomInfo, setShowRoomInfo] = useState(false);

  // Theme State - Default to Dark Mode
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') !== 'light';
  });

  // Edit & Reply State
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);

  // Notification, Sound & Vibration State
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  // Persist audio/haptic prefs (theme persists separately) so they survive a
  // reload instead of silently resetting to defaults every session.
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('soundEnabled') !== 'false');
  const [vibrationEnabled, setVibrationEnabled] = useState(() => localStorage.getItem('vibrationEnabled') !== 'false');
  const [canVibrate, setCanVibrate] = useState(false);

  // Email Alert State
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  
  // File & Location handling state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const isFirstLoad = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null);
  const atBottomRef = useRef(true);
  // The shared room-status channel, kept in a ref so the owner can broadcast a
  // "room deleted" event on it right before deleting the room (see handleDeleteChat).
  const roomStatusChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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

        // No OS notification here on purpose. OS notifications are now delivered
        // solely by the Web Push service worker (`public/sw.js`), which fires
        // whether the app is backgrounded or fully closed AND suppresses itself
        // when a window is visible. Showing one here too would (a) double up with
        // the push when the tab is alive-but-hidden, and (b) pop a notification
        // while the user is actively looking at the chat. In-app sound/vibration
        // above is enough of a cue while the page is open.
    }
  }, [user, soundEnabled, vibrationEnabled, canVibrate]);

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

  const { participants, typingUsers, readReceipts, setTyping, setLastRead } = useRoomPresence(config.roomKey, user, config);

  // Keep the dashboard's per-room "unread" baseline honest. While this room is
  // open we record the newest message's SERVER timestamp as the last-read marker
  // (the dashboard compares this against max(created_at) per room). Previously
  // lastRead was only set to the client-side entry time and never updated, so
  // (a) your own messages, (b) messages you read in-room, and (c) client/server
  // clock skew all made the room show a phantom "New messages" dot after you
  // entered, looked around and left. Using the latest message's server time —
  // not Date.now() — fixes all three.
  useEffect(() => {
    if (!config.roomKey || messages.length === 0) return;
    let maxTs = 0;
    for (const m of messages) {
      const t = new Date(m.createdAt as unknown as string).getTime();
      if (!Number.isNaN(t) && t > maxTs) maxTs = t;
    }
    if (maxTs <= 0) return;
    // Only mark read while the tab is actually VISIBLE. A backgrounded tab keeps
    // receiving realtime INSERTs; stamping those as read would wrongly clear the
    // dashboard's unread badge for messages the user never saw. If messages
    // arrived while hidden, the listener writes the latest once the user returns
    // (they are now looking at the room).
    const write = () => {
      if (document.visibilityState === 'visible') {
        localStorage.setItem(`lastRead_${config.roomKey}`, String(maxTs));
      }
    };
    write();
    document.addEventListener('visibilitychange', write);
    return () => document.removeEventListener('visibilitychange', write);
  }, [messages, config.roomKey]);

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
          // A voice note is a message insert too — map quota/lock errors to the
          // upgrade funnel instead of a misleading "try again" toast (CG-2).
          const tierErr = parseTierError(e, tier);
          if (tierErr?.code === 'QT002') {
              promptUpgrade('A higher message limit', tierErr.requiredTier, "You've hit today's limit for this room.");
          } else if (tierErr) {
              flashToast(tierErr.message);
          } else {
              flashToast('Voice message could not be sent. Please try again.');
          }
      }
  };

  const {
      isRecording,
      recordingDuration,
      startRecording,
      stopRecording,
      cancelRecording,
      micError,
      dismissMicError
  } = useAudioRecorder(handleRecordingComplete);

  const isBotResponding = useIncoAI(config.roomKey, config.pin, messages, config, aiEnabled, aiAvatarUrl, user?.uid);

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
    beginThemeTransition();
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    localStorage.setItem('theme', newTheme ? 'dark' : 'light');
    setShowSettingsMenu(false);
  };

  // Persist audio/haptic preferences whenever they change.
  useEffect(() => { localStorage.setItem('soundEnabled', String(soundEnabled)); }, [soundEnabled]);
  useEffect(() => { localStorage.setItem('vibrationEnabled', String(vibrationEnabled)); }, [vibrationEnabled]);

  // Unlock the Web Audio context on the first user gesture inside the chat. iOS
  // keeps the AudioContext suspended until a gesture creates/resumes it, and the
  // realtime new-message handler is NOT a gesture — without this the beep would
  // silently never play on iOS.
  useEffect(() => {
    const unlock = () => initAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Email notifications run SERVER-SIDE (Edge Function `notify-room`): it
  // verifies room membership, reads subscribers with the service role, applies
  // the cooldown, and sends via EmailJS. No subscriber emails or EmailJS keys
  // ever touch the client. Requires the EMAILJS_PRIVATE_KEY secret to be set
  // (otherwise the function returns 503 and this is a silent no-op).
  const notifySubscribers = async (action: 'message' | 'deleted' | 'joined', details: string) => {
      if (!config.roomKey || !user) return;
      if (action === 'joined') return;

      // Emails only: skip members who are ACTIVELY in the room right now (no SW
      // can dismiss an email, and presence is good enough for the 30-min digest).
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
                  // Deliberately DO NOT send the message text in the email: it
                  // would land in EmailJS (a third party) + recipient inboxes in
                  // plaintext, while it's encrypted at rest. The email shows only
                  // sender + room ("New message from X"). The Web Push below still
                  // carries the preview — that goes to the user's OWN device, not
                  // a third party.
                  body: '',
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
                  // Deliberately NO presence-based excludeUids for push (the
                  // server still excludes the sender). Presence lags: a member
                  // who just closed/backgrounded the app can still read as
                  // 'active' and would be wrongly skipped — a push silently
                  // lost. Instead the push is ALWAYS sent, and the receiver's
                  // own tab dismisses it only when it is visible AND viewing
                  // this room right now (sw.js INCO_PUSH_SHOWN -> swBridge),
                  // which is the receiver's REAL state, not a stale broadcast.
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
    // NOTE: notificationsEnabled is NOT derived from Notification.permission here
    // — that flagged the toggle ON even when no push subscription existed in the
    // DB. The dedicated effect below re-creates the subscription on every room
    // open and sets the toggle from whether that actually succeeded.
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) setCanVibrate(true);

    return () => {
      window.removeEventListener('online', handleNetworkChange);
      window.removeEventListener('offline', handleNetworkChange);
    };
  }, []);

  // Keep THIS device's push subscription alive for THIS room. Previously the
  // subscription was created at most once (on the first manual toggle) and the
  // toggle's ON state was inferred from Notification.permission alone — so the
  // row in `push_subscriptions` was never refreshed. Browsers rotate push
  // subscriptions, and our anonymous auth users churn (push_subscriptions.user_id
  // → auth.users ON DELETE CASCADE), so the row silently vanished and was never
  // recreated → send-push had 0 targets → no notifications on a closed mobile
  // PWA, on any platform. Re-subscribe whenever we open a room with permission
  // already granted, and reflect the REAL result in the toggle.
  useEffect(() => {
    if (!user?.uid || !config.roomKey) return;
    // Wait until the room actually exists (join_or_create_room completed). The
    // push_subscriptions.room_key FK requires the room row, so subscribing before
    // the join created it threw a 23503 FK violation.
    if (!isRoomReady || roomDeleted) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    let cancelled = false;
    const resubscribe = () => {
      subscribeToPushNotifications(user.uid, config.roomKey)
        .then((ok) => { if (!cancelled) setNotificationsEnabled(ok); })
        .catch(() => { if (!cancelled) setNotificationsEnabled(false); });
    };
    resubscribe();
    // Re-persist when the browser rotates the push endpoint mid-session: the SW
    // re-subscribes and fires INCO_PUSHSUBSCRIPTION_CHANGED so the new endpoint
    // reaches the DB without waiting for the next room re-open.
    onPushSubscriptionChanged(resubscribe);
    return () => { cancelled = true; onPushSubscriptionChanged(null); };
  }, [user?.uid, config.roomKey, isRoomReady, roomDeleted]);

  // Tell the push service worker which room this tab is showing, so it can keep
  // a push silent ONLY when you're already looking at that room — a push for a
  // DIFFERENT room still notifies you while the app is open. Cleared on unmount
  // (back to the dashboard) so dashboard-open users get notified for any room.
  useEffect(() => {
    setActiveRoom(config.roomKey);
    return () => setActiveRoom(null);
  }, [config.roomKey]);

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
      // Durable (localStorage, not sessionStorage): "have I been in this room
      // before?" must survive a tab close, or reopening a tab on an expired room
      // re-creates it silently (createIfMissing). Consistent with the logout
      // sweep + dashboard dismiss, which already target localStorage joined_ keys.
      const alreadyJoined = !!localStorage.getItem(`joined_${config.roomKey}`);

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
        // Drop the stored room+PIN on an access failure so a refresh doesn't
        // re-route straight back into the failing room (the wrong PIN would
        // otherwise loop). Username is kept so the login form stays prefilled.
        if (error.code !== 'ROOM_DELETED') {
          localStorage.removeItem('chatPin');
          localStorage.removeItem('chatRoomName');
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
        setRoomExpiry(room.auto_delete_seconds ?? null);
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
      // Clear the durable flag so initRoom knows this is an intentional new creation
      localStorage.removeItem(`joined_${config.roomKey}`);
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
      // Mark this room as joined durably (localStorage, used by initRoom to avoid
      // silently recreating a deleted/expired room after a tab close). We
      // intentionally no longer post a "joined the room" system message — they
      // spammed the chat.
      if (isRoomReady && user && config.roomKey && !roomDeleted) {
          const joinedKey = `joined_${config.roomKey}`;
          if (!localStorage.getItem(joinedKey)) {
              localStorage.setItem(joinedKey, 'true');
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
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 80;
    atBottomRef.current = atBottom;
    if (atBottom) {
        setShowScrollDown(false);
        setNewMessageCount(0);
        const last = messages[messages.length - 1];
        if (last) setLastRead(last.createdAt);
    } else {
        // Surface the jump-to-bottom button whenever the user has scrolled up a
        // screenful, even with no new message (classic chat behaviour). The
        // new-message effect keeps the unread count badge in sync.
        setShowScrollDown(distanceFromBottom > 240);
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
            // Only advance the read receipt for a PEER's message when the tab is
            // actually visible. A backgrounded recipient parked at the bottom
            // would otherwise auto-broadcast "read up to" a message it never saw
            // → a false "Seen" on the sender's side. Always advance for your OWN
            // message (you've necessarily seen what you just sent).
            if (isMine || document.visibilityState === 'visible') setLastRead(last.createdAt);
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
    // Read receipts now arrive via broadcast (readReceipts: uid -> server
    // lastReadAt) instead of presence meta, which didn't propagate. Both
    // timestamps are server message times, so the >= comparison is skew-free.
    let seen = false;
    for (const [uid, lastReadAt] of readReceipts) {
      if (uid !== user.uid && new Date(lastReadAt) >= new Date(myLast.createdAt)) { seen = true; break; }
    }
    return seen ? myLast.id : null;
  }, [messages, readReceipts, user]);

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
    try {
      await createPoll(question, options, multi, config);
      setQuotaBump((n) => n + 1);
      notifySubscribers('message', 'Created a poll');
    } catch (err) {
      // A poll is a message insert, so it hits the same quota/lock triggers as a
      // text send — route QT001/QT002 through the upgrade funnel instead of letting
      // PollComposerModal surface a raw "QUOTA_EXCEEDED:free" string (CG-1).
      const tierErr = parseTierError(err, tier);
      if (tierErr) {
        if (tierErr.code === 'QT002') {
          promptUpgrade('A higher message limit', tierErr.requiredTier, "You've hit today's limit for this room.");
        } else {
          flashToast(tierErr.message); // QT001 read-only room
        }
        return; // handled — let the poll modal close cleanly
      }
      throw err; // non-tier failure -> PollComposerModal shows it
    }
  }, [createPoll, config, tier, promptUpgrade]);

  const handleToggleClosedPoll = useCallback((msg: Message, closed: boolean) => {
    setPollClosed(msg.id, closed).catch(() => {});
  }, [setPollClosed]);

  // Room "Media, links & files" content, all newest-first.
  // Media = image/video attachments (grid + lightbox).
  // These three derivations are O(n) over the whole loaded history; only build
  // them while the gallery modal is actually open (it almost never is), instead
  // of on every realtime message/reaction event.
  const galleryMedia = useMemo(
    () => !showGallery ? [] : [...messages]
      .filter((m) => m.attachment && (m.attachment.type.startsWith('image/') || m.attachment.type.startsWith('video/')))
      .reverse()
      .map((m) => ({ url: m.attachment!.url, name: m.attachment!.name, type: m.attachment!.type })),
    [messages, showGallery]
  );
  // Files = every other attachment (documents, archives, voice notes…).
  const galleryFiles = useMemo(
    () => !showGallery ? [] : [...messages]
      .filter((m) => m.attachment && !m.attachment.type.startsWith('image/') && !m.attachment.type.startsWith('video/'))
      .reverse()
      .map((m) => ({ url: m.attachment!.url, name: m.attachment!.name, type: m.attachment!.type, size: m.attachment!.size })),
    [messages, showGallery]
  );
  // Links = every http(s) URL found in (decrypted) message text.
  const galleryLinks = useMemo(() => {
    if (!showGallery) return [];
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const out: { url: string; username: string; createdAt: any }[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.type === 'system' || !m.text) continue;
      const found = m.text.match(urlRegex);
      if (found) found.forEach((u) => out.push({ url: cleanUrl(u), username: m.username, createdAt: m.createdAt }));
    }
    return out;
  }, [messages, showGallery]);

  useEffect(() => {
    if (!config.roomKey || !isRoomReady || roomDeleted) return;
    const roomStatusChannel = supabase.channel(`room_status:${config.roomKey}`)
      // Primary deletion signal: the owner broadcasts this the moment they delete
      // the room. Realtime postgres_changes DELETE events are unreliable here —
      // `rooms` uses the default replica identity, so the old record omits
      // `room_key`, the `room_key=eq.…` filter can never match, and RLS can't
      // re-check membership after the cascade. A broadcast reaches every member.
      .on('broadcast', { event: 'room_deleted' }, () => {
        setRoomDeleted(true);
      })
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
            if (payload.new.auto_delete_seconds !== undefined) setRoomExpiry(payload.new.auto_delete_seconds ?? null);
            if (payload.new.expires_at !== undefined) setRoomExpiresAt(payload.new.expires_at ?? null);
            if (payload.new.pinned_message_id !== undefined) setPinnedMessageId(payload.new.pinned_message_id ?? null);
        }
      })
      .subscribe();
    roomStatusChannelRef.current = roomStatusChannel;
    return () => { roomStatusChannelRef.current = null; supabase.removeChannel(roomStatusChannel); };
  }, [config.roomKey, isRoomReady, roomDeleted]);

  // The free-tier 24h auto-delete timestamp isn't in the join RPC payload; read
  // it directly once the room is ready (members can SELECT room columns under
  // RLS). Realtime keeps it fresh via the room_status handler above.
  useEffect(() => {
    if (!isRoomReady || !config.roomKey) return;
    let alive = true;
    supabase.from('rooms').select('expires_at').eq('room_key', config.roomKey).maybeSingle()
      .then(({ data }) => { if (alive) setRoomExpiresAt((data as { expires_at?: string | null } | null)?.expires_at ?? null); });
    return () => { alive = false; };
  }, [isRoomReady, config.roomKey]);

  const handleExitChat = async () => {
      // No "left the room" system message — it spammed the chat.
      // Do NOT clear the durable `joined_` flag here: exiting the chat view does
      // not drop room membership, and forgetting it would let an expired room
      // silently re-create on the next auto-route re-entry (the bug we fixed).
      onExit();
  };

  // Owner-only: wipe the room's membership history. The RPC deletes ALL
  // subscriber rows (incl. the owner's), so we immediately re-subscribe the
  // owner via the join RPC to keep their session's RLS access. Removed members
  // can rejoin with the PIN. Returns success so the modal can refresh.
  const handleClearMembers = useCallback(async (): Promise<boolean> => {
    if (!config.roomKey) return false;
    try {
      const { error } = await supabase.rpc('clear_room_members', { p_room_key: config.roomKey });
      if (error) throw error;
      await joinOrCreateRoom({
        roomKey: config.roomKey, roomName: config.roomName, pin: config.pin,
        username: config.username, createIfMissing: false,
      });
      return true;
    } catch (e) {
      console.error('clear_room_members failed', e);
      flashToast('Could not clear members. Please try again.');
      return false;
    }
  }, [config]);

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
              setQuotaBump((n) => n + 1);
              notifySubscribers('message', textToSend || 'Sent a file');
          }
      } catch (err) {
          console.error('Send failed', err);
          // Put the composer back the way it was so nothing is lost.
          setInputText(textToSend);
          setSelectedFile(fileToSend);
          setReplyingTo(replyToSend);
          if (editingId) setEditingMessageId(editingId);
          const tierErr = parseTierError(err, tier);
          if (tierErr) {
            if (tierErr.code === 'QT004') {
              promptUpgrade('Inco AI', tierErr.requiredTier);
            } else if (tierErr.code === 'QT002') {
              // Daily quota is a hard paywall moment -> offer an actionable upgrade.
              promptUpgrade('A higher message limit', tierErr.requiredTier, "You've hit today's limit for this room.");
            } else {
              // QT001 (room read-only) can't be cleared by an instant upgrade -> just inform.
              flashToast(tierErr.message);
            }
          }
      }
  };

  const handleSendLocation = async () => {
       if (!navigator.geolocation || !user || roomDeleted) return;
       setIsGettingLocation(true);
       navigator.geolocation.getCurrentPosition(
           async (pos) => {
               try {
                   await sendMessage("📍 Shared a location", config, null, null, { lat: pos.coords.latitude, lng: pos.coords.longitude }, 'text');
                   notifySubscribers('message', 'Shared a location');
               } catch(e) {
                   console.error(e);
                   // Location is a message insert — surface quota/lock instead of failing silently (CG-2).
                   const tierErr = parseTierError(e, tier);
                   if (tierErr?.code === 'QT002') promptUpgrade('A higher message limit', tierErr.requiredTier, "You've hit today's limit for this room.");
                   else if (tierErr) flashToast(tierErr.message);
                   else flashToast('Could not share your location. Please try again.');
               }
               finally { setIsGettingLocation(false); }
           },
           // Without an error callback the success path never fires on
           // deny/timeout, so isGettingLocation would stay true forever and
           // permanently disable the Location action. Always reset + tell the user.
           (err) => {
               console.warn('Geolocation failed', err);
               setIsGettingLocation(false);
               flashToast(err.code === err.PERMISSION_DENIED
                   ? 'Location permission denied.'
                   : 'Could not get your location.');
           },
           { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
       );
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
           // Fire the "deleted" notification BEFORE the row delete: the delete
           // cascades our own subscriber row, after which the edge functions'
           // is_member check would 403 and no one would be told.
           await notifySubscribers('deleted', 'Room was deleted by host');

           // Paginate storage cleanup — list() defaults to 100 per call, so a
           // room with >100 attachments used to orphan everything past the first
           // page (publicly reachable forever, no owning room).
           const PAGE = 100;
           let offset = 0;
           for (;;) {
               const { data: files } = await supabase.storage.from('attachments').list(config.roomKey, { limit: PAGE, offset });
               if (!files || files.length === 0) break;
               await supabase.storage.from('attachments').remove(files.map(x => `${config.roomKey}/${x.name}`));
               if (files.length < PAGE) break;
               offset += PAGE;
           }

           // Deleting the room cascades to its messages and subscribers (FK ON
           // DELETE CASCADE). Surface RLS/network failures instead of silently
           // "succeeding" — otherwise the room lingers and reappears on re-entry.
           const { error } = await supabase.from('rooms').delete().eq('room_key', config.roomKey);
           if (error) throw error;

           // Kick everyone still in the room (the postgres_changes DELETE event is
           // unreliable here — see the room_status channel comment).
           try {
               await roomStatusChannelRef.current?.send({ type: 'broadcast', event: 'room_deleted', payload: { deletedBy: config.username } });
           } catch { /* best-effort; the recipient also falls back to checkRoomStatus on focus */ }

           // Clear the durable "joined" flag: the owner just deleted the room, so
           // a later re-entry with the same name+PIN should create a fresh room
           // instead of being told the (now-gone) room was deleted.
           localStorage.removeItem(`joined_${config.roomKey}`);
           onExit();
      } catch(e) {
          console.error("Delete failed", e);
          alert('Could not delete the room. Please try again.');
          setIsDeleting(false);
      }
  };
  
  const toggleNotifications = async () => {
      setShowSettingsMenu(false);
      if (notificationsEnabled) {
          setNotificationsEnabled(false);
          // Unregister this device's push subscription for the room. If the
          // delete fails the device stays a live push target, so revert the
          // toggle and tell the user instead of silently claiming it's off.
          if (user) {
              const ok = await unsubscribeFromPushNotifications(user.uid, config.roomKey);
              if (!ok) {
                  setNotificationsEnabled(true);
                  flashToast('Could not turn off notifications. Please try again.');
              }
          }
          return;
      }
      // Web Push needs a service worker, the Push API, and the Notification API.
      // On iOS these exist ONLY inside the Home-Screen (standalone) app on iOS
      // 16.4+ — NOT in a normal Safari tab. The single most common reason this
      // "isn't supported" on an installed PWA is that the user opened the site in
      // Safari instead of launching it from the Home-Screen icon, so detect that
      // and give an actionable message instead of a generic "not supported".
      const isIOS = /iP(ad|hone|od)/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches
          || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

      if (!pushSupported) {
          if (isIOS && !isStandalone) {
              flashToast('On iPhone/iPad: open the app from your Home Screen, then turn on notifications.');
          } else if (isIOS) {
              flashToast('Notifications require iOS 16.4 or newer.');
          } else {
              flashToast('This browser does not support notifications.');
          }
          return;
      }

      try {
          const p = await Notification.requestPermission();
          if (p !== 'granted') {
              flashToast(p === 'denied'
                  ? 'Notifications are blocked — enable them in your device settings.'
                  : 'Notification permission was dismissed.');
              return;
          }
          // Only flip the toggle ON if the push subscription actually succeeds —
          // otherwise the UI would claim notifications are enabled while push
          // silently fails (network/DB error, or a stale subscription).
          const ok = user ? await subscribeToPushNotifications(user.uid, config.roomKey) : false;
          setNotificationsEnabled(ok);
          if (!ok) flashToast('Could not register for push on this device. Please try again.');
      } catch (e) {
          console.warn('Enable notifications failed', e);
          setNotificationsEnabled(false);
          flashToast('Could not enable notifications.');
      }
  };

  const handleEmailToggle = async () => {
      if (!user || !config.roomKey) return;
      if (emailAlertsEnabled) {
          // .update() never throws — check the error or the UI flips to "off"
          // while the row keeps the email and the user keeps getting alerts.
          const { error } = await supabase.from('subscribers')
            .update({ email: '' })
            .eq('room_key', config.roomKey)
            .eq('uid', user.uid);
          if (error) { flashToast('Could not turn off email alerts. Please try again.'); return; }

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
          // .update() resolves { error } instead of throwing, so check it — the
          // old try/catch was dead code and reported fake success on RLS failure.
          const { error } = await supabase.from('subscribers')
            .update({
              username: config.username,
              email: emailAddress,
              last_notified_at: new Date().toISOString()
            })
            .eq('room_key', config.roomKey)
            .eq('uid', user.uid);
          if (error) throw error;

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
    // Inco is open to any logged-in member of the room, not just the creator —
    // but it does require an account (anonymous guests can't toggle it).
    if (!user || user.isAnonymous || !config.roomKey) return;
    const newState = !aiEnabled;
    try {
      // .update() resolves { error }; without checking it the local toggle + the
      // "Inco AI enabled by X" system message would post even when the rooms
      // update failed, leaving every member's UI claiming a state the DB lacks.
      const { error } = await supabase
        .from('rooms')
        .update({ ai_enabled: newState })
        .eq('room_key', config.roomKey);
      if (error) throw error;

      setAiEnabled(newState);
      await sendMessage(`Inco AI ${newState ? 'enabled' : 'disabled'} by ${config.username}`, config, null, null, null, 'system');
    } catch (e) {
      console.error("Failed to toggle AI", e);
      const tierErr = parseTierError(e, tier);
      if (tierErr?.code === 'QT004') promptUpgrade('Inco AI', tierErr.requiredTier);
      else flashToast('Could not change Inco. Please try again.');
    }
  };

  // iOS Safari does not shrink a position:fixed / 100dvh layout when the soft
  // keyboard opens (it slides the whole fixed layer up), which pushes the
  // composer off-screen. Pin the shell to the visual viewport so the input stays
  // visible. Mobile only — the md+ layout is a centered relative card that must
  // keep its own sizing. (Android relies on interactive-widget=resizes-content.)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
    const apply = () => {
      const root = rootRef.current;
      if (!root) return;
      if (!isMobile()) {
        root.style.height = '';
        root.style.bottom = '';
        root.style.transform = '';
        return;
      }
      root.style.height = `${vv.height}px`;
      root.style.bottom = 'auto';
      root.style.transform = `translateY(${vv.offsetTop}px)`;
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      window.removeEventListener('orientationchange', apply);
      const root = rootRef.current;
      if (root) { root.style.height = ''; root.style.bottom = ''; root.style.transform = ''; }
    };
  }, []);

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
          // Fetch ONLY the join date the card needs. Never pull another member's
          // email or last_notified_at to the client (privacy leak), and never use
          // last_notified_at as "activity" — it's the last EMAIL time, not the
          // user's real last-seen, so offline users now read honestly as "Offline".
          const { data } = await supabase
            .from('subscribers')
            .select('created_at')
            .eq('room_key', config.roomKey)
            .eq('uid', uid)
            .maybeSingle();

          if (data) {
              setSelectedUserSubscriber(data as Subscriber);
          }
      } catch (e) {
          console.error("Failed to fetch user subscriber info", e);
      }
  }, [config.roomKey]);

  // Stable close handler so the modal's focus-trap effect doesn't re-run on
  // every ChatScreen re-render while the modal is open.
  const handleCloseUserModal = useCallback(() => {
      setSelectedUserPresence(null);
      setSelectedUserSubscriber(null);
  }, []);

  return (
    <div ref={rootRef} className="fixed inset-0 flex flex-col h-[100dvh] w-full bg-slate-100 dark:bg-slate-900 max-w-5xl mx-auto shadow-2xl overflow-hidden z-50 md:relative md:inset-auto md:rounded-2xl md:my-4 md:h-[95vh] md:border border-white/40 dark:border-slate-800 transition-colors">
      
      {roomDeleted && <RoomDeletedToast onExit={handleExitChat} onRecreate={handleRecreate} />}

      {showQuotaNudge && (
        <QuotaNudgeToast
          left={quotaLeft ?? 0}
          onUpgrade={() => { setShowQuotaNudge(false); promptUpgrade('Unlimited messaging', 'basic', "You're halfway through today's free messages in this room."); }}
          onClose={() => setShowQuotaNudge(false)}
        />
      )}

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
              ent={ent}
              entLoading={entLoading}
              onUpgrade={promptUpgrade}
            />
          </Suspense>
      )}

      <ChatHeader
        config={config}
        participants={participants}
        isRoomReady={isRoomReady && !roomDeleted}
        showSettingsMenu={showSettingsMenu}
        setShowSettingsMenu={setShowSettingsMenu}
        canVibrate={canVibrate}
        vibrationEnabled={vibrationEnabled}
        setVibrationEnabled={setVibrationEnabled}
        soundEnabled={soundEnabled}
        setSoundEnabled={setSoundEnabled}
        notificationsEnabled={notificationsEnabled}
        toggleNotifications={toggleNotifications}
        isDarkMode={isDarkMode}
        toggleTheme={toggleTheme}
        onExit={handleExitChat}
        roomAvatarUrl={roomAvatarUrl}
        messageTtlLabel={formatTtl(messageTtl)}
        roomFreeExpiryLabel={expiryShortLabel(roomExpiresAt, nowTick)}
        onOpenRoomInfo={() => setShowRoomInfo(true)}
        onOpenParticipants={() => setShowParticipantsList(true)}
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
        className="relative flex-1 overflow-y-auto overflow-x-clip overscroll-contain p-4 pb-20 transition-colors"
        style={getRoomBackgroundStyle({ type: bgType === 'image' && !bgReady ? 'preset' : bgType, preset: bgPreset, url: bgUrl }, isDarkMode)}
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
            maxFileBytes={ent.maxFileBytes}
            quotaLeft={quotaLeft}
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
        onUpgrade={promptUpgrade}
      />

      <RoomAppearanceModal
        show={showRoomAppearance}
        onClose={() => setShowRoomAppearance(false)}
        roomKey={config.roomKey}
        roomName={config.roomName}
        isDarkMode={isDarkMode}
        current={{ avatarUrl: roomAvatarUrl, bgType, bgPreset, bgUrl }}
        onUpdate={(next) => { setRoomAvatarUrl(next.avatarUrl); setBgType(next.bgType); setBgPreset(next.bgPreset); setBgUrl(next.bgUrl); }}
        onUpgrade={promptUpgrade}
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
        onUpgrade={promptUpgrade}
      />

      <RoomExpiryModal
        show={showRoomExpiry}
        onClose={() => setShowRoomExpiry(false)}
        roomKey={config.roomKey}
        currentSeconds={roomExpiry}
        onUpdate={(secs, expiresAt) => {
          setRoomExpiry(secs);
          setRoomExpiresAt(expiresAt);
          const label = formatTtl(secs);
          sendMessage(label ? `Auto-delete set to ${label} by ${config.username}` : `Auto-delete turned off by ${config.username}`, config, null, null, null, 'system');
        }}
        onUpgrade={promptUpgrade}
      />

      <MicErrorModal show={!!micError} message={micError || ''} onClose={dismissMicError} />

      <PollComposerModal
        show={showPollComposer}
        onClose={() => setShowPollComposer(false)}
        onCreate={handleCreatePoll}
      />

      <RoomInfoModal
        show={showRoomInfo}
        onClose={() => setShowRoomInfo(false)}
        config={config}
        participants={participants}
        roomAvatarUrl={roomAvatarUrl}
        isOwner={user?.uid === roomCreatorId}
        isGoogleUser={user ? !user.isAnonymous : false}
        aiEnabled={aiEnabled}
        messageTtlLabel={formatTtl(messageTtl)}
        roomExpiryLabel={formatTtl(roomExpiry)}
        roomExpiresAt={roomExpiresAt}
        emailAlertsEnabled={emailAlertsEnabled}
        onToggleSearch={() => { setShowSearch((s) => { const next = !s; if (!next) setSearchQuery(''); return next; }); }}
        onOpenGallery={() => setShowGallery(true)}
        onOpenParticipants={() => setShowParticipantsList(true)}
        onOpenMembers={() => setShowMembers(true)}
        onToggleAI={handleToggleAI}
        onOpenAiAvatar={() => setShowAiAvatarModal(true)}
        onOpenRoomAppearance={() => setShowRoomAppearance(true)}
        onOpenEphemeral={() => setShowEphemeral(true)}
        onOpenRoomExpiry={() => setShowRoomExpiry(true)}
        onOpenEmail={() => setShowEmailModal(true)}
        onDeleteRoom={() => setShowDeleteModal(true)}
        ent={ent}
        entLoading={entLoading}
        onUpgrade={promptUpgrade}
      />

      <MembersHistoryModal
        show={showMembers}
        onClose={() => setShowMembers(false)}
        roomKey={config.roomKey}
        onlineUids={participants.filter((p) => p.status === 'active').map((p) => p.uid)}
        selfUid={user?.uid}
        canClear={user?.uid === roomCreatorId}
        onClearMembers={handleClearMembers}
      />

      <MediaGalleryModal
        show={showGallery}
        onClose={() => setShowGallery(false)}
        media={galleryMedia}
        files={galleryFiles}
        links={galleryLinks}
      />

      <UpgradeModal
        open={!!upgradePrompt}
        onClose={() => setUpgradePrompt(null)}
        requiredTier={upgradePrompt?.requiredTier ?? 'basic'}
        currentTier={tier}
        featureLabel={upgradePrompt?.featureLabel ?? ''}
        reason={upgradePrompt?.reason}
      />

      {selectedUserPresence && (
          <UserProfileModal
            user={selectedUserPresence}
            subscriberInfo={selectedUserSubscriber}
            isRoomOwner={selectedUserPresence.uid === roomCreatorId}
            onClose={handleCloseUserModal}
          />
      )}
    </div>
  );
};

export default ChatScreen;
