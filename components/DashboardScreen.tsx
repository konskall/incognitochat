
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase, joinOrCreateRoom } from '../services/supabase';
import { User, ChatConfig, Room, Presence } from '../types';
import { generateRoomKey, compressImage, decryptMessage, beginThemeTransition } from '../utils/helpers';
import {
  LogOut, Trash2, ArrowRight, Loader2,
  Upload, RotateCcw,
  RefreshCw, Save, X, Edit2, Mail, LogIn, Link as LinkIcon, AlertCircle, Eye, EyeOff, GripVertical,
  Search, Star, Sun, Moon, MoreVertical, Bell, BellOff, Archive, ArchiveRestore, Clock, Pencil,
  Check, CheckSquare, MessageSquarePlus, Shuffle,
  type LucideIcon
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

// Per-room overview from the room_overview RPC (decrypted preview held client-side).
type Overview = {
  unread: number;
  lastAt: string | null;
  lastText: string;        // already decrypted + truncated
  lastUser: string | null;
  lastType: string;
  hasAttachment: boolean;
  hasLocation: boolean;
};
type RoomSetting = { archived: boolean; muted: boolean };
type RoomFilter = 'all' | 'owned' | 'joined' | 'unread' | 'archived';

// Shared props for the card body, the sortable wrapper and the static view.
type RoomCardProps = {
  room: Room; userUid: string;
  unread: number; muted: boolean; archived: boolean; overview?: Overview;
  revealed: boolean; isFavorite: boolean;
  selectMode: boolean; selected: boolean; online?: Presence[];
  onJoin: (r: Room) => void;
  onOpenActions: (r: Room) => void;
  onTogglePin: (e: React.MouseEvent, key: string) => void;
  onToggleFav: (e: React.MouseEvent, key: string) => void;
  onToggleSelect: (key: string) => void;
};

const CARD_CHROME = "room-card group bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border flex flex-col justify-between relative overflow-hidden select-none border-slate-200 dark:border-slate-800 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-800 transition-shadow";

// Compact "time ago". Uses the client clock for display only (never for unread
// comparisons — those are server-vs-server via the RPC).
const formatRelative = (iso: string | null): string => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 45000) return 'just now';
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(t).toLocaleDateString();
};

const previewLabel = (o?: Overview): string => {
  if (!o || !o.lastAt) return 'No messages yet';
  if (o.lastType === 'poll') return '📊 Poll';
  if (o.hasLocation) return '📍 Location';
  if (o.hasAttachment && !o.lastText) return '📎 Attachment';
  return o.lastText || '…';
};

const ttlLabel = (secs?: number | null): string | null => {
  if (!secs || secs <= 0) return null;
  if (secs % 86400 === 0) return `${secs / 86400}d`;
  if (secs % 3600 === 0) return `${secs / 3600}h`;
  return `${Math.max(1, Math.round(secs / 60))}m`;
};

const RoomDeleteToast: React.FC<{
    roomName: string;
    isOwner: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    isDeleting: boolean;
}> = ({ roomName, isOwner, onConfirm, onCancel, isDeleting }) => {
    return createPortal(
        <div className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-auto z-[110] animate-in slide-in-from-bottom-4 fade-in duration-300">
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

const SheetBtn: React.FC<{ icon: LucideIcon; label: string; danger?: boolean; onClick: () => void }> =
  ({ icon: Icon, label, danger, onClick }) => (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition text-left ${danger ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
      <Icon size={18} />
      <span>{label}</span>
    </button>
  );

// Per-room action sheet (bottom sheet on mobile, centered card on desktop).
// Hosts Rename (owner), Mute/Unmute, Archive/Unarchive and Delete/Leave so the
// card stays clean. Portal-rendered so it's never clipped by the card overflow.
const RoomActionsSheet: React.FC<{
  room: Room; isOwner: boolean; muted: boolean; archived: boolean;
  onClose: () => void;
  onRename: (key: string, name: string) => Promise<void>;
  onToggleMute: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}> = ({ room, isOwner, muted, archived, onClose, onRename, onToggleMute, onToggleArchive, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(room.display_name || room.room_name);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    await onRename(room.room_key, name.trim());
    setBusy(false);
    onClose();
  };
  return createPortal(
    <div onClick={onClose} className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-sm bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 pb-[env(safe-area-inset-bottom)]">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <h3 className="font-bold text-slate-800 dark:text-white truncate">{room.display_name || room.room_name}</h3>
          <button onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition shrink-0"><X size={18} /></button>
        </div>
        {editing ? (
          <div className="p-4 space-y-3">
            <label className="block text-xs font-bold uppercase text-slate-500">New display name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none transition"
            />
            <p className="text-[11px] text-slate-400">Only changes the label. The PIN and invite link stay the same.</p>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditing(false)} className="flex-1 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition">Cancel</button>
              <button onClick={save} disabled={busy || !name.trim()} className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl shadow-md hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2">{busy ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}Save</button>
            </div>
          </div>
        ) : (
          <div className="p-2">
            {isOwner && <SheetBtn icon={Pencil} label="Rename room" onClick={() => setEditing(true)} />}
            <SheetBtn icon={muted ? Bell : BellOff} label={muted ? 'Unmute notifications' : 'Mute notifications'} onClick={() => { onToggleMute(); onClose(); }} />
            <SheetBtn icon={archived ? ArchiveRestore : Archive} label={archived ? 'Unarchive' : 'Archive'} onClick={() => { onToggleArchive(); onClose(); }} />
            <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
            <SheetBtn icon={isOwner ? Trash2 : LogOut} label={isOwner ? 'Delete room (for everyone)' : 'Leave room'} danger onClick={() => { onClose(); onDelete(); }} />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

// Presentational card body, shared by the sortable item and the drag overlay.
const RoomCardInner = React.memo(({ room, userUid, unread, muted, archived, overview, revealed, isFavorite, selectMode, selected, online, onJoin, onOpenActions, onTogglePin, onToggleFav }: RoomCardProps) => {
  const isOwner = room.created_by === userUid;
  const name = room.display_name || room.room_name;
  const showUnread = unread > 0 && !muted;
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const ttl = ttlLabel(room.auto_delete_seconds);
  return (
    <>
      <div className="mb-3 relative z-10">
        <div className="flex justify-between items-start mb-2 gap-2">
          <h4 className="font-bold text-base text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5 min-w-0 flex-1">
            <GripVertical size={16} className="text-slate-300 dark:text-slate-600 shrink-0" />
            <span className="truncate" title={name}>{name}</span>
            {showUnread && (
              <span className="shrink-0 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">{unread > 9 ? '9+' : unread}</span>
            )}
            {muted && <BellOff size={13} className="text-slate-400 shrink-0" />}
          </h4>
          {selectMode ? (
            <span className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition ${selected ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'}`} aria-hidden>
              {selected && <Check size={14} />}
            </span>
          ) : (
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
              <button onPointerDown={stop} onClick={(e) => { e.stopPropagation(); onOpenActions(room); }} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" title="Room actions" aria-label="Room actions">
                <MoreVertical size={16} />
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <div onPointerDown={stop} onClick={(e) => { e.stopPropagation(); onTogglePin(e, room.room_key); }} className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md font-mono border border-slate-200 dark:border-slate-700 hover:border-blue-300 transition-colors cursor-pointer select-none" title="Click to reveal PIN">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">PIN:</span>
            <span className="font-bold text-slate-700 dark:text-blue-400 min-w-[32px] text-center">{revealed ? room.pin : '••••'}</span>
            {revealed ? <EyeOff size={12} className="text-blue-500" /> : <Eye size={12} className="text-slate-400" />}
          </div>
          {isOwner
            ? <span className="text-blue-500 font-medium">Owner</span>
            : <span className="text-emerald-500 font-medium">Joined</span>}
          {ttl && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium" title="Auto-deletes after this much inactivity">
              <Clock size={11} />{ttl}
            </span>
          )}
          {archived && <span className="flex items-center gap-1 text-slate-400"><Archive size={11} />Archived</span>}
          {online && online.length > 0 && (
            <span className="flex items-center gap-1.5" title={`${online.length} online now`}>
              <span className="flex -space-x-1.5">
                {online.slice(0, 3).map((p, i) => (
                  <img key={(p.uid || '') + i} src={p.avatar} alt="" width={16} height={16} className="w-4 h-4 rounded-full border border-white dark:border-slate-900 object-cover bg-slate-200" />
                ))}
              </span>
              <span className="text-emerald-500 font-medium">{online.length} online</span>
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 min-w-0">
          <span className="truncate min-w-0">
            {overview?.lastUser && <span className="font-medium text-slate-600 dark:text-slate-300">{overview.lastUser}: </span>}
            {previewLabel(overview)}
          </span>
          {overview?.lastAt && <span className="shrink-0 text-slate-400 dark:text-slate-500">· {formatRelative(overview.lastAt)}</span>}
        </div>
      </div>
      {selectMode ? (
        <div className="w-full py-2.5 font-semibold rounded-xl flex items-center justify-center gap-2 text-sm border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400">
          {selected ? <><Check size={16} className="text-blue-500" />Selected</> : 'Tap to select'}
        </div>
      ) : (
        <button onPointerDown={stop} onClick={() => onJoin(room)} className={`w-full py-2.5 font-semibold rounded-xl transition flex items-center justify-center gap-2 z-10 ${showUnread ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30 group-hover:bg-red-500 group-hover:text-white group-hover:border-red-500' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 group-hover:bg-blue-600 group-hover:text-white dark:group-hover:bg-blue-600 dark:group-hover:text-white'}`}>
          Enter Room <ArrowRight size={16} />
        </button>
      )}
    </>
  );
});

// Sortable wrapper — used only when the displayed order == the saved order
// (no search/filter/favorites), so a drag can never desync from the screen.
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
      aria-label={`Room ${props.room.display_name || props.room.room_name}. Press space or long-press to reorder.`}
      className={`room-card group bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border flex flex-col justify-between relative overflow-hidden select-none touch-manipulation cursor-grab active:cursor-grabbing outline-none focus-visible:ring-2 focus-visible:ring-blue-500
        ${isDragging
          ? 'opacity-40 border-blue-400 dark:border-blue-700'
          : 'border-slate-200 dark:border-slate-800 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-800 transition-shadow'}`}
    >
      <RoomCardInner {...props} />
    </div>
  );
});

// Non-draggable card — rendered when search/filter/favorites/archive reorder
// or hide rooms, so there's no index ambiguity vs. a drag.
const StaticRoomCard = React.memo((props: RoomCardProps) => (
  <div
    className={`${CARD_CHROME}${props.selectMode ? ' cursor-pointer' : ''}${props.selected ? ' ring-2 ring-blue-500 border-blue-500 dark:border-blue-500' : ''}`}
    onClick={props.selectMode ? () => props.onToggleSelect(props.room.room_key) : undefined}
  >
    <RoomCardInner {...props} />
  </div>
));

const DashboardScreen: React.FC<DashboardScreenProps> = ({ user, onJoinRoom, onLogout }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPin, setNewRoomPin] = useState('');
  const [ephemeral, setEphemeral] = useState(false);
  const [creating, setCreating] = useState(false);
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
  const [actionsRoom, setActionsRoom] = useState<Room | null>(null);

  // Bulk multi-select.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Online members per room (read-only presence; we never track() so the
  // dashboard never appears as a phantom participant).
  const [online, setOnline] = useState<Map<string, Presence[]>>(new Map());

  const [revealedPins, setRevealedPins] = useState<Set<string>>(new Set());

  // Per-room overview (unread count + last-message preview) and user settings.
  const [overview, setOverview] = useState<Map<string, Overview>>(new Map());
  const [settings, setSettings] = useState<Map<string, RoomSetting>>(new Map());
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const overviewRef = useRef(overview);
  useEffect(() => { overviewRef.current = overview; }, [overview]);

  // Search / filter / favorites (client-side).
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RoomFilter>('all');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  const [activeDragKey, setActiveDragKey] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // One overview round-trip for all rooms: unread count + last-message preview.
  // Previews are decrypted here (PBKDF2 key is cached in helpers) so render is cheap.
  const loadOverview = useCallback(async (currentRooms: Room[]) => {
      if (currentRooms.length === 0) { setOverview(new Map()); return; }
      const items = currentRooms.map((r) => {
          const stored = localStorage.getItem(`lastRead_${r.room_key}`);
          const ms = stored ? parseInt(stored, 10) : NaN;
          // Guard against a corrupt/non-numeric value (a bad parse would otherwise
          // become ~1970 and flag the room's whole history as unread).
          return { room_key: r.room_key, since: Number.isFinite(ms) ? new Date(ms).toISOString() : null };
      });
      try {
          const { data, error } = await supabase.rpc('room_overview', { p_items: items });
          if (error) throw error;
          const byKey = new Map(currentRooms.map((r) => [r.room_key, r]));
          const next = new Map<string, Overview>();
          for (const row of (data || []) as any[]) {
              const room = byKey.get(row.room_key);
              let lastText = '';
              if (row.last_text && room) {
                  try { lastText = decryptMessage(row.last_text, room.pin, room.room_key).slice(0, 100); } catch { lastText = ''; }
              }
              // First time on this device: baseline lastRead to the latest SERVER
              // time so existing history isn't flagged unread (server-vs-server).
              const storedKey = `lastRead_${row.room_key}`;
              if (localStorage.getItem(storedKey) === null && row.last_message_at) {
                  localStorage.setItem(storedKey, String(new Date(row.last_message_at).getTime()));
              }
              next.set(row.room_key, {
                  unread: row.unread_count || 0,
                  lastAt: row.last_message_at,
                  lastText,
                  lastUser: row.last_username,
                  lastType: row.last_type || 'text',
                  hasAttachment: !!row.has_attachment,
                  hasLocation: !!row.has_location,
              });
          }
          setOverview(next);
      } catch (err) {
          console.error('Error loading room overview', err);
      }
  }, []);

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
        const [
          { data: createdRooms, error: createdError },
          { data: subscriptions, error: subError },
          { data: settingsRows },
        ] = await Promise.all([
          supabase.from('rooms').select('*').eq('created_by', user.uid),
          supabase.from('subscribers').select('room_key').eq('uid', user.uid),
          supabase.from('room_settings').select('room_key,archived,muted').eq('user_id', user.uid),
        ]);
        if (createdError) throw createdError;
        if (subError) throw subError;

        setSettings(new Map((settingsRows || []).map((s: any) => [s.room_key, { archived: !!s.archived, muted: !!s.muted }])));

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
        loadOverview(allRooms);
      } catch (error) {
        console.error('Error fetching rooms:', error);
      } finally {
        setLoadingRooms(false);
      }
    };
    initData();
  }, [user.uid, user.email, loadOverview]);

  // Keep a live ref of rooms so the realtime handler always sees the current
  // list WITHOUT re-subscribing the channel on every rooms change (drag/unread).
  const roomsRef = useRef(rooms);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);

  useEffect(() => {
    const channel = supabase.channel('dashboard-notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
                const newMsg = payload.new as { uid?: string; type?: string; room_key?: string; text?: string; username?: string; attachment?: unknown; location?: unknown; created_at?: string };
                if (newMsg.uid === user.uid || newMsg.type === 'system' || !newMsg.room_key) return;
                const room = roomsRef.current.find(r => r.room_key === newMsg.room_key);
                if (!room) return;
                let lastText = '';
                if (newMsg.text) { try { lastText = decryptMessage(newMsg.text, room.pin, room.room_key).slice(0, 100); } catch { lastText = ''; } }
                setOverview(prev => {
                    const next = new Map(prev);
                    const cur = next.get(newMsg.room_key!);
                    next.set(newMsg.room_key!, {
                        unread: (cur?.unread || 0) + 1,
                        lastAt: newMsg.created_at || new Date().toISOString(),
                        lastText,
                        lastUser: newMsg.username || cur?.lastUser || null,
                        lastType: newMsg.type || 'text',
                        hasAttachment: !!newMsg.attachment,
                        hasLocation: !!newMsg.location,
                    });
                    return next;
                });
            }
        ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user.uid]);

  // Read-only "who's online" per room. We subscribe to each room's presence
  // channel but never track() ourselves, so the dashboard is invisible to the
  // chat (no phantom participant). Capped at 15 rooms to bound open sockets;
  // keyed on the sorted room-key list so search/reorder don't churn channels.
  const presenceKeys = useMemo(
    () => rooms.map(r => r.room_key).slice(0, 15).sort().join('|'),
    [rooms]
  );
  useEffect(() => {
    const keys = presenceKeys ? presenceKeys.split('|') : [];
    if (keys.length === 0) { setOnline(new Map()); return; }
    const channels = keys.map((key) => {
      const ch = supabase.channel(`presence:${key}`, { config: { presence: { key: `dash:${user.uid}` } } });
      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState() as Record<string, unknown>;
        const members: Presence[] = [];
        for (const k in state) {
          const arr = state[k] as unknown as Presence[];
          if (arr && arr.length) members.push(arr[0]);
        }
        setOnline(prev => { const next = new Map(prev); next.set(key, members); return next; });
      }).subscribe();
      return ch;
    });
    return () => { channels.forEach(ch => supabase.removeChannel(ch)); };
  }, [presenceKeys, user.uid]);

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
    // Mark read up to the newest known SERVER message time — NEVER client
    // Date.now() (client clock skew was leaving phantom "unread" after reading).
    // ChatScreen refines this to the exact latest once messages load.
    const cur = overviewRef.current.get(room.room_key);
    const serverMs = cur?.lastAt ? new Date(cur.lastAt).getTime() : NaN;
    if (Number.isFinite(serverMs)) {
      const existing = parseInt(localStorage.getItem(`lastRead_${room.room_key}`) || '0', 10);
      if (!(existing >= serverMs)) localStorage.setItem(`lastRead_${room.room_key}`, String(serverMs));
    }
    setOverview(prev => {
      const c = prev.get(room.room_key);
      if (!c || c.unread === 0) return prev;
      const next = new Map(prev); next.set(room.room_key, { ...c, unread: 0 }); return next;
    });
    onJoinRoom({ username: displayName, avatarURL: avatarUrl, roomName: room.room_name, pin: room.pin, roomKey: room.room_key });
  }, [displayName, avatarUrl, onJoinRoom]);

  const onRequestDeleteRoom = useCallback((roomName: string, roomKey: string, createdBy: string) => {
      setRoomToDelete({ name: roomName, key: roomKey, isOwner: createdBy === user.uid });
  }, [user.uid]);

  const toggleFavorite = useCallback((e: React.MouseEvent, key: string) => {
      e.stopPropagation();
      setFavorites(prev => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key); else next.add(key);
          try { localStorage.setItem(`roomFav_${user.uid}`, JSON.stringify([...next])); } catch { /* ignore */ }
          return next;
      });
  }, [user.uid]);

  // Persist a room setting (archive/mute) with optimistic local update.
  const updateSetting = useCallback(async (key: string, patch: Partial<RoomSetting>) => {
      const cur = settingsRef.current.get(key) || { archived: false, muted: false };
      const merged: RoomSetting = { archived: cur.archived, muted: cur.muted, ...patch };
      setSettings(prev => { const next = new Map(prev); next.set(key, merged); return next; });
      try {
          const { error } = await supabase.from('room_settings').upsert(
              { user_id: user.uid, room_key: key, archived: merged.archived, muted: merged.muted, updated_at: new Date().toISOString() },
              { onConflict: 'user_id,room_key' }
          );
          if (error) throw error;
      } catch (e: any) {
          console.error('room_settings upsert failed', e);
          // Roll back the optimistic change.
          setSettings(prev => { const next = new Map(prev); next.set(key, cur); return next; });
          alert('Could not save room setting: ' + (e.message || 'Unknown error'));
      }
  }, [user.uid]);

  // Owner-only rename via SECURITY DEFINER RPC. display_name is cosmetic — the
  // room_key (and thus PIN/invite link) is never touched.
  const handleRename = useCallback(async (key: string, name: string) => {
      try {
          const { data, error } = await supabase.rpc('rename_room', { p_room_key: key, p_new_name: name });
          if (error) throw error;
          setRooms(prev => prev.map(r => r.room_key === key ? { ...r, display_name: (data as string) } : r));
      } catch (e: any) {
          const msg = e?.message || '';
          if (msg.includes('NOT_OWNER')) alert('Only the room owner can rename it.');
          else alert('Rename failed: ' + (msg || 'Unknown error'));
      }
  }, []);

  const toggleTheme = useCallback(() => {
      const next = !document.documentElement.classList.contains('dark');
      beginThemeTransition(); // global color cross-fade for this switch
      document.documentElement.classList.toggle('dark', next);
      try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
      document.querySelector("meta[name='theme-color']")?.setAttribute('content', next ? '#020617' : '#f8fafc');
      setIsDark(next);
  }, []);

  const fillRandomRoom = useCallback(() => {
      const adjectives = ['swift', 'cosmic', 'hidden', 'silent', 'golden', 'lunar', 'crimson', 'neon', 'velvet', 'arctic'];
      const nouns = ['fox', 'harbor', 'echo', 'nebula', 'garden', 'circuit', 'meadow', 'falcon', 'lagoon', 'ember'];
      const a = adjectives[Math.floor(Math.random() * adjectives.length)];
      const n = nouns[Math.floor(Math.random() * nouns.length)];
      setNewRoomName(`${a}-${n}-${Math.floor(100 + Math.random() * 900)}`);
      setNewRoomPin(String(Math.floor(1000 + Math.random() * 9000)));
  }, []);

  // "Quick chat": random room, opens the form so the owner can copy the PIN.
  const handleQuickChat = useCallback(() => { setEphemeral(false); fillRandomRoom(); setShowCreate(true); }, [fillRandomRoom]);
  // "Ephemeral 24h": same, but flagged to auto-delete after 24h of inactivity.
  const handleEphemeral = useCallback(() => { setEphemeral(true); fillRandomRoom(); setShowCreate(true); }, [fillRandomRoom]);

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

  // Delete one room (owner) or leave it (member), plus all local cleanup.
  // Shared by the single-room confirm and the bulk action. Throws on a fatal
  // server error so the caller can surface it.
  const deleteRoomByKey = useCallback(async (key: string, isOwner: boolean) => {
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
    // Local cleanup — list, saved order, favorites, settings.
    setRooms(prev => prev.filter(r => r.room_key !== key));
    try {
        const raw = localStorage.getItem(`roomOrder_${user.uid}`);
        if (raw) localStorage.setItem(`roomOrder_${user.uid}`, JSON.stringify((JSON.parse(raw) as string[]).filter(k => k !== key)));
    } catch { /* ignore */ }
    setFavorites(prev => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev); next.delete(key);
        try { localStorage.setItem(`roomFav_${user.uid}`, JSON.stringify([...next])); } catch { /* ignore */ }
        return next;
    });
    if (settingsRef.current.has(key)) {
        setSettings(prev => { const next = new Map(prev); next.delete(key); return next; });
        supabase.from('room_settings').delete().eq('user_id', user.uid).eq('room_key', key).then(undefined, () => {});
    }
  }, [user.uid]);

  const handleConfirmDeleteRoom = async () => {
    if (!roomToDelete) return;
    setIsDeletingRoom(true);
    try {
        await deleteRoomByKey(roomToDelete.key, roomToDelete.isOwner);
    } catch (e: any) {
        alert('Operation failed: ' + (e.message || "Unknown error"));
    } finally {
        setIsDeletingRoom(false);
        setRoomToDelete(null);
    }
  };

  // --- Bulk actions (multi-select) ---
  const toggleSelect = useCallback((key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => { setSelectMode(false); setSelected(new Set()); }, []);

  const handleBulkArchive = useCallback(async () => {
    const keys = [...selected];
    for (const key of keys) {
      if (!settingsRef.current.get(key)?.archived) await updateSetting(key, { archived: true });
    }
    exitSelectMode();
  }, [selected, updateSetting, exitSelectMode]);

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true);
    const keys = [...selected];
    const ownerByKey = new Map(rooms.map(r => [r.room_key, r.created_by === user.uid]));
    let failed = 0;
    for (const key of keys) {
      try { await deleteRoomByKey(key, !!ownerByKey.get(key)); }
      catch (e) { failed++; console.error('Bulk delete failed for', key, e); }
    }
    setIsBulkDeleting(false);
    setConfirmBulkDelete(false);
    exitSelectMode();
    if (failed > 0) alert(`${failed} room(s) could not be deleted.`);
  };

  const handleCreateOrJoinRoom = async (e: React.FormEvent) => {
      e.preventDefault();
      const roomName = newRoomName.trim();
      const pin = newRoomPin.trim();
      if (!roomName || !pin) return;
      setCreating(true);
      const roomKey = generateRoomKey(pin, roomName);
      try {
           const { data: room, error } = await joinOrCreateRoom({ roomKey, roomName, pin, username: displayName });
           if (error) {
               if (error.code === 'WRONG_PIN') alert('Wrong PIN for this room.');
               else alert('Failed to enter room. Please try again.');
               return;
           }
           if (room) {
               // Ephemeral preset: only set on a NEWLY created room (never override
               // an existing room you're joining). The expire_rooms cron deletes it
               // 24h after the last activity.
               if (ephemeral && room.is_new) {
                   const { error: ttlErr } = await supabase.from('rooms').update({ auto_delete_seconds: 86400 }).eq('room_key', room.room_key);
                   if (ttlErr) console.warn('Could not set ephemeral TTL:', ttlErr);
               }
               // No client-time lastRead write here: ChatScreen records the newest
               // SERVER message time once in-room, and the dashboard baselines an
               // unseen room to its latest server message — both skew-free.
               setNewRoomName('');
               setNewRoomPin('');
               setEphemeral(false);
               setShowCreate(false);
               onJoinRoom({ username: displayName, avatarURL: avatarUrl, roomName: room.room_name, pin, roomKey: room.room_key });
           }
      } catch (e: any) {
          alert("Failed to create or join room: " + (e?.message || 'Unknown error'));
      } finally {
          setCreating(false);
      }
  };

  const togglePinVisibility = useCallback((e: React.MouseEvent, roomKey: string) => {
    e.stopPropagation();
    setRevealedPins(prev => {
        const next = new Set(prev);
        if (next.has(roomKey)) next.delete(roomKey);
        else next.add(roomKey);
        return next;
    });
  }, []);

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

  const isUnread = useCallback((key: string) => {
    const s = settings.get(key);
    if (s?.muted) return false;
    return (overview.get(key)?.unread || 0) > 0;
  }, [settings, overview]);

  const unreadFilterCount = useMemo(
    () => rooms.filter((r) => !settings.get(r.room_key)?.archived && isUnread(r.room_key)).length,
    [rooms, settings, isUnread]
  );

  const anyArchived = useMemo(() => rooms.some((r) => settings.get(r.room_key)?.archived), [rooms, settings]);

  // Drag is enabled only when the displayed order == the saved canonical order.
  const dragEnabled = query.trim() === '' && filter === 'all' && favorites.size === 0 && !anyArchived && !selectMode;

  const displayRooms = useMemo(() => {
    if (dragEnabled) return rooms;
    const q = query.trim().toLowerCase();
    const filtered = rooms.filter((r) => {
      const s = settings.get(r.room_key);
      const archived = !!s?.archived;
      if (filter === 'archived') { if (!archived) return false; }
      else if (archived) { return false; } // hide archived from every non-archived view
      if (q && !(r.display_name || r.room_name).toLowerCase().includes(q)) return false;
      if (filter === 'owned' && r.created_by !== user.uid) return false;
      if (filter === 'joined' && r.created_by === user.uid) return false;
      if (filter === 'unread' && !isUnread(r.room_key)) return false;
      return true;
    });
    const favs = filtered.filter((r) => favorites.has(r.room_key));
    const rest = filtered.filter((r) => !favorites.has(r.room_key));
    return [...favs, ...rest];
  }, [dragEnabled, rooms, query, filter, favorites, settings, isUnread, user.uid]);

  const cardPropsFor = (room: Room): Omit<RoomCardProps, 'room'> => ({
    userUid: user.uid,
    unread: overview.get(room.room_key)?.unread || 0,
    muted: !!settings.get(room.room_key)?.muted,
    archived: !!settings.get(room.room_key)?.archived,
    overview: overview.get(room.room_key),
    revealed: revealedPins.has(room.room_key),
    isFavorite: favorites.has(room.room_key),
    selectMode,
    selected: selected.has(room.room_key),
    online: online.get(room.room_key),
    onJoin: handleJoin,
    onOpenActions: setActionsRoom,
    onTogglePin: togglePinVisibility,
    onToggleFav: toggleFavorite,
    onToggleSelect: toggleSelect,
  });

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
    {actionsRoom && (
        <RoomActionsSheet
            room={actionsRoom}
            isOwner={actionsRoom.created_by === user.uid}
            muted={!!settings.get(actionsRoom.room_key)?.muted}
            archived={!!settings.get(actionsRoom.room_key)?.archived}
            onClose={() => setActionsRoom(null)}
            onRename={handleRename}
            onToggleMute={() => updateSetting(actionsRoom.room_key, { muted: !settings.get(actionsRoom.room_key)?.muted })}
            onToggleArchive={() => updateSetting(actionsRoom.room_key, { archived: !settings.get(actionsRoom.room_key)?.archived })}
            onDelete={() => onRequestDeleteRoom(actionsRoom.display_name || actionsRoom.room_name, actionsRoom.room_key, actionsRoom.created_by)}
        />
    )}
    {selectMode && selected.size > 0 && createPortal(
        <div className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[100] animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div className="flex items-center justify-between gap-4 p-3 pl-5 bg-slate-900/90 dark:bg-white/10 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl text-white ring-1 ring-black/10">
                <span className="text-sm font-bold whitespace-nowrap">{selected.size} selected</span>
                <div className="flex gap-2">
                    <button onClick={handleBulkArchive} className="px-3 py-1.5 text-xs font-bold bg-white/10 hover:bg-white/20 rounded-lg flex items-center gap-1.5 transition"><Archive size={14} />Archive</button>
                    <button onClick={() => setConfirmBulkDelete(true)} className="px-3 py-1.5 text-xs font-bold bg-red-500 hover:bg-red-600 rounded-lg flex items-center gap-1.5 transition shadow-lg shadow-red-500/20"><Trash2 size={14} />Delete</button>
                </div>
            </div>
        </div>,
        document.body
    )}
    {confirmBulkDelete && createPortal(
        <div onClick={() => !isBulkDeleting && setConfirmBulkDelete(false)} className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 animate-in zoom-in-95">
                <div className="flex items-center gap-2 mb-2"><AlertCircle className="text-red-500" size={20} /><h3 className="font-bold text-slate-800 dark:text-white">Delete {selected.size} room{selected.size > 1 ? 's' : ''}?</h3></div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Rooms you own are permanently deleted for everyone; rooms you joined are removed from your list. This can't be undone.</p>
                <div className="flex gap-2">
                    <button onClick={() => setConfirmBulkDelete(false)} disabled={isBulkDeleting} className="flex-1 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition disabled:opacity-50">Cancel</button>
                    <button onClick={handleBulkDelete} disabled={isBulkDeleting} className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50">{isBulkDeleting ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}Delete</button>
                </div>
            </div>
        </div>,
        document.body
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
                                        <button onClick={handleQuickChat} title="Generate a random room name + PIN" className="flex-1 sm:flex-none px-4 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl transition-all flex items-center justify-center gap-2"><MessageSquarePlus size={18} className="text-blue-500" />Quick chat</button>
                                        <button onClick={() => setShowCreate(true)} className="flex-1 sm:flex-none px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2"><LogIn size={20} />Enter / Create</button>
                                    </div>
                                </div>
                            ) : (
                                <form onSubmit={handleCreateOrJoinRoom} className="space-y-4 animate-in fade-in slide-in-from-top-2">
                                    <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-4">
                                        <h3 className="font-semibold text-lg">Room Access</h3>
                                        <button type="button" onClick={() => { setShowCreate(false); setEphemeral(false); }} aria-label="Close" className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition"><X size={20} /></button>
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
                                    <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
                                        <input type="checkbox" checked={ephemeral} onChange={(e) => setEphemeral(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500" />
                                        <span className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-1.5"><Clock size={14} className="text-amber-500" />Ephemeral — auto-delete 24h after the last message <span className="text-[11px] text-slate-400">(new rooms only)</span></span>
                                    </label>
                                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                                        <p className="text-xs text-slate-500 italic">If the room exists, you will join it. Otherwise, a new room will be created.</p>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={fillRandomRoom} title="Generate a random room name + PIN" className="px-4 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl transition flex items-center gap-2"><Shuffle size={16} className="text-slate-500 dark:text-slate-400" />Random</button>
                                            <button type="submit" disabled={creating} className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2">{creating ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}Enter Room</button>
                                        </div>
                                    </div>
                                </form>
                            )}
                         </div>
                    </div>

                    <div>
                        <div className="flex flex-col gap-3 mb-4 px-1">
                            <div className="flex items-center justify-between gap-3">
                                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Your Rooms</h3>
                                <div className="flex items-center gap-3">
                                    {dragEnabled && rooms.length > 1 && (
                                        <span className="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:inline">Drag to reorder · long-press on touch</span>
                                    )}
                                    {rooms.length > 1 && (
                                        <button onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))} className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition ${selectMode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-blue-300'}`}>
                                            <CheckSquare size={14} />{selectMode ? 'Cancel' : 'Select'}
                                        </button>
                                    )}
                                </div>
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
                                        {(['all', 'owned', 'joined', 'unread', 'archived'] as const).map((key) => {
                                            if (key === 'archived' && !anyArchived) return null;
                                            return (
                                                <button
                                                    key={key}
                                                    onClick={() => setFilter(key)}
                                                    aria-pressed={filter === key}
                                                    className={`shrink-0 px-3 py-1.5 text-xs font-bold rounded-lg border capitalize transition ${filter === key ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-blue-300'}`}
                                                >
                                                    {key}{key === 'unread' && unreadFilterCount > 0 ? ` (${unreadFilterCount})` : ''}
                                                </button>
                                            );
                                        })}
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
                                <div className="flex flex-col sm:flex-row gap-2 justify-center mt-5 flex-wrap">
                                    <button onClick={handleQuickChat} className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold flex items-center justify-center gap-2 transition"><MessageSquarePlus size={18} className="text-blue-500" />Quick chat</button>
                                    <button onClick={handleEphemeral} title="Random room that self-deletes 24h after the last message" className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold flex items-center justify-center gap-2 transition"><Clock size={18} className="text-amber-500" />Ephemeral 24h</button>
                                    <button onClick={() => setShowCreate(true)} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition"><LogIn size={18} />Create or Join</button>
                                </div>
                            </div>
                        ) : displayRooms.length === 0 ? (
                            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-10 text-center border-2 border-dashed border-slate-200 dark:border-slate-800">
                                <p className="text-slate-500 dark:text-slate-400">{filter === 'archived' ? 'No archived rooms.' : 'No rooms match your search or filter.'}</p>
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
                                            <SortableRoomCard key={room.room_key} room={room} {...cardPropsFor(room)} />
                                        ))}
                                    </div>
                                </SortableContext>
                                <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
                                    {activeRoom ? (
                                        <div className="room-card bg-white dark:bg-slate-900 p-5 rounded-2xl border border-blue-500 ring-2 ring-blue-500/50 shadow-2xl shadow-blue-500/30 rotate-2 scale-[1.03] cursor-grabbing select-none">
                                            <RoomCardInner room={activeRoom} {...cardPropsFor(activeRoom)} />
                                        </div>
                                    ) : null}
                                </DragOverlay>
                            </DndContext>
                        ) : (
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
                                {displayRooms.map((room) => (
                                    <StaticRoomCard key={room.room_key} room={room} {...cardPropsFor(room)} />
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
