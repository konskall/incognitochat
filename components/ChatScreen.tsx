
import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { supabase, joinOrCreateRoom, setMyAvatar, listAccessRequests, approveAccessRequest, denyAccessRequest, setRoomApproval, type PendingRequest } from '../services/supabase';
import { ChatConfig, Message, User, Subscriber, Presence } from '../types';
import MessageList from './MessageList';
// WebRTC call logic is the heaviest component in the app (~43KB); load it
// lazily so entering a room paints the message list first.
const CallManager = lazy(() => import('./CallManager'));
import { initAudio, playBeep, cleanUrl, beginThemeTransition, INCO_BOT_AVATAR } from '../utils/helpers';
import { decryptMessage } from '../utils/crypto';
import { subscribeToPushNotifications, unsubscribeFromPushNotifications } from '../utils/pushService';
import { setActiveRoom, onPushSubscriptionChanged } from '../utils/swBridge';
import ChatHeader from './ChatHeader';
import ChatInput from './ChatInput';
import { DeleteChatModal, ClearMessagesModal, EmailAlertModal } from './ChatModals';
import AiAvatarModal from './AiAvatarModal';
import UserProfileModal from './UserProfileModal';
import IncoInfoModal from './IncoInfoModal';
import RoomAppearanceModal from './RoomAppearanceModal';
import EphemeralModal, { formatTtl } from './EphemeralModal';
import RoomExpiryModal from './RoomExpiryModal';
import PermissionModal from './PermissionModal';
import PollComposerModal from './PollComposerModal';
import MediaGalleryModal from './MediaGalleryModal';
import RoomInfoModal from './RoomInfoModal';
import MembersHistoryModal from './MembersHistoryModal';
import { flashToast } from '../utils/toast';
import { getRoomBackgroundStyle, readCachedAppearance, writeCachedAppearance } from '../utils/roomBackgrounds';
import { expiryShortLabel } from '../utils/roomLifecycle';
import { parseTierError } from '../utils/tierGatingErrors';
import { canSendBatch } from '../utils/entitlements';
import { buildLiveAvatars } from '../utils/avatars';
import { computeSeenBy } from '../utils/readReceipts';
import { WifiOff, Trash2, Home, RefreshCcw, Search, X, ChevronDown, Pin, Sparkles, MicOff, MapPin, MapPinOff } from 'lucide-react';

// Hooks
import { useChatMessages } from '../hooks/useChatMessages';
import { useRoomPresence } from '../hooks/useRoomPresence';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useIncoAI } from '../hooks/useIncoAI';
import { useEntitlements } from '../hooks/useEntitlements';
import { useMessageQuota } from '../hooks/useMessageQuota';
import { useModalA11y } from '../hooks/useModalA11y';
import UpgradeModal from './UpgradeModal';
import WaitingApprovalScreen from './WaitingApprovalScreen';
import AccessRequestPrompt from './AccessRequestPrompt';

const INCO_BOT_UUID = '00000000-0000-0000-0000-000000000000';

// Best-effort localStorage writes. Persistence (drafts, lastRead, joined flags,
// prefs) is a nicety — a QuotaExceededError/SecurityError thrown synchronously
// from a render-path effect (e.g. the per-keystroke draft save) would otherwise
// bubble to the app-wide ErrorBoundary and hard-crash the chat. Degrade silently.
const safeSetItem = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* best-effort */ } };
const safeRemoveItem = (k: string) => { try { localStorage.removeItem(k); } catch { /* best-effort */ } };

interface ChatScreenProps {
  config: ChatConfig;
  // The identity App.tsx resolved (Google / anonymous / null). Source of truth:
  // the room must never silently operate under an identity that contradicts it.
  account: User | null;
  onExit: () => void;
  // Fired when the auth session is gone but App still holds a signed-in
  // (non-anonymous) account — App routes back to login instead of letting this
  // screen demote the user to a fabricated anonymous identity (wrong tier / not
  // owner). See the checkUser effect below.
  onAuthLost: () => void;
}

// -- Custom Room Deleted Toast (Persistent) --
const RoomDeletedToast: React.FC<{ onExit: () => void, onRecreate: () => void }> = ({ onExit, onRecreate }) => {
    // Blocking dialog: move focus in, trap Tab, close on Escape (→ return home),
    // restore focus on unmount — parity with every other modal (useModalA11y).
    const dialogRef = useRef<HTMLDivElement>(null);
    useModalA11y(true, onExit, dialogRef);
    return createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-500">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="room-deleted-title" tabIndex={-1} className="outline-none relative bg-slate-900/90 dark:bg-slate-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl p-8 max-w-sm w-full text-center overflow-hidden ring-1 ring-white/10">
                
                <div className="flex flex-col items-center gap-6">
                    <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.3)] ring-1 ring-red-500/50">
                         <Trash2 size={40} className="text-red-500" />
                    </div>
                    
                    <div className="space-y-3">
                        <h2 id="room-deleted-title" className="text-2xl font-bold text-white tracking-tight">The room was deleted</h2>
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

const ChatScreen: React.FC<ChatScreenProps> = ({ config, account, onExit, onAuthLost }) => {
  const [user, setUser] = useState<User | null>(null);
  const [inputText, setInputText] = useState(() => localStorage.getItem(`draft_${config.roomKey}`) || '');
  // Persist a per-room draft so a half-typed message survives switching rooms or
  // the iOS PWA being evicted from memory. Sending clears inputText (-> removes the
  // draft); a failed send restores the text (-> re-persists). Loaded on open above.
  useEffect(() => {
    const k = `draft_${config.roomKey}`;
    if (inputText) safeSetItem(k, inputText);
    else safeRemoveItem(k);
  }, [inputText, config.roomKey]);

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
    safeSetItem(key, '1');
    setShowQuotaNudge(true);
  }, [entLoading, tier, quotaLeft, config.roomKey]);

  // UI States
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showClearMessages, setShowClearMessages] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [showAiAvatarModal, setShowAiAvatarModal] = useState(false);
  const [selectedUserPresence, setSelectedUserPresence] = useState<Presence | null>(null);
  const [selectedUserSubscriber, setSelectedUserSubscriber] = useState<Subscriber | null>(null);
  
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showParticipantsList, setShowParticipantsList] = useState(false);
  const [showMembers, setShowMembers] = useState(false); // join-history list
  
  // Room Status
  const [roomDeleted, setRoomDeleted] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [decidingUid, setDecidingUid] = useState<string | null>(null);

  // Room & Creator State
  const [isRoomReady, setIsRoomReady] = useState(false);
  const [roomCreatorId, setRoomCreatorId] = useState<string | null>(null);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [isNotesRoom, setIsNotesRoom] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiAvatarUrl, setAiAvatarUrl] = useState('');
  // Non-null = the inco info modal is open, showing this avatar (the one tapped).
  const [incoInfoAvatar, setIncoInfoAvatar] = useState<string | null>(null);

  // The room's display name (owner rename via rename_room). It is NOT in the join
  // RPC payload and config.roomName is the IDENTITY name (room_name — used in
  // invite/push deep-links to re-derive the key), so it must not be overwritten.
  // We track the cosmetic display name separately: seeded from config.roomName,
  // read from the row once ready, and kept live via the room_status handler.
  const [roomDisplayName, setRoomDisplayName] = useState(config.roomName);
  // Room appearance (icon + wallpaper), owner-editable, propagated via realtime.
  // Restore the last-known appearance for THIS room synchronously from localStorage
  // so re-entering a configured room paints its real background AND icon on the
  // first frame — instead of flashing the default 'dots' preset (and the initials
  // fallback for the icon) until the room row loads over the network. Never-visited
  // rooms fall back to defaults; the live values from initRoom / realtime still
  // override and refresh the cache (effect below).
  const cachedBg = useMemo(() => readCachedAppearance(config.roomKey), [config.roomKey]);
  const [roomAvatarUrl, setRoomAvatarUrl] = useState(() => cachedBg?.avatarUrl || '');
  const [bgType, setBgType] = useState(() => cachedBg?.type || 'preset');
  const [bgPreset, setBgPreset] = useState(() => cachedBg?.preset || 'dots');
  const [bgUrl, setBgUrl] = useState(() => cachedBg?.url || '');
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
  // Mirror the live appearance into the per-room cache for the next visit. Gated
  // on isRoomReady so the pre-load defaults can't clobber a good cached value
  // before the room row arrives; read back by the lazy initializers above.
  useEffect(() => {
    if (!config.roomKey || !isRoomReady) return;
    writeCachedAppearance(config.roomKey, { type: bgType, preset: bgPreset, url: bgUrl, avatarUrl: roomAvatarUrl });
  }, [config.roomKey, isRoomReady, bgType, bgPreset, bgUrl, roomAvatarUrl]);
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
  // Device-scoped privacy preference: when off, the Location ("+") attachment is
  // hidden so no GPS read is ever requested. Default ON (preserves prior behavior).
  const [gpsEnabled, setGpsEnabled] = useState(() => localStorage.getItem('gpsEnabled') !== 'false');
  const [canVibrate, setCanVibrate] = useState(false);

  // Email Alert State
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  
  // File & Location handling state
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  // Persistent marker for a multi-file batch that failed partway, so a missed
  // (transient) toast doesn't hide that the leftover tray chips are a remainder.
  const [partialBatch, setPartialBatch] = useState<{ sent: number; total: number } | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  // The translucent top stack (header + search + pinned) and the bottom stack
  // (composer) overlay the message scroller; we measure their live heights into
  // CSS vars so the scroller's top/bottom padding keeps messages resting in the
  // visible gap (Viber-style glass bars — see specs/2026-06-26-viber-...).
  const topBarRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const isFirstLoad = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null);
  const atBottomRef = useRef(true);
  // The shared room-status channel, kept in a ref so the owner can broadcast a
  // "room deleted" event on it right before deleting the room (see handleDeleteChat).
  const roomStatusChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Scroll-to-bottom affordance + in-room search.
  const [showScrollDown, setShowScrollDown] = useState(false);
  // Blocked-location error -> shown via the shared PermissionModal (same style as mic).
  const [locationError, setLocationError] = useState<string | null>(null);
  // When the "Location sharing" preference is OFF, tapping Location asks for an
  // explicit confirm before sharing (a web app can't revoke the browser's GPS
  // permission, so OFF means "ask every time" rather than a hard block).
  const [confirmLocation, setConfirmLocation] = useState(false);
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
    retryMessage,
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
        safeSetItem(`lastRead_${config.roomKey}`, String(maxTs));
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

  // Live avatar resolution. A member's CURRENT avatar comes from the room_members
  // RPC (subscribers.avatar_url — covers offline users and old messages), overlaid
  // by live presence (freshest for online users). Overlaid onto each message so a
  // profile-photo change shows everywhere, not only on messages sent afterwards.
  const [memberAvatarRows, setMemberAvatarRows] = useState<{ uid: string; avatar_url: string | null }[]>([]);
  useEffect(() => {
    if (!isRoomReady || !config.roomKey) return;
    let alive = true;
    supabase.rpc('room_members', { p_room_key: config.roomKey }).then(({ data, error }) => {
      if (!alive || error || !Array.isArray(data)) return;
      setMemberAvatarRows((data as { uid: string; avatar_url: string | null }[]).map((r) => ({ uid: r.uid, avatar_url: r.avatar_url })));
    });
    return () => { alive = false; };
  }, [isRoomReady, config.roomKey]);

  // Stable signature so the Map's reference only changes when an avatar actually
  // changes — preserving React.memo on MessageList/MessageItem across keystrokes.
  const liveAvatarsSig = useMemo(() => {
    const parts: string[] = [];
    for (const m of memberAvatarRows) if (m.avatar_url) parts.push(`${m.uid}=${m.avatar_url}`);
    for (const p of participants) if (p.avatar) parts.push(`${p.uid}=${p.avatar}`);
    return parts.sort().join('|');
  }, [memberAvatarRows, participants]);
  // Overlay the inco bot's CURRENT avatar (room's custom AI avatar if https,
  // else the self-hosted default) onto every bot message — old + new — so the
  // assistant shows one consistent face, the same way user avatars resolve live.
  const botAvatar = aiAvatarUrl && /^https:\/\//i.test(aiAvatarUrl) ? aiAvatarUrl : INCO_BOT_AVATAR;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveAvatars = useMemo(() => {
    const map = buildLiveAvatars(memberAvatarRows, participants);
    map.set(INCO_BOT_UUID, botAvatar);
    return map;
  }, [liveAvatarsSig, botAvatar]);

  const handleRecordingComplete = async (blob: Blob, mimeType: string) => {
      // Covers the manual Stop (also gated in ChatInput) AND the recorder's
      // max-duration auto-stop, which bypasses the button. Read navigator.onLine
      // LIVE rather than the isOffline state: the recorder binds this callback at
      // record-start, so a closed-over isOffline would be stale by auto-stop time.
      if (!navigator.onLine) {
          flashToast('You’re offline — voice message not sent.');
          return;
      }
      try {
           const ext = mimeType.includes('mp4') || mimeType.includes('aac') ? 'mp4' : 'webm';
           const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mimeType });
           const attachment = await uploadFile(file);
           if (attachment) {
               await sendMessage("", config, attachment, null, null, 'text');
               // A voice note is a quota-counted insert too — refresh the per-room
               // "remaining" counter, matching the text/poll/file send paths.
               setQuotaBump((n) => n + 1);
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

  const combinedTypingUsers = useMemo(
    () => (isBotResponding ? [...typingUsers, 'inco'] : typingUsers),
    [isBotResponding, typingUsers]
  );

  // Dialog a11y for the blocking access-error overlay (focus move/trap, Escape →
  // return home, focus restore) — parity with the rest of the app's modals.
  const accessErrorDialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(!!accessError, onExit, accessErrorDialogRef);

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
    safeSetItem('theme', newTheme ? 'dark' : 'light');
  };

  // Persist audio/haptic preferences whenever they change.
  useEffect(() => { safeSetItem('soundEnabled', String(soundEnabled)); }, [soundEnabled]);
  useEffect(() => { safeSetItem('vibrationEnabled', String(vibrationEnabled)); }, [vibrationEnabled]);
  useEffect(() => { safeSetItem('gpsEnabled', String(gpsEnabled)); }, [gpsEnabled]);

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
                  // Deep-link to THIS room so tapping the push opens the room the
                  // notification is about — not whatever room the recipient last had
                  // open. window.location.href is just the app root here (the SPA uses
                  // state routing, so the URL carries no room while in a chat). `via=push`
                  // tells App.tsx to drop a returning member straight in (vs the
                  // login-prefill an invite link gets). The recipient already holds this
                  // name+pin; it travels only in the encrypted Web Push payload.
                  url: `${window.location.origin}${import.meta.env.BASE_URL}?room=${encodeURIComponent(config.roomName)}&pin=${encodeURIComponent(config.pin)}&via=push`,
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
        } else if (account && !account.isAnonymous) {
             // The auth session is gone (expired / cleared — e.g. this desktop tab
             // went stale after signing in on another device) BUT App still holds a
             // signed-in Google account. Do NOT mint an anonymous user here: that
             // fresh uid would resolve to the FREE tier, lose room ownership, and
             // post messages under a phantom identity while the surrounding UI still
             // shows the real account — the "logged-off but the room still works"
             // split-brain. Surface it so App clears the stale identity and re-routes
             // to login. (account is captured at mount, which is the relevant state.)
             onAuthLost();
        } else {
             // No session AND no signed-in account to contradict (pure anonymous
             // flow, or a returning user whose stored room outlived its anonymous
             // session) → legitimately establish a fresh anonymous identity.
             const { data: anonData, error: anonErr } = await supabase.auth.signInAnonymously();
             if (anonErr || !anonData.user) {
                 // Couldn't establish an identity (offline, Supabase down, or anon
                 // sign-ins disabled). Without surfacing this the room sits in a
                 // perpetual "connecting" state with a null user and no way out.
                 setAccessError('Could not connect. Please check your connection and try again.');
                 return;
             }
             setUser({ uid: anonData.user.id, isAnonymous: true });
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
    if (error) return;   // transient network/RLS error — never eject on it
    if (data) return;    // room row visible → we're still a member/owner; all good

    // The room row is NOT visible to us. This is AMBIGUOUS: the room may have been
    // deleted, OR we were removed and RLS (rooms = members-or-owner) now hides a room
    // that still EXISTS for others. A non-member can't tell these apart from its own
    // reads. A genuine deletion is surfaced elsewhere — the room_deleted broadcast
    // (live) or a fresh join returning ROOM_DELETED (on reopen). So here we confirm we
    // lost membership and show the "removed" message, instead of falsely setting
    // roomDeleted — which made a kick flash "You were removed" then wrongly switch to
    // "The room was deleted".
    if (!user?.uid) return;
    const { data: mem, error: memErr } = await supabase.rpc('is_member', { p_room_key: config.roomKey });
    if (!memErr && mem === false) {
      setAccessError('You were removed from this room by the owner.');
    }
  }, [config.roomKey, user?.uid]);

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

      const { data: room, pending, error } = await joinOrCreateRoom({
        roomKey: config.roomKey,
        roomName: config.roomName,
        pin: config.pin,
        username: config.username,
        createIfMissing: !alreadyJoined,
      });
      if (pending) {
        setPendingApproval(true);
        setIsRoomReady(false);
        return;
      }

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
          safeRemoveItem('chatPin');
          safeRemoveItem('chatRoomName');
        }
        return;
      }

      if (room) {
        setRoomCreatorId(room.created_by);
        setApprovalRequired(!!room.approval_required);
        setIsNotesRoom(!!room.is_notes);
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
        setPendingApproval(false);
        // Mirror our current avatar onto this room's membership row so other
        // members resolve it live (covers every room entry — the self-healing
        // path for anyone who changed their photo before this shipped).
        void setMyAvatar(config.avatarURL);
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

  // While waiting for approval (knocker): listen for the owner's decision and
  // poll as a backstop. On grant, re-run initRoom — membership now exists so it
  // resolves into the room. On deny, surface it and bail to Home.
  useEffect(() => {
    if (!pendingApproval || !config.roomKey || !user?.uid) return;
    const ch = supabase.channel(`room_status:${config.roomKey}`)
      .on('broadcast', { event: 'access_granted' }, ({ payload }) => {
        if (payload?.uid === user.uid) { setPendingApproval(false); initRoom(); }
      })
      .on('broadcast', { event: 'access_denied' }, ({ payload }) => {
        if (payload?.uid === user.uid) { setPendingApproval(false); setAccessError('The owner denied your request to join.'); }
      })
      .subscribe();
    const poll = setInterval(() => { initRoom(); }, 5000);
    return () => { clearInterval(poll); supabase.removeChannel(ch); };
  }, [pendingApproval, config.roomKey, user?.uid, initRoom]);

  const handleRecreate = () => {
      // Clear the durable flag so initRoom knows this is an intentional new creation
      safeRemoveItem(`joined_${config.roomKey}`);
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
              safeSetItem(joinedKey, 'true');
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
        // Skip a not-yet-persisted optimistic temp: its createdAt is a CLIENT
        // time and would pin the read pointer ahead → false "Seen" (mirrors the
        // new-message effect's guard).
        if (last && !last.status) setLastRead(last.createdAt);
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
        isFirstLoad.current = false;
        setLastRead(last.createdAt);
        const end = messagesEndRef.current;
        end.scrollIntoView({ behavior: "auto" });
        // The first scroll fires before late-loading content (image/video
        // attachments, link previews) grows the list, which would otherwise
        // leave the view parked above the newest message. Re-pin to the bottom
        // across a short settling window — but only while still at the bottom,
        // so a user who immediately scrolls up to read history isn't yanked back.
        [100, 300, 650].forEach((d) =>
            window.setTimeout(() => { if (atBottomRef.current) end.scrollIntoView({ behavior: "auto" }); }, d)
        );
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
            // Don't advance the read pointer off a not-yet-persisted optimistic
            // message — its createdAt is a CLIENT time and would pin lastRead
            // ahead of real server times (false "Seen"). It re-fires post-reconcile
            // with the server createdAt.
            if (!last.status && (isMine || document.visibilityState === 'visible')) setLastRead(last.createdAt);
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
    for (const [uid, r] of readReceipts) {
      if (uid !== user.uid && new Date(r.pos) >= new Date(myLast.createdAt)) { seen = true; break; }
    }
    return seen ? myLast.id : null;
  }, [messages, readReceipts, user]);

  // "Seen by" for a message's long-press menu, computed lazily (on open) from
  // refs so it never re-renders the message list when receipts advance. Mirrors
  // readReceipts into a ref; participantsRef already tracks the live roster.
  const readReceiptsRef = useRef(readReceipts);
  useEffect(() => { readReceiptsRef.current = readReceipts; }, [readReceipts]);
  const getSeenBy = useCallback(
    (m: Message) => computeSeenBy(m, readReceiptsRef.current, participantsRef.current, user?.uid),
    [user?.uid],
  );

  const isOwner = user?.uid === roomCreatorId;

  // Owner only: load existing pending knocks and listen for new ones live.
  useEffect(() => {
    if (!isOwner || !isRoomReady || !config.roomKey) return;
    let alive = true;
    listAccessRequests(config.roomKey).then((rows) => { if (alive) setPendingRequests(rows); });
    const ch = supabase.channel(`access_requests:${config.roomKey}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_access_requests', filter: `room_key=eq.${config.roomKey}` },
        ({ new: row }: { new: PendingRequest }) => {
          setPendingRequests((prev) => prev.some((r) => r.uid === row.uid) ? prev : [...prev, row]);
        })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [isOwner, isRoomReady, config.roomKey]);

  const handleApprove = useCallback(async (uid: string): Promise<boolean> => {
    setDecidingUid(uid);
    const ok = await approveAccessRequest(config.roomKey, uid);
    setDecidingUid(null);
    if (ok) {
      roomStatusChannelRef.current?.send({ type: 'broadcast', event: 'access_granted', payload: { uid } });
      setPendingRequests((prev) => prev.filter((r) => r.uid !== uid));
    } else { flashToast('Could not approve. Please try again.'); }
    return ok;
  }, [config.roomKey]);

  const handleDeny = useCallback(async (uid: string): Promise<boolean> => {
    setDecidingUid(uid);
    const ok = await denyAccessRequest(config.roomKey, uid);
    setDecidingUid(null);
    if (ok) {
      roomStatusChannelRef.current?.send({ type: 'broadcast', event: 'access_denied', payload: { uid } });
      setPendingRequests((prev) => prev.filter((r) => r.uid !== uid));
    } else { flashToast('Could not deny. Please try again.'); }
    return ok;
  }, [config.roomKey]);

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
      .on('broadcast', { event: 'member_removed' }, ({ payload }) => {
        if (payload?.uid && user?.uid && payload.uid === user.uid) {
          setAccessError('You were removed from this room by the owner.');
        }
      })
      .on('broadcast', { event: 'members_cleared' }, () => {
        // Everyone except the owner is removed; the owner re-subscribes itself.
        if (user?.uid && roomCreatorId && user.uid !== roomCreatorId) {
          setAccessError('You were removed from this room by the owner.');
        }
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
            if (payload.new.display_name !== undefined) setRoomDisplayName(payload.new.display_name || config.roomName);
            if (payload.new.background_type !== undefined) setBgType(payload.new.background_type || 'preset');
            if (payload.new.background_preset !== undefined) setBgPreset(payload.new.background_preset || 'dots');
            if (payload.new.background_url !== undefined) setBgUrl(payload.new.background_url || '');
            if (payload.new.message_ttl_seconds !== undefined) setMessageTtl(payload.new.message_ttl_seconds ?? null);
            if (payload.new.auto_delete_seconds !== undefined) setRoomExpiry(payload.new.auto_delete_seconds ?? null);
            if (payload.new.expires_at !== undefined) setRoomExpiresAt(payload.new.expires_at ?? null);
            if (payload.new.pinned_message_id !== undefined) setPinnedMessageId(payload.new.pinned_message_id ?? null);
            if (payload.new.approval_required !== undefined) setApprovalRequired(payload.new.approval_required);
        }
      })
      .subscribe();
    roomStatusChannelRef.current = roomStatusChannel;
    return () => { roomStatusChannelRef.current = null; supabase.removeChannel(roomStatusChannel); };
  }, [config.roomKey, isRoomReady, roomDeleted, user?.uid, roomCreatorId]);

  // The free-tier 24h auto-delete timestamp AND the cosmetic display_name aren't
  // in the join RPC payload; read them directly once the room is ready (members
  // can SELECT room columns under RLS). Realtime keeps both fresh via the
  // room_status handler above.
  useEffect(() => {
    if (!isRoomReady || !config.roomKey) return;
    let alive = true;
    supabase.from('rooms').select('expires_at, display_name').eq('room_key', config.roomKey).maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        const row = data as { expires_at?: string | null; display_name?: string | null } | null;
        setRoomExpiresAt(row?.expires_at ?? null);
        setRoomDisplayName(row?.display_name || config.roomName);
      });
    return () => { alive = false; };
  }, [isRoomReady, config.roomKey, config.roomName]);

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
      roomStatusChannelRef.current?.send({ type: 'broadcast', event: 'members_cleared', payload: {} });
      setApprovalRequired(true);
      return true;
    } catch (e) {
      console.error('clear_room_members failed', e);
      flashToast('Could not clear members. Please try again.');
      return false;
    }
  }, [config]);

  // Owner-only: toggle the "Approval to join" flag. Optimistic update with revert.
  const handleToggleApproval = useCallback(async () => {
    const next = !approvalRequired;
    setApprovalRequired(next); // optimistic; room_status echo keeps members in sync
    const ok = await setRoomApproval(config.roomKey, next);
    if (!ok) { setApprovalRequired(!next); flashToast('Could not change the approval setting.'); }
  }, [approvalRequired, config.roomKey]);

  // Owner-only: remove a SINGLE member (kick, not ban). The server RPC re-checks
  // ownership and refuses self-removal; messages stay and the user can rejoin
  // with the PIN. No owner re-subscribe needed (the owner's own row is untouched).
  const handleRemoveMember = useCallback(async (uid: string, username: string): Promise<boolean> => {
    if (!config.roomKey || !uid) return false;
    try {
      const { error } = await supabase.rpc('remove_room_member', { p_room_key: config.roomKey, p_uid: uid });
      if (error) throw error;
      roomStatusChannelRef.current?.send({ type: 'broadcast', event: 'member_removed', payload: { uid } });
      setApprovalRequired(true);
      flashToast(`Removed ${username}.`);
      return true;
    } catch (e) {
      console.error('remove_room_member failed', e);
      flashToast('Could not remove member. Please try again.');
      return false;
    }
  }, [config.roomKey]);

  // Basic+ member: wipe ALL messages in the room (server-enforced via the
  // SECURITY DEFINER clear_room_messages RPC). Per-row realtime DELETE events
  // clear every member's open view (incl. this one), so we don't touch local
  // state here. The room itself stays.
  const handleClearMessages = useCallback(async () => {
    if (!config.roomKey || isClearing) return;
    setIsClearing(true);
    try {
      // Capture BEFORE the wipe: only attachments uploaded up to this instant
      // belong to messages the RPC removes. A file uploaded concurrently (another
      // member sending mid-clear) must survive with its still-live message.
      const clearStart = new Date().toISOString();
      const { error } = await supabase.rpc('clear_room_messages', { p_room_key: config.roomKey });
      if (error) throw error;
      setShowClearMessages(false);

      // The RPC is SQL and can't touch Storage, so the wiped messages leave their
      // attachment files orphaned under `${roomKey}/`. Remove them — but PRESERVE
      // the room's appearance files (room_*, ai_avatar_*), which share the same
      // prefix and are NOT messages. Best-effort, paginated, non-fatal: a failure
      // only leaves files that the room-deletion sweep later reclaims.
      try {
        const PAGE = 100;
        let offset = 0;
        const toRemove: string[] = [];
        for (;;) {
          const { data: files } = await supabase.storage.from('attachments').list(config.roomKey, { limit: PAGE, offset });
          if (!files || files.length === 0) break;
          for (const f of files) {
            if (f.id === null) continue; // sub-folder placeholder, not a file
            if (f.name.startsWith('room_') || f.name.startsWith('ai_avatar_')) continue; // room appearance — keep
            if (f.created_at && f.created_at > clearStart) continue; // uploaded after the wipe — keep
            toRemove.push(`${config.roomKey}/${f.name}`);
          }
          if (files.length < PAGE) break;
          offset += PAGE;
        }
        for (let i = 0; i < toRemove.length; i += 1000) {
          await supabase.storage.from('attachments').remove(toRemove.slice(i, i + 1000));
        }
      } catch (storageErr) {
        console.warn('Clear-messages storage cleanup failed (non-fatal):', storageErr);
      }
    } catch (e) {
      console.error('clear_room_messages failed', e);
      flashToast('Could not clear messages. Please try again.');
    } finally {
      setIsClearing(false);
    }
  }, [config.roomKey, isClearing]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputText(e.target.value);
      setTyping(true);
  };

  const handleSend = async (e?: React.FormEvent) => {
      e?.preventDefault();
      if ((!inputText.trim() && selectedFiles.length === 0) || !user || roomDeleted) return;

      // Daily message limit hit: don't round-trip a doomed insert. For the
      // optimistic text path that would leave a stuck 'failed' bubble and clear
      // the composer; open the upgrade funnel directly instead. Edits don't count
      // against quota. (Mirrors the multi-file canSendBatch gate below.)
      if (!editingMessageId && quotaLeft === 0) {
          promptUpgrade('A higher message limit', 'ultra', "You've hit today's limit for this room.");
          return;
      }

      // Snapshot so a failed send can restore the composer (optimistic clear
      // must not silently eat the user's text/files/reply).
      const textToSend = inputText.trim();
      const filesToSend = selectedFiles;
      const replyToSend = replyingTo;
      const editingId = editingMessageId;

      setInputText('');
      setTyping(false);
      setSelectedFiles([]);
      setReplyingTo(null);

      try {
          if (editingId) {
              await editMessage(editingId, textToSend);
              setEditingMessageId(null);
          } else if (filesToSend.length === 0) {
              // Plain text — OPTIMISTIC: the bubble already rendered. sendMessage
              // does NOT throw here; it resolves with the outcome. On failure the
              // inline "failed + retry" bubble is the cue (no composer restore).
              const outcome = await sendMessage(textToSend, config, null, replyToSend, null, 'text');
              if (outcome.ok) {
                  setQuotaBump((n) => n + 1);
                  notifySubscribers('message', textToSend);
              } else {
                  const tierErr = parseTierError(outcome.error, tier);
                  if (tierErr?.code === 'QT002') promptUpgrade('A higher message limit', tierErr.requiredTier, "You've hit today's limit for this room.");
                  else if (tierErr) flashToast(tierErr.message);
              }
          } else {
              // Multi-file: client-side gate first (the DB also enforces the
              // daily quota and raises QT002 on the over-limit insert).
              const gate = canSendBatch(filesToSend.length, quotaLeft);
              if (!gate.ok) {
                  setInputText(textToSend);
                  setSelectedFiles(filesToSend);
                  setReplyingTo(replyToSend);
                  if (gate.reason === 'quota') promptUpgrade('A higher message limit', 'ultra', "You've hit today's limit for this room.");
                  else if (gate.reason === 'max') flashToast(`You can send up to ${gate.limit} files at once.`);
                  return;
              }
              // Send each file as its own message, in order. Caption + reply
              // attach to the FIRST message only; the rest are bare.
              setPartialBatch(null);
              for (let i = 0; i < filesToSend.length; i++) {
                  setUploadProgress({ current: i + 1, total: filesToSend.length });
                  try {
                      const attachment = await uploadFile(filesToSend[i]);
                      await sendMessage(i === 0 ? textToSend : '', config, attachment, i === 0 ? replyToSend : null, null, 'text');
                      if (i === 0) setQuotaBump((n) => n + 1);
                  } catch (err) {
                      // Keep what's already sent; restore the unsent remainder
                      // (plus caption/reply if the first never went) for retry.
                      setUploadProgress(null);
                      setSelectedFiles(filesToSend.slice(i));
                      if (i === 0) { setInputText(textToSend); setReplyingTo(replyToSend); }
                      // Persistent marker (survives the transient toast) so the user
                      // sees the leftover chips are a partial-send remainder.
                      if (i > 0) setPartialBatch({ sent: i, total: filesToSend.length });
                      const tierErr = parseTierError(err, tier);
                      if (tierErr?.code === 'QT002') promptUpgrade('A higher message limit', tierErr.requiredTier, "You've hit today's limit for this room.");
                      else if (tierErr) flashToast(tierErr.message);
                      else flashToast(`Sent ${i} of ${filesToSend.length} files. Tap send to retry the rest.`);
                      return;
                  }
              }
              setUploadProgress(null);
              setPartialBatch(null);
              setQuotaBump((n) => n + 1);
              notifySubscribers('message', textToSend || `Sent ${filesToSend.length} files`);
          }
      } catch (err) {
          console.error('Send failed', err);
          // Restore composer (covers the editing + text-only paths; the
          // multi-file loop restores its own remainder above before returning).
          setInputText(textToSend);
          if (filesToSend.length === 0) setSelectedFiles(filesToSend);
          setReplyingTo(replyToSend);
          if (editingId) setEditingMessageId(editingId);
          const tierErr = parseTierError(err, tier);
          if (tierErr) {
            if (tierErr.code === 'QT004') {
              promptUpgrade('Inco AI', tierErr.requiredTier);
            } else if (tierErr.code === 'QT002') {
              promptUpgrade('A higher message limit', tierErr.requiredTier, "You've hit today's limit for this room.");
            } else {
              flashToast(tierErr.message);
            }
          }
      }
  };

  // Keep a fresh ref so the memoized handleRetry (passed to the memoized
  // MessageList) doesn't change identity every keystroke just to capture the
  // non-memoized notifySubscribers — which would defeat the list's React.memo.
  const notifySubscribersRef = useRef(notifySubscribers);
  notifySubscribersRef.current = notifySubscribers;

  // Retry a failed optimistic text send (tapped from the inline failed bubble).
  const handleRetry = useCallback(async (msg: Message) => {
      const outcome = await retryMessage(msg.id);
      if (outcome.ok) {
          setQuotaBump((n) => n + 1);
          notifySubscribersRef.current('message', msg.text);
      } else {
          const tierErr = parseTierError(outcome.error, tier);
          if (tierErr?.code === 'QT002') promptUpgrade('A higher message limit', tierErr.requiredTier, "You've hit today's limit for this room.");
          else if (tierErr) flashToast(tierErr.message);
      }
  }, [retryMessage, tier, promptUpgrade]);

  const handleSendLocation = async () => {
       if (!user || roomDeleted) return;
       if (!navigator.geolocation) { setLocationError('Location isn’t available on this device.'); return; }
       setIsGettingLocation(true);
       navigator.geolocation.getCurrentPosition(
           async (pos) => {
               try {
                   await sendMessage("📍 Shared a location", config, null, null, { lat: pos.coords.latitude, lng: pos.coords.longitude }, 'text');
                   // Quota-counted insert — refresh the per-room remaining counter.
                   setQuotaBump((n) => n + 1);
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
               setLocationError(err.code === err.PERMISSION_DENIED
                   ? 'Location access is blocked. Allow location permission in your browser settings, then try again.'
                   : 'Could not get your location. Please try again.');
           },
           { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
       );
  };

  // Entry point for the Location "+" action. With the preference ON we share
  // immediately; with it OFF we first ask for confirmation (the OFF state stays
  // off — it's a privacy guard that prompts every time, not a one-time gate).
  const requestSendLocation = () => {
      if (gpsEnabled) handleSendLocation();
      else setConfirmLocation(true);
  };

  const handleEditMessage = useCallback((msg: Message) => {
      setInputText(msg.text);
      setEditingMessageId(msg.id);
      setReplyingTo(null);
      setSelectedFiles([]);
  }, []);
  
  const handleReply = useCallback((msg: Message) => {
      setReplyingTo(msg);
      setEditingMessageId(null);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
      // Don't send on the Enter that COMMITS an IME composition (CJK desktop IMEs,
      // and mobile soft-keyboard autocomplete/glide-typing incl. Greek): it fires
      // keydown with isComposing=true / keyCode 229. Sending here would ship a
      // half-composed message and discard the in-flight composition.
      if ((e.nativeEvent as any).isComposing || (e as any).keyCode === 229) return;
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
           safeRemoveItem(`joined_${config.roomKey}`);
           onExit();
      } catch(e) {
          console.error("Delete failed", e);
          flashToast('Could not delete the room. Please try again.');
          setIsDeleting(false);
      }
  };
  
  const toggleNotifications = async () => {
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
      // Require a real local@domain.tld shape, not just an '@' (which let 'a@' /
      // '@b' / 'a@b' persist and silently never receive alerts).
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress.trim());
      if (!user || !config.roomKey || !emailOk) {
          flashToast("Please enter a valid email.");
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
      } catch (e: any) {
          console.error("Error saving email:", e);
          // Email alerts are Basic+ (server enforce_email_alert_tier → QT004). If a
          // free user reaches this write (e.g. UI gate bypassed), surface the
          // paywall instead of a generic failure.
          const tierErr = parseTierError(e, tier);
          if (tierErr) { setShowEmailModal(false); promptUpgrade('Email alerts', tierErr.requiredTier, 'Get notified by email when new messages arrive.'); }
          else flashToast("Failed to subscribe.");
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

  // The glass top/bottom bars overlay the full-height message scroller, so the
  // scroller pads itself by each bar's live height to keep the first/last
  // message resting in the visible gap. Measured via ResizeObserver and written
  // STRAIGHT to the root's CSS vars (no React state → MessageList's React.memo
  // stays effective, so growing the textarea or opening a reply banner never
  // re-renders the list). roomDeleted re-grabs the footer ref when it mounts.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => {
      const t = topBarRef.current;
      const b = bottomBarRef.current;
      root.style.setProperty('--chat-top-h', `${t ? t.offsetHeight : 0}px`);
      root.style.setProperty('--chat-bottom-h', `${b ? b.offsetHeight : 0}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    if (topBarRef.current) ro.observe(topBarRef.current);
    if (bottomBarRef.current) ro.observe(bottomBarRef.current);
    // env(safe-area-inset-*) can change WITHOUT a content change inside the bars
    // (orientation flip; the home-indicator inset resolving to 0 when the soft
    // keyboard opens). ResizeObserver does fire on those, but a frame late — while
    // the visualViewport handler resizes the root synchronously on the same event
    // — so re-measure eagerly on these to avoid a 1-frame tuck/gap.
    const vv = window.visualViewport;
    window.addEventListener('orientationchange', update);
    vv?.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', update);
      vv?.removeEventListener('resize', update);
    };
  }, [roomDeleted]);

  // Tapping the inco bot's avatar/name opens its info modal (it has no user
  // profile). Show whatever avatar was on screen, falling back to the default.
  const handleIncoClick = useCallback((avatar: string) => {
      setIncoInfoAvatar(avatar || INCO_BOT_AVATAR);
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
    <div ref={rootRef} className="fixed inset-0 h-[100dvh] w-full bg-slate-100 dark:bg-slate-900 max-w-5xl mx-auto shadow-2xl overflow-hidden z-50 md:relative md:inset-auto md:rounded-2xl md:my-4 md:h-[95vh] md:border border-white/40 dark:border-slate-800 transition-colors">

      {/* Full-bleed wallpaper layer — behind the scroller AND the glass bars, so
          messages and bars alike reveal it (Viber-style). Was the <main> bg. */}
      <div
        aria-hidden
        className="absolute inset-0 z-0 pointer-events-none"
        style={getRoomBackgroundStyle({ type: bgType === 'image' && !bgReady ? 'preset' : bgType, preset: bgPreset, url: bgUrl }, isDarkMode)}
      />

      {roomDeleted && <RoomDeletedToast onExit={handleExitChat} onRecreate={handleRecreate} />}

      {showQuotaNudge && (
        <QuotaNudgeToast
          left={quotaLeft ?? 0}
          onUpgrade={() => { setShowQuotaNudge(false); promptUpgrade('Unlimited messaging', 'basic', "You're halfway through today's free messages in this room."); }}
          onClose={() => setShowQuotaNudge(false)}
        />
      )}

      {pendingApproval && !accessError && (
        <WaitingApprovalScreen roomName={config.roomName} onCancel={onExit} />
      )}

      {isOwner && pendingRequests.length > 0 && (
        <AccessRequestPrompt
          username={pendingRequests[0].username}
          waitingCount={pendingRequests.length}
          busy={decidingUid === pendingRequests[0].uid}
          onApprove={() => handleApprove(pendingRequests[0].uid)}
          onDeny={() => handleDeny(pendingRequests[0].uid)}
        />
      )}

      {accessError && createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
          <div ref={accessErrorDialogRef} role="dialog" aria-modal="true" aria-labelledby="access-error-title" tabIndex={-1} className="outline-none bg-slate-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl p-8 max-w-sm w-full text-center ring-1 ring-white/10">
            <div className="flex flex-col items-center gap-6">
              <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center ring-1 ring-amber-500/50">
                <Trash2 size={40} className="text-amber-400" />
              </div>
              <div className="space-y-3">
                <h2 id="access-error-title" className="text-2xl font-bold text-white tracking-tight">Can't enter room</h2>
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

      {/* Glass top stack — overlays the scroller; header + search + pinned move
          here together so their combined live height feeds --chat-top-h. */}
      <div ref={topBarRef} className="absolute top-0 inset-x-0 z-30">
      <ChatHeader
        config={config}
        participants={participants}
        isRoomReady={isRoomReady && !roomDeleted}
        onExit={handleExitChat}
        roomAvatarUrl={roomAvatarUrl}
        roomDisplayName={roomDisplayName}
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

      </div>

      <main
        ref={mainRef}
        onScroll={handleMainScroll}
        className="absolute inset-0 z-10 overflow-y-auto overflow-x-clip overscroll-contain px-4 transition-colors"
        style={{
          paddingTop: 'calc(var(--chat-top-h, 4rem) + 0.5rem)',
          paddingBottom: 'calc(var(--chat-bottom-h, 4rem) + 0.5rem)',
        }}
      >
        <MessageList
            messages={messages}
            currentUserUid={user?.uid || ''}
            roomOwnerUid={roomCreatorId || undefined}
            onEdit={handleEditMessage}
            onDelete={deleteMessage}
            onReply={handleReply}
            onReact={reactToMessage}
            onRetry={handleRetry}
            onUserClick={handleUserClick}
            onIncoClick={handleIncoClick}
            getSeenBy={getSeenBy}
            liveAvatars={liveAvatars}
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

      {/* Hidden while the quota nudge is up: both sit at bottom-24 and would
          overlap (and the nudge card could swallow a tap meant for this pill). */}
      {showScrollDown && !roomDeleted && !showQuotaNudge && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute bottom-24 right-4 z-40 flex items-center gap-1.5 pl-3 pr-3 py-2 bg-white/90 text-slate-700 ring-1 ring-black/10 hover:bg-white dark:bg-slate-900/90 dark:text-white dark:ring-white/20 dark:hover:bg-slate-800 backdrop-blur-md rounded-full shadow-xl shadow-black/30 transition-all active:scale-95 animate-in fade-in slide-in-from-bottom-2"
          aria-label="Scroll to latest messages"
        >
          <ChevronDown size={18} />
          {newMessageCount > 0 && (
            <span className="text-xs font-bold">{newMessageCount} new</span>
          )}
        </button>
      )}

      {/* Glass bottom stack — overlays the scroller; its live height feeds
          --chat-bottom-h (grows with reply/edit banners, file chips, multiline).
          Keep this wrapper ALWAYS mounted and gate its CHILDREN on !roomDeleted
          (not the wrapper) so the ResizeObserver keeps observing it; when deleted
          the empty div collapses to 0 and the scroller padding self-corrects. */}
      <div ref={bottomBarRef} className="absolute bottom-0 inset-x-0 z-20">
      {!roomDeleted && (
        <>
        {partialBatch && selectedFiles.length > 0 && (
          <div className="px-4 pb-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 select-none">
            {partialBatch.sent} of {partialBatch.total} files sent — tap Send to finish the rest.
          </div>
        )}
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
            selectedFiles={selectedFiles}
            setSelectedFiles={(f) => { setSelectedFiles(f); setPartialBatch(null); }}
            isUploading={isUploading}
            isGettingLocation={isGettingLocation}
            handleSendLocation={requestSendLocation}
            editingMessageId={editingMessageId}
            cancelEdit={() => { setEditingMessageId(null); setInputText(''); }}
            replyingTo={replyingTo}
            cancelReply={() => setReplyingTo(null)}
            isOffline={isOffline}
            isRoomReady={isRoomReady}
            typingUsers={combinedTypingUsers}
            onOpenPoll={() => setShowPollComposer(true)}
            maxFileBytes={ent.maxFileBytes}
            canMultiUpload={ent.canMultiUpload}
            uploadProgress={uploadProgress}
            quotaLeft={quotaLeft}
        />
        </>
      )}
      </div>

      <DeleteChatModal
        show={showDeleteModal}
        onCancel={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteChat}
        isDeleting={isDeleting}
      />

      <ClearMessagesModal
        show={showClearMessages}
        onCancel={() => setShowClearMessages(false)}
        onConfirm={handleClearMessages}
        isClearing={isClearing}
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
        isNotes={isNotesRoom}
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

      <PermissionModal show={!!micError} title="Microphone unavailable" icon={<MicOff size={22} />} message={micError || ''} onClose={dismissMicError} />
      <PermissionModal show={!!locationError} title="Location unavailable" icon={<MapPinOff size={22} />} message={locationError || ''} onClose={() => setLocationError(null)} />
      {confirmLocation && createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setConfirmLocation(false)}>
          <div role="dialog" aria-modal="true" aria-label="Share location" onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-white/10 dark:border-slate-800 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-3">
              <span className="flex items-center justify-center w-11 h-11 rounded-full bg-blue-500/10 text-blue-500 shrink-0"><MapPin size={22} /></span>
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">Share your location?</h3>
            </div>
            <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400 mb-6">Your current location will be shared in this room. Location sharing is off in Preferences, so we ask each time.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmLocation(false)} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition active:scale-[0.98]">Cancel</button>
              <button onClick={() => { setConfirmLocation(false); handleSendLocation(); }} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 transition active:scale-[0.98]">Share location</button>
            </div>
          </div>
        </div>,
        document.body
      )}

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
        roomDisplayName={roomDisplayName}
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
        onClearMessages={() => setShowClearMessages(true)}
        onOpenEmail={() => setShowEmailModal(true)}
        onDeleteRoom={() => setShowDeleteModal(true)}
        ent={ent}
        entLoading={entLoading}
        onUpgrade={promptUpgrade}
        approvalRequired={approvalRequired}
        onToggleApproval={handleToggleApproval}
        pendingCount={isOwner ? pendingRequests.length : 0}
        canVibrate={canVibrate}
        vibrationEnabled={vibrationEnabled}
        onToggleVibration={() => setVibrationEnabled((v) => !v)}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled((v) => !v)}
        gpsEnabled={gpsEnabled}
        onToggleGps={() => setGpsEnabled((v) => !v)}
        notificationsEnabled={notificationsEnabled}
        onToggleNotifications={toggleNotifications}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
      />

      <MembersHistoryModal
        show={showMembers}
        onClose={() => setShowMembers(false)}
        roomKey={config.roomKey}
        onlineUids={participants.filter((p) => p.status === 'active').map((p) => p.uid)}
        selfUid={user?.uid}
        canClear={user?.uid === roomCreatorId}
        onClearMembers={handleClearMembers}
        onRemoveMember={handleRemoveMember}
        pendingRequests={isOwner ? pendingRequests : undefined}
        onApprove={handleApprove}
        onDeny={handleDeny}
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

      <IncoInfoModal avatar={incoInfoAvatar} onClose={() => setIncoInfoAvatar(null)} />
    </div>
  );
};

export default ChatScreen;
