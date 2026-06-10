
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase, joinOrCreateRoom } from '../services/supabase';
import { User, ChatConfig, Room } from '../types';
import { generateRoomKey, compressImage } from '../utils/helpers';
import {
  LogOut, Trash2, ArrowRight, Loader2,
  Upload, RotateCcw,
  RefreshCw, Save, X, Edit2, Mail, LogIn, BellRing, Link as LinkIcon, AlertCircle, Eye, EyeOff, GripVertical,
  Search, Star, Sun, Moon, Zap
} from 'lucide-react';
import {
  DndContext, DragOverlay, closestCenter, MouseSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface DashboardScreenProps {
  user: User;
  onJoinRoom: (config: ChatConfig) => void;
  onLogout: () => void;
}

// Shared props for the card body, the sortable wrapper and the static (filtered) view.
type RoomCardProps = {
  room: Room; userUid: string; unread: boolean; revealed: boolean; isFavorite: boolean;
  onJoin: (r: Room) => void;
  onRequestDelete: (name: string, key: string, createdBy: string) => void;
  onTogglePin: (e: React.MouseEvent, key: string) => void;
  onToggleFav: (e: React.MouseEvent, key: string) => void;
};

// Card chrome shared by the sortable card and the static (search/filter/favorites) card.
const CARD_CHROME = "room-card group bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border flex flex-col justify-between relative overflow-hidden select-none border-slate-200 dark:border-slate-800 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-800 transition-shadow";

const RoomDeleteToast: React.FC<{
    roomName: string;
    isOwner: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    isDeleting: boolean;
}> = ({ roomName, isOwner, onConfirm, onCancel, isDeleting }) => {
    return createPortal(
        <div className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-auto z-[100] animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-6 p-4 bg-slate-900/90 dark:bg-white/10 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl text-white ring-1 ring-black/10">
                <div className="flex flex-col items-center sm:items-start text-center sm:text-left w-full sm:w-auto min-w-[200px]">
                    <span className="text-sm font-bold flex items-center justify-center sm:justify-start gap-2 text-white">
                        <AlertCircle size={18} className="text-red-400 shrink-0" />
                        <span>{isOwner ? 'Delete Room?' : 'Leave Room?'}</span>
                    </span>
                    <span className="text-[11px] text-white/60 mt-0.5">
                        {isOwner
                            ? `"${roomName}" will be permanently deleted for everyone.`
                            : `You'll leave "${roomName}" and remove it from your list.`}
                    </span>
                </div>
                <div className="hidden sm:block h-8 w-px bg-white/10"></div>
                <div className="flex gap-2 w-full sm:w-auto">
                    <button onClick={onCancel} className="flex-1 sm:flex-none px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors text-center border border-white/5">Cancel</button>
                    <button onClick={onConfirm} disabled={isDeleting} className="flex-1 sm:flex-none px-4 py-1.5 text-xs font-bold bg-red-500 hover:bg-red-600 text-white rounded-lg shadow-lg shadow-red-500/20 transition-all active:scale-95 flex items-center justify-center gap-1.5">
                        {isDeleting ? <Loader2 size={14} className="animate-spin"/> : (isOwner ? <Trash2 size={14} /> : <LogOut size={14} />)}
                        <span>{isOwner ? 'Delete' : 'Leave'}</span>
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

// Presentational card body, shared by the sortable item and the drag overlay.
const RoomCardInner = React.memo(({ room, userUid, unread, revealed, isFavorite, onJoin, onRequestDelete, onTogglePin, onToggleFav }: RoomCardProps) => {
  const isOwner = room.created_by === userUid;
  // Stop pointerdown on the controls from starting a card drag, so the buttons
  // and PIN toggle keep working normally.
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <>
      <div className="mb-4 relative z-10">
        <div className="flex justify-between items-start mb-2">
          <h4 className="font-bold text-lg text-slate-800 dark:text-slate-100 truncate pr-2 flex items-center gap-2 min-w-0">
            <GripVertical size={16} className="text-slate-300 dark:text-slate-600 shrink-0" />
            <span className="truncate" title={room.room_name}>{room.room_name}</span>
            {unread && (
              <span className="flex h-2.5 w-2.5 relative shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
            )}
          </h4>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onPointerDown={stop}
              onClick={(e) => { e.stopPropagation(); onToggleFav(e, room.room_key); }}
              aria-pressed={isFavorite}
              title={isFavorite ? 'Unpin from top' : 'Pin to top'}
              className={`p-1.5 rounded-lg transition ${isFavorite ? 'text-amber-400 opacity-100' : 'text-slate-300 hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100'}`}
            >
              <Star size={16} fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
            <button onPointerDown={stop} onClick={(e) => { e.stopPropagation(); onRequestDelete(room.room_name, room.room_key, room.created_by); }} className="text-slate-300 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" title={isOwner ? "Delete room (for everyone)" : "Leave room"}>
              {isOwner ? <Trash2 size={16} /> : <LogOut size={16} />}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div onPointerDown={stop} onClick={(e) => { e.stopPropagation(); onTogglePin(e, room.room_key); }} className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md font-mono border border-slate-200 dark:border-slate-700 hover:border-blue-300 transition-colors cursor-pointer select-none" title="Click to reveal PIN">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">PIN:</span>
            <span className="font-bold text-slate-700 dark:text-blue-400 min-w-[32px] text-center">{revealed ? room.pin : '••••'}</span>
            {revealed ? <EyeOff size={12} className="text-blue-500" /> : <Eye size={12} className="text-slate-400" />}
          </div>
          {isOwner
            ? <span className="text-blue-500 font-medium">Owner</span>
            : <span className="text-emerald-500 font-medium">Joined</span>}
          <span>•</span>
          <span>{new Date(room.created_at).toLocaleDateString()}</span>
        </div>
        {unread && (
          <div className="mt-3 flex items-center gap-1.5 text-xs font-bold text-red-500 dark:text-red-400 animate-pulse">
            <BellRing size={14} />
            <span>New messages</span>
          </div>
        )}
      </div>
      <button onPointerDown={stop} onClick={() => onJoin(room)} className={`w-full py-2.5 font-semibold rounded-xl transition flex items-center justify-center gap-2 z-10 ${unread ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30 group-hover:bg-red-500 group-hover:text-white group-hover:border-red-500' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 group-hover:bg-blue-600 group-hover:text-white dark:group-hover:bg-blue-600 dark:group-hover:text-white'}`}>
        Enter Room <ArrowRight size={16} />
      </button>
    </>
  );
});

// Sortable wrapper — the whole card is draggable (mouse drag / touch long-press /
// keyboard). While lifted it dims in place; the DragOverlay renders the copy that
// follows the pointer. Used only when no search/filter/favorite ordering is active.
const SortableRoomCard = React.memo((props: RoomCardProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.room.room_key });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    WebkitTouchCallout: 'none',
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      aria-label={`Room ${props.room.room_name}. Press space or long-press to reorder.`}
      className={`room-card group bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border flex flex-col justify-between relative overflow-hidden select-none touch-manipulation cursor-grab active:cursor-grabbing outline-none focus-visible:ring-2 focus-visible:ring-blue-500
        ${isDragging
          ? 'opacity-40 border-blue-400 dark:border-blue-700'
          : 'border-slate-200 dark:border-slate-800 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-800 transition-shadow'}`}
    >
      <RoomCardInner {...props} />
    </div>
  );
});

// Non-draggable card — rendered when the displayed order differs from the saved
// drag order (active search/filter, or favorites pinned to top), so there's no
// index-mapping ambiguity between what's shown and what a drag would reorder.
const StaticRoomCard = React.memo((props: RoomCardProps) => (
  <div className={CARD_CHROME}>
    <RoomCardInner {...props} />
  </div>
));

type RoomFilter = 'all' | 'owned' | 'joined' | 'unread';

const DashboardScreen: React.FC<DashboardScreenProps> = ({ user, onJoinRoom, onLogout }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPin, setNewRoomPin] = useState('');
  const [creating, setCreating] = useState(false);
  const [unreadRooms, setUnreadRooms] = useState<Set<string>>(new Set());
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [googleAvatarUrl, setGoogleAvatarUrl] = useState('');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [tempAvatarUrl, setTempAvatarUrl] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [roomToDelete, setRoomToDelete] = useState<{name: string, key: string, isOwner: boolean} | null>(null);
  const [isDeletingRoom, setIsDeletingRoom] = useState(false);

  const [revealedPins, setRevealedPins] = useState<Set<string>>(new Set());

  // Search / filter / favorites (all client-side, no backend).
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RoomFilter>('all');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // Dashboard theme toggle. The boot script in index.html sets the initial class
  // from localStorage; we seed from the live DOM and keep both in sync (same key
  // the rest of the app reads).
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  // Drag-to-reorder (dnd-kit). Mouse: click-drag (8px). Touch: long-press 250ms
  // then drag (a quick swipe under that still scrolls the list). Keyboard: focus
  // a card + Space to pick up, arrows to move, Space to drop.
  const [activeDragKey, setActiveDragKey] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const initData = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
          const meta = authUser.user_metadata || {};
          const finalName = meta.display_name || meta.full_name || meta.name || localStorage.getItem('chatUsername') || user.email?.split('@')[0] || 'User';
          const original = meta.picture || meta.avatar_url || `https://ui-avatars.com/api/?name=${finalName}&background=random`;
          setGoogleAvatarUrl(original);
          const finalAvatar = meta.custom_avatar || localStorage.getItem('chatAvatarURL') || original;
          setDisplayName(finalName);
          setAvatarUrl(finalAvatar);
          setTempAvatarUrl(finalAvatar);
          localStorage.setItem('chatUsername', finalName);
          localStorage.setItem('chatAvatarURL', finalAvatar);
      }

      // Restore favorites (guard against corrupted localStorage).
      try {
        const rawFav = localStorage.getItem(`roomFav_${user.uid}`);
        if (rawFav) { const p = JSON.parse(rawFav); if (Array.isArray(p)) setFavorites(new Set(p)); }
      } catch { /* ignore corrupt */ }

      try {
        // Independent reads in parallel (was a sequential waterfall).
        const [{ data: createdRooms, error: createdError }, { data: subscriptions, error: subError }] = await Promise.all([
          supabase.from('rooms').select('*').eq('created_by', user.uid),
          supabase.from('subscribers').select('room_key').eq('uid', user.uid),
        ]);
        if (createdError) throw createdError;
        if (subError) throw subError;

        let joinedRooms: Room[] = [];
        if (subscriptions && subscriptions.length > 0) {
            const keys = subscriptions.map(s => s.room_key);
            const { data: foundJoinedRooms, error: joinedRoomsError } = await supabase.from('rooms').select('*').in('room_key', keys);
            if (joinedRoomsError) throw joinedRoomsError;
            joinedRooms = foundJoinedRooms || [];
        }

        const roomMap = new Map<string, Room>();
        (createdRooms || []).forEach(r => roomMap.set(r.room_key, r));
        (joinedRooms || []).forEach(r => roomMap.set(r.room_key, r));

        const allRooms = Array.from(roomMap.values());

        // Custom drag order (guard against corrupted localStorage so a bad value
        // can't blank the dashboard), and prune saved keys whose rooms are gone.
        let orderKeys: string[] | null = null;
        const savedOrder = localStorage.getItem(`roomOrder_${user.uid}`);
        if (savedOrder) { try { const p = JSON.parse(savedOrder); if (Array.isArray(p)) orderKeys = p; } catch { /* ignore corrupt */ } }
        if (orderKeys) {
            const order = orderKeys;
            allRooms.sort((a, b) => {
                const indexA = order.indexOf(a.room_key);
                const indexB = order.indexOf(b.room_key);
                if (indexA === -1 && indexB === -1) return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                if (indexA === -1) return 1;
                if (indexB === -1) return -1;
                return indexA - indexB;
            });
            const liveKeys = new Set(allRooms.map(r => r.room_key));
            const pruned = order.filter(k => liveKeys.has(k));
            if (pruned.length !== order.length) localStorage.setItem(`roomOrder_${user.uid}`, JSON.stringify(pruned));
        } else {
            allRooms.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        }

        setRooms(allRooms);
        checkUnreadMessages(allRooms);
      } catch (error) {
        console.error('Error fetching rooms:', error);
      } finally {
        setLoadingRooms(false);
      }
    };
    initData();
  }, [user.uid, user.email]);

  // Keep a live ref of rooms so the realtime handler always sees the current
  // list WITHOUT re-subscribing the channel on every rooms change (drag/unread).
  const roomsRef = useRef(rooms);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);

  useEffect(() => {
    const channel = supabase.channel('dashboard-notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
                const newMsg = payload.new as { uid?: string; type?: string; room_key?: string };
                if (newMsg.uid === user.uid || newMsg.type === 'system' || !newMsg.room_key) return;
                if (roomsRef.current.some(r => r.room_key === newMsg.room_key)) {
                    setUnreadRooms(prev => new Set(prev).add(newMsg.room_key!));
                }
            }
        ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user.uid]);

  const checkUnreadMessages = async (currentRooms: Room[]) => {
      if (currentRooms.length === 0) return;
      try {
          // One round-trip for every room (was N+1: a query per room). The RPC
          // returns max(created_at) per room_key, gated by membership RLS.
          const { data, error } = await supabase.rpc('room_last_activity', {
              p_room_keys: currentRooms.map(r => r.room_key),
          });
          if (error) throw error;

          const lastActivity = new Map<string, number>(
              (data || []).map((r: { room_key: string; last_message_at: string }) =>
                  [r.room_key, new Date(r.last_message_at).getTime()])
          );

          const newUnreadSet = new Set<string>();
          for (const room of currentRooms) {
              const latest = lastActivity.get(room.room_key);
              if (latest === undefined) continue;
              const stored = localStorage.getItem(`lastRead_${room.room_key}`);
              if (stored === null) {
                  // First time we see this room on this device: baseline to its
                  // current latest (SERVER time) so pre-existing history isn't
                  // flagged, and the comparison stays server-vs-server (no client
                  // clock skew → no phantom unread).
                  localStorage.setItem(`lastRead_${room.room_key}`, String(latest));
                  continue;
              }
              if (latest > parseInt(stored)) newUnreadSet.add(room.room_key);
          }
          setUnreadRooms(newUnreadSet);
      } catch (err) {
          console.error('Error checking unread messages', err);
      }
  };

  const handleSaveProfile = async () => {
      if (!displayName.trim()) { alert("Display name cannot be empty"); return; }
      setIsSavingProfile(true);
      try {
          const updates = { display_name: displayName, full_name: displayName, custom_avatar: tempAvatarUrl, avatar_url: tempAvatarUrl };
          const { error } = await supabase.auth.updateUser({ data: updates });
          if (error) throw error;
          setAvatarUrl(tempAvatarUrl);
          localStorage.setItem('chatUsername', displayName);
          localStorage.setItem('chatAvatarURL', tempAvatarUrl);
          setIsEditingProfile(false);
          setShowLinkInput(false);
      } catch (e: any) {
          setTempAvatarUrl(avatarUrl); // revert the unsaved preview on failure
          alert("Failed to update profile: " + e.message);
      } finally {
          setIsSavingProfile(false);
      }
  };

  // Fall back to a generated avatar if a custom/google/storage image fails to load.
  const onAvatarError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName || 'User')}&background=random`;
      if (img.src !== fallback) { img.onerror = null; img.src = fallback; }
  }, [displayName]);

  const handleGenerateRandomAvatar = () => {
      const seed = Math.random().toString(36).substring(7);
      setTempAvatarUrl(`https://api.dicebear.com/9.x/bottts/svg?seed=${seed}`);
  };

  const handleRestoreGoogleAvatar = () => { if (googleAvatarUrl) setTempAvatarUrl(googleAvatarUrl); };

  const handleLinkAvatar = () => {
      const url = linkInput.trim();
      try {
          const u = new URL(url);
          if (u.protocol !== 'https:') { alert('Please use an https:// image URL.'); return; }
      } catch { alert('Please enter a valid image URL.'); return; }
      setTempAvatarUrl(url);
      setShowLinkInput(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || !e.target.files[0]) return;
      const file = e.target.files[0];
      try {
          const compressed = await compressImage(file);
          const fileExt = compressed.name.split('.').pop();
          const fileName = `avatar_${Date.now()}.${fileExt}`;
          const filePath = `profiles/${user.uid}/${fileName}`;
          const { error: uploadError } = await supabase.storage.from('attachments').upload(filePath, compressed);
          if (uploadError) throw uploadError;
          const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(filePath);
          setTempAvatarUrl(publicUrl);
      } catch (err: any) {
          alert("Failed to upload image.");
      }
  };

  const handleJoin = useCallback((room: Room) => {
    localStorage.setItem(`lastRead_${room.room_key}`, Date.now().toString());
    setUnreadRooms(prev => { const next = new Set(prev); next.delete(room.room_key); return next; });
    onJoinRoom({ username: displayName, avatarURL: avatarUrl, roomName: room.room_name, pin: room.pin, roomKey: room.room_key });
  }, [displayName, avatarUrl, onJoinRoom]);

  const onRequestDeleteRoom = useCallback((roomName: string, roomKey: string, createdBy: string) => {
      setRoomToDelete({ name: roomName, key: roomKey, isOwner: createdBy === user.uid });
  }, [user.uid]);

  // Star toggle → pin a room to the top of the list. Persisted per user.
  const toggleFavorite = useCallback((e: React.MouseEvent, key: string) => {
      e.stopPropagation();
      setFavorites(prev => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key); else next.add(key);
          try { localStorage.setItem(`roomFav_${user.uid}`, JSON.stringify([...next])); } catch { /* ignore */ }
          return next;
      });
  }, [user.uid]);

  const toggleTheme = useCallback(() => {
      setIsDark(prev => {
          const next = !prev;
          document.documentElement.classList.toggle('dark', next);
          try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
          document.querySelector("meta[name='theme-color']")?.setAttribute('content', next ? '#020617' : '#f8fafc');
          return next;
      });
  }, []);

  // "Quick chat" preset: prefill a random room name + 4-digit PIN and open the
  // form so the owner can SEE/copy the PIN (the invite secret) before entering.
  const handleQuickChat = useCallback(() => {
      const adjectives = ['swift', 'cosmic', 'hidden', 'silent', 'golden', 'lunar', 'crimson', 'neon', 'velvet', 'arctic'];
      const nouns = ['fox', 'harbor', 'echo', 'nebula', 'garden', 'circuit', 'meadow', 'falcon', 'lagoon', 'ember'];
      const a = adjectives[Math.floor(Math.random() * adjectives.length)];
      const n = nouns[Math.floor(Math.random() * nouns.length)];
      setNewRoomName(`${a}-${n}-${Math.floor(100 + Math.random() * 900)}`);
      setNewRoomPin(String(Math.floor(1000 + Math.random() * 9000)));
      setShowCreate(true);
  }, []);

  // Keyboard shortcuts: ⌘/Ctrl+K focus search, ⌘/Ctrl+N open create, Esc
  // closes the create form (or clears search if the form is already closed).
  const showCreateRef = useRef(showCreate);
  useEffect(() => { showCreateRef.current = showCreate; }, [showCreate]);
  const queryRef = useRef(query);
  useEffect(() => { queryRef.current = query; }, [query]);
  useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
          const mod = e.metaKey || e.ctrlKey;
          if (mod && e.key.toLowerCase() === 'k') {
              e.preventDefault();
              searchRef.current?.focus();
              searchRef.current?.select();
          } else if (mod && e.key.toLowerCase() === 'n') {
              e.preventDefault();
              setShowCreate(true);
          } else if (e.key === 'Escape') {
              if (showCreateRef.current) setShowCreate(false);
              else if (queryRef.current) setQuery('');
          }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleConfirmDeleteRoom = async () => {
    if (!roomToDelete) return;
    setIsDeletingRoom(true);
    const { key, isOwner } = roomToDelete;
    try {
        if (!isOwner) {
             // "Leave room": drop only our own membership row.
             await supabase.from('subscribers').delete().eq('room_key', key).eq('uid', user.uid);
        } else {
             // ORDER MATTERS under RLS: delete messages and the room row WHILE we
             // are still a member AND still the owner — both the is_member() check
             // (rooms DELETE) and the "room owner" check (messages DELETE) read rows
             // we're about to remove. Deleting our subscriber row first would drop
             // membership and silently match 0 rows on the room delete, orphaning it.
             const { error: msgErr } = await supabase.from('messages').delete().eq('room_key', key);
             if (msgErr) throw msgErr;
             const { error: roomErr } = await supabase.from('rooms').delete().eq('room_key', key);
             if (roomErr) throw roomErr;
             await supabase.from('subscribers').delete().eq('room_key', key); // own row (RLS-scoped)

             // Best-effort storage cleanup, paginated (list() is capped per call).
             // Never fail the whole delete on this — room + messages are already gone.
             try {
                 const toRemove: string[] = [];
                 let offset = 0;
                 const PAGE = 100;
                 for (;;) {
                     const { data: files } = await supabase.storage.from('attachments').list(key, { limit: PAGE, offset });
                     if (!files || files.length === 0) break;
                     toRemove.push(...files.map(f => `${key}/${f.name}`));
                     if (files.length < PAGE) break;
                     offset += PAGE;
                 }
                 if (toRemove.length > 0) await supabase.storage.from('attachments').remove(toRemove);
             } catch (storageErr) {
                 console.warn('Room storage cleanup failed (non-fatal):', storageErr);
             }
        }
        setRooms(prev => prev.filter(r => r.room_key !== key));
        // Prune the deleted key from the saved drag order so it can't linger forever.
        try {
            const raw = localStorage.getItem(`roomOrder_${user.uid}`);
            if (raw) localStorage.setItem(`roomOrder_${user.uid}`, JSON.stringify((JSON.parse(raw) as string[]).filter(k => k !== key)));
        } catch { /* ignore */ }
        // Also drop it from favorites so a stale star can't linger.
        setFavorites(prev => {
            if (!prev.has(key)) return prev;
            const next = new Set(prev); next.delete(key);
            try { localStorage.setItem(`roomFav_${user.uid}`, JSON.stringify([...next])); } catch { /* ignore */ }
            return next;
        });
    } catch (e: any) {
        alert('Operation failed: ' + (e.message || "Unknown error"));
    } finally {
        setIsDeletingRoom(false);
        setRoomToDelete(null);
    }
  };

  const handleCreateOrJoinRoom = async (e: React.FormEvent) => {
      e.preventDefault();
      const roomName = newRoomName.trim();
      const pin = newRoomPin.trim();
      if (!roomName || !pin) return;
      setCreating(true);
      const roomKey = generateRoomKey(pin, roomName);
      try {
           // Create-or-join + PIN verification + membership all happen in one
           // server-side RPC (the only way to gain access under the new RLS).
           const { data: room, error } = await joinOrCreateRoom({
               roomKey,
               roomName,
               pin,
               username: displayName,
           });
           if (error) {
               if (error.code === 'WRONG_PIN') alert('Wrong PIN for this room.');
               else alert('Failed to enter room. Please try again.');
               return;
           }
           if (room) {
               localStorage.setItem(`lastRead_${room.room_key}`, Date.now().toString());
               setNewRoomName('');
               setNewRoomPin('');
               setShowCreate(false);
               onJoinRoom({ username: displayName, avatarURL: avatarUrl, roomName: room.room_name, pin, roomKey: room.room_key });
           }
      } catch (e: any) {
          alert("Failed to create or join room: " + (e?.message || 'Unknown error'));
      } finally {
          setCreating(false);
      }
  };

  // --- PIN Visibility Toggle ---
  const togglePinVisibility = useCallback((e: React.MouseEvent, roomKey: string) => {
    e.stopPropagation();
    setRevealedPins(prev => {
        const next = new Set(prev);
        if (next.has(roomKey)) next.delete(roomKey);
        else next.add(roomKey);
        return next;
    });
  }, []);

  // --- Drag-to-reorder handlers (dnd-kit) ---
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragKey(String(event.active.id));
    if ('vibrate' in navigator) navigator.vibrate(40);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragKey(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRooms((prev) => {
      const oldIndex = prev.findIndex((r) => r.room_key === active.id);
      const newIndex = prev.findIndex((r) => r.room_key === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      localStorage.setItem(`roomOrder_${user.uid}`, JSON.stringify(next.map((r) => r.room_key)));
      return next;
    });
  };

  const handleDragCancel = () => setActiveDragKey(null);

  const activeRoom = activeDragKey ? rooms.find((r) => r.room_key === activeDragKey) ?? null : null;

  // Drag is only enabled when the displayed order == the saved canonical order:
  // no search, no filter chip, no pinned favorites. Otherwise we render static
  // cards so a drag can't desync from what's on screen.
  const dragEnabled = query.trim() === '' && filter === 'all' && favorites.size === 0;

  const displayRooms = useMemo(() => {
    if (dragEnabled) return rooms;
    const q = query.trim().toLowerCase();
    const filtered = rooms.filter((r) => {
      if (q && !r.room_name.toLowerCase().includes(q)) return false;
      if (filter === 'owned' && r.created_by !== user.uid) return false;
      if (filter === 'joined' && r.created_by === user.uid) return false;
      if (filter === 'unread' && !unreadRooms.has(r.room_key)) return false;
      return true;
    });
    // Favorites float to the top, preserving relative order within each group.
    const favs = filtered.filter((r) => favorites.has(r.room_key));
    const rest = filtered.filter((r) => !favorites.has(r.room_key));
    return [...favs, ...rest];
  }, [dragEnabled, rooms, query, filter, favorites, unreadRooms, user.uid]);

  return (
    <>
    {roomToDelete && (
        <RoomDeleteToast
            roomName={roomToDelete.name}
            isOwner={roomToDelete.isOwner}
            onConfirm={handleConfirmDeleteRoom}
            onCancel={() => setRoomToDelete(null)}
            isDeleting={isDeletingRoom}
        />
    )}

    <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white transition-colors duration-300 pt-[env(safe-area-inset-top)]">
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            <header className="flex justify-between items-center mb-8 pb-6 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                    <img src="https://konskall.github.io/incognitochat/favicon-96x96.png" alt="Incognito Chat" width={40} height={40} className="w-10 h-10 rounded-xl shadow-lg shadow-blue-500/20"/>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Welcome back to your secure space</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={toggleTheme} aria-label="Toggle light/dark theme" title="Toggle light/dark" className="p-2.5 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm">
                        {isDark ? <Sun size={16} /> : <Moon size={16} />}
                    </button>
                    <button onClick={onLogout} aria-label="Logout" className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm">
                        <LogOut size={16} />
                        <span className="hidden sm:inline">Logout</span>
                    </button>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-4 xl:col-span-3 space-y-6">
                    <div className="bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-950 rounded-2xl shadow-lg shadow-slate-200/50 dark:shadow-none border border-slate-200/60 dark:border-slate-800 p-5 transition-all duration-300 relative overflow-hidden group">
                        <div className="absolute -top-10 -right-10 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl pointer-events-none group-hover:bg-blue-500/20 transition-all duration-500"></div>
                        {isEditingProfile ? (
                            <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300 relative z-10">
                                <div className="flex flex-col items-center gap-4">
                                    <div className="relative group/edit-avatar">
                                        <img src={tempAvatarUrl} alt="Preview" width={96} height={96} loading="lazy" onError={onAvatarError} className="w-24 h-24 rounded-full object-cover border-4 border-white dark:border-slate-800 shadow-md ring-1 ring-slate-100 dark:ring-slate-700"/>
                                        <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover/edit-avatar:opacity-100 transition-opacity">
                                            <span className="text-white text-xs font-bold">Preview</span>
                                        </div>
                                    </div>
                                    <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full text-center px-3 py-2 border-b-2 border-slate-200 dark:border-slate-700 bg-transparent focus:border-blue-500 outline-none transition-all font-bold text-lg text-slate-800 dark:text-white placeholder:font-normal" placeholder="Display Name"/>
                                </div>
                                <div className="grid grid-cols-4 gap-2">
                                    <label className="flex flex-col items-center justify-center gap-1 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Upload Photo">
                                        <Upload size={18} className="text-blue-600 dark:text-blue-400" />
                                        <span className="text-[9px] font-bold text-slate-500 uppercase">Upload</span>
                                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
                                    </label>
                                    <button onClick={handleGenerateRandomAvatar} className="flex flex-col items-center justify-center gap-1 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Random Avatar">
                                        <RefreshCw size={18} className="text-purple-600 dark:text-purple-400" />
                                        <span className="text-[9px] font-bold text-slate-500 uppercase">Random</span>
                                    </button>
                                    <button onClick={() => setShowLinkInput(!showLinkInput)} className="flex flex-col items-center justify-center gap-1 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Link URL">
                                        <LinkIcon size={18} className="text-orange-600 dark:text-orange-400" />
                                        <span className="text-[9px] font-bold text-slate-500 uppercase">Link</span>
                                    </button>
                                    <button onClick={handleRestoreGoogleAvatar} className="flex flex-col items-center justify-center gap-1 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Restore Original">
                                        <RotateCcw size={18} className="text-green-600 dark:text-green-400" />
                                        <span className="text-[9px] font-bold text-slate-500 uppercase">Reset</span>
                                    </button>
                                </div>
                                {showLinkInput && (
                                    <div className="flex relative animate-in slide-in-from-top-2 fade-in">
                                        <input type="text" value={linkInput} onChange={(e) => setLinkInput(e.target.value)} placeholder="https://image-url.png" className="w-full pl-3 pr-9 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"/>
                                        <button onClick={handleLinkAvatar} aria-label="Use image URL" className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded hover:bg-blue-200 transition">
                                            <ArrowRight size={12} />
                                        </button>
                                    </div>
                                )}
                                <div className="flex gap-3 pt-2">
                                    <button onClick={() => { setIsEditingProfile(false); setShowLinkInput(false); }} className="flex-1 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition">Cancel</button>
                                    <button onClick={handleSaveProfile} disabled={isSavingProfile} className="flex-1 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg shadow-md hover:bg-blue-700 transition flex items-center justify-center gap-2">{isSavingProfile ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}Save Changes</button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-5 animate-in fade-in zoom-in-95 duration-300 relative z-10">
                                <div className="relative flex-shrink-0 group/avatar">
                                    <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full opacity-0 group-hover/avatar:opacity-100 transition duration-500 blur-sm"></div>
                                    <img src={avatarUrl} alt="Profile" width={80} height={80} loading="lazy" onError={onAvatarError} className="relative w-20 h-20 rounded-full object-cover border-4 border-white dark:border-slate-900 shadow-lg"/>
                                    <button onClick={() => { setTempAvatarUrl(avatarUrl); setIsEditingProfile(true); }} className="absolute bottom-0 right-0 p-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-full shadow-md border border-slate-100 dark:border-slate-700 hover:text-blue-600 hover:scale-110 transition-all z-20" title="Edit Profile"><Edit2 size={12} /></button>
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col justify-center h-20">
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white truncate tracking-tight" title={displayName}>{displayName}</h3>
                                    <div className="flex items-center gap-2 mt-1 text-slate-500 dark:text-slate-400">
                                        <div className="p-1 bg-slate-100 dark:bg-slate-800 rounded-md"><Mail size={10} className="flex-shrink-0" /></div>
                                        <span className="text-xs font-medium truncate opacity-80" title={user.email}>{user.email}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="lg:col-span-8 xl:col-span-9 space-y-6">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                         <div className="p-6">
                            {!showCreate ? (
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Join or Create Room</h3>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">Enter a room name and PIN to connect</p>
                                    </div>
                                    <div className="w-full sm:w-auto flex gap-2">
                                        <button onClick={handleQuickChat} title="Generate a random room name + PIN" className="flex-1 sm:flex-none px-4 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl transition-all flex items-center justify-center gap-2"><Zap size={18} className="text-amber-500" />Quick chat</button>
                                        <button onClick={() => setShowCreate(true)} className="flex-1 sm:flex-none px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2"><LogIn size={20} />Enter / Create</button>
                                    </div>
                                </div>
                            ) : (
                                <form onSubmit={handleCreateOrJoinRoom} className="space-y-4 animate-in fade-in slide-in-from-top-2">
                                    <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-4">
                                        <h3 className="font-semibold text-lg">Room Access</h3>
                                        <button type="button" onClick={() => setShowCreate(false)} aria-label="Close" className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition"><X size={20} /></button>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Room Name</label>
                                            <input type="text" value={newRoomName} onChange={e => setNewRoomName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none transition" placeholder="e.g. Project Alpha" required/>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Access PIN</label>
                                            <input type="text" value={newRoomPin} onChange={e => setNewRoomPin(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none transition" placeholder="Secret Key" required/>
                                        </div>
                                    </div>
                                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                                        <p className="text-xs text-slate-500 italic">If the room exists, you will join it. Otherwise, a new room will be created.</p>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={handleQuickChat} title="Generate a random room name + PIN" className="px-4 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl transition flex items-center gap-2"><Zap size={16} className="text-amber-500" />Random</button>
                                            <button type="submit" disabled={creating} className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2">{creating ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}Enter Room</button>
                                        </div>
                                    </div>
                                </form>
                            )}
                         </div>
                    </div>

                    <div>
                        <div className="flex flex-col gap-3 mb-4 px-1">
                            <div className="flex items-baseline justify-between gap-3">
                                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Your Rooms</h3>
                                {dragEnabled && rooms.length > 1 && (
                                    <span className="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:inline">Drag to reorder · long-press on touch</span>
                                )}
                            </div>
                            {rooms.length > 0 && (
                                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                                    <div className="relative flex-1 min-w-0">
                                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                        <input
                                            ref={searchRef}
                                            type="text"
                                            value={query}
                                            onChange={(e) => setQuery(e.target.value)}
                                            placeholder="Search rooms…"
                                            aria-label="Search rooms"
                                            className="w-full pl-9 pr-9 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 outline-none transition"
                                        />
                                        {query && (
                                            <button onClick={() => { setQuery(''); searchRef.current?.focus(); }} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {(['all', 'owned', 'joined', 'unread'] as const).map((key) => (
                                            <button
                                                key={key}
                                                onClick={() => setFilter(key)}
                                                aria-pressed={filter === key}
                                                className={`shrink-0 px-3 py-1.5 text-xs font-bold rounded-lg border capitalize transition ${filter === key ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-blue-300'}`}
                                            >
                                                {key}{key === 'unread' && unreadRooms.size > 0 ? ` (${unreadRooms.size})` : ''}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        {loadingRooms ? (
                            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-400" size={32} /></div>
                        ) : rooms.length === 0 ? (
                            <div className="bg-gradient-to-br from-blue-50 to-slate-50 dark:from-slate-900 dark:to-slate-950 rounded-2xl p-8 sm:p-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800">
                                <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-4">
                                    <LogIn className="text-blue-500" size={26} />
                                </div>
                                <h4 className="text-lg font-bold text-slate-800 dark:text-slate-100">Welcome to your dashboard</h4>
                                <p className="text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto text-sm">Create a private room or join one with its name + PIN. Share the PIN to invite others — only people with it can read along.</p>
                                <div className="flex flex-col sm:flex-row gap-2 justify-center mt-5">
                                    <button onClick={handleQuickChat} className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold flex items-center justify-center gap-2 transition"><Zap size={18} className="text-amber-500" />Quick chat</button>
                                    <button onClick={() => setShowCreate(true)} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition"><LogIn size={18} />Create or Join</button>
                                </div>
                            </div>
                        ) : displayRooms.length === 0 ? (
                            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-10 text-center border-2 border-dashed border-slate-200 dark:border-slate-800">
                                <p className="text-slate-500 dark:text-slate-400">No rooms match your search or filter.</p>
                                <button onClick={() => { setQuery(''); setFilter('all'); }} className="text-blue-500 font-semibold mt-2 hover:underline">Clear filters</button>
                            </div>
                        ) : dragEnabled ? (
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragStart={handleDragStart}
                                onDragEnd={handleDragEnd}
                                onDragCancel={handleDragCancel}
                            >
                                <SortableContext items={rooms.map((r) => r.room_key)} strategy={rectSortingStrategy}>
                                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
                                        {rooms.map((room) => (
                                            <SortableRoomCard
                                                key={room.room_key}
                                                room={room}
                                                userUid={user.uid}
                                                unread={unreadRooms.has(room.room_key)}
                                                revealed={revealedPins.has(room.room_key)}
                                                isFavorite={favorites.has(room.room_key)}
                                                onJoin={handleJoin}
                                                onRequestDelete={onRequestDeleteRoom}
                                                onTogglePin={togglePinVisibility}
                                                onToggleFav={toggleFavorite}
                                            />
                                        ))}
                                    </div>
                                </SortableContext>
                                <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
                                    {activeRoom ? (
                                        <div className="room-card bg-white dark:bg-slate-900 p-5 rounded-2xl border border-blue-500 ring-2 ring-blue-500/50 shadow-2xl shadow-blue-500/30 rotate-2 scale-[1.03] cursor-grabbing select-none">
                                            <RoomCardInner
                                                room={activeRoom}
                                                userUid={user.uid}
                                                unread={unreadRooms.has(activeRoom.room_key)}
                                                revealed={revealedPins.has(activeRoom.room_key)}
                                                isFavorite={favorites.has(activeRoom.room_key)}
                                                onJoin={() => {}}
                                                onRequestDelete={() => {}}
                                                onTogglePin={() => {}}
                                                onToggleFav={() => {}}
                                            />
                                        </div>
                                    ) : null}
                                </DragOverlay>
                            </DndContext>
                        ) : (
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
                                {displayRooms.map((room) => (
                                    <StaticRoomCard
                                        key={room.room_key}
                                        room={room}
                                        userUid={user.uid}
                                        unread={unreadRooms.has(room.room_key)}
                                        revealed={revealedPins.has(room.room_key)}
                                        isFavorite={favorites.has(room.room_key)}
                                        onJoin={handleJoin}
                                        onRequestDelete={onRequestDeleteRoom}
                                        onTogglePin={togglePinVisibility}
                                        onToggleFav={toggleFavorite}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    </div>
    </>
  );
};

export default DashboardScreen;
