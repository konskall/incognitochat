import React, { useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Search, Image as ImageIcon, Users, Wand2, Sparkles, Palette, Timer, Mail, Share2, Trash2, ChevronRight, Lock, ChevronLeft, Clock, Eraser, QrCode, Copy, Check, ShieldCheck,
  Vibrate, VibrateOff, Volume2, VolumeX, Bell, BellOff, Sun, Moon, MapPin, MapPinOff,
} from 'lucide-react';
import qrcode from 'qrcode-generator';
import { ChatConfig, Presence } from '../types';
import { useModalA11y } from '../hooks/useModalA11y';
import { safeAvatarUrl } from '../utils/helpers';

// App logo, base-path aware (works in dev, on GitHub Pages, behind a custom domain).
const LOGO = `${import.meta.env.BASE_URL}favicon-96x96.png`;

interface RoomInfoModalProps {
  show: boolean;
  onClose: () => void;
  config: ChatConfig;
  participants: Presence[];
  roomAvatarUrl?: string;
  // Cosmetic room name (owner rename). Falls back to the identity name. Used for
  // display only — invite link + share text keep config.roomName (the join key).
  roomDisplayName?: string;
  isOwner: boolean;
  isGoogleUser: boolean;
  aiEnabled: boolean;
  messageTtlLabel?: string | null;
  roomExpiryLabel?: string | null;
  roomExpiresAt?: string | null; // free rooms auto-delete at this ISO timestamp
  emailAlertsEnabled: boolean;
  // actions (all wired to the existing ChatScreen handlers)
  onToggleSearch: () => void;
  onOpenGallery: () => void;
  onOpenParticipants: () => void;
  onOpenMembers?: () => void; // join-history list (distinct from the live call picker)
  onToggleAI: () => void;
  onOpenAiAvatar: () => void;
  onOpenRoomAppearance: () => void;
  onOpenEphemeral: () => void;
  onOpenRoomExpiry: () => void;
  onClearMessages: () => void; // wipe all messages in the room (Basic+)
  onOpenEmail: () => void;
  onDeleteRoom: () => void;
  approvalRequired?: boolean;
  onToggleApproval?: () => void;
  pendingCount?: number;
  // Device preferences (moved here from the old chat-header gear menu).
  canVibrate: boolean;
  vibrationEnabled: boolean;
  onToggleVibration: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  notificationsEnabled: boolean;
  onToggleNotifications: () => void;
  gpsEnabled: boolean;
  onToggleGps: () => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  // Tier plumbing (Phase 3): entitlements + upgrade prompt; gates the
  // appearance / disappearing / auto-delete / AI rows by tier.
  ent?: import('../utils/entitlements').TierEntitlements;
  entLoading?: boolean;
  onUpgrade?: (featureLabel: string, requiredTier: 'basic' | 'ultra', reason?: string) => void;
}

// A tappable navigation row (icon chip + label + optional trailing badge/chevron).
const Row: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tint?: string;        // tailwind classes for the icon chip
  trailing?: React.ReactNode;
  danger?: boolean;
  ariaPressed?: boolean; // for toggle-style rows whose state is shown as text (e.g. Theme)
}> = ({ icon, label, onClick, tint = 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300', trailing, danger, ariaPressed }) => (
  <button
    onClick={onClick}
    aria-pressed={ariaPressed}
    className={`flex items-center gap-3.5 w-full px-4 py-3 text-left transition active:scale-[0.99] hover:bg-slate-50 dark:hover:bg-slate-800/60 ${danger ? 'text-red-500' : 'text-slate-700 dark:text-slate-200'}`}
  >
    <span className={`flex items-center justify-center w-9 h-9 rounded-full shrink-0 ${danger ? 'bg-red-500/10 text-red-500' : tint}`}>{icon}</span>
    <span className="flex-1 text-sm font-semibold truncate">{label}</span>
    {trailing ?? <ChevronRight size={18} className="text-slate-300 dark:text-slate-600 shrink-0" />}
  </button>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-4 pt-4 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{children}</p>
);

// Free rooms carry an `expires_at` (24h from creation). Surface a friendly
// relative countdown so free users know the room self-destructs. Returns null
// for permanent rooms (paid) or already-past timestamps.
function formatExpiryHint(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins >= 1440) { const d = Math.round(mins / 1440); return `Auto-deletes in ~${d} day${d === 1 ? '' : 's'}`; }
  if (mins >= 60) { const h = Math.round(mins / 60); return `Auto-deletes in ~${h}h`; }
  return `Auto-deletes in ~${Math.max(1, mins)}m`;
}

const RoomInfoModal: React.FC<RoomInfoModalProps> = ({
  show, onClose, config, participants, roomAvatarUrl, roomDisplayName, isOwner, isGoogleUser,
  aiEnabled, messageTtlLabel, roomExpiryLabel, roomExpiresAt, emailAlertsEnabled,
  onToggleSearch, onOpenGallery, onOpenParticipants, onOpenMembers, onToggleAI, onOpenAiAvatar,
  onOpenRoomAppearance, onOpenEphemeral, onOpenRoomExpiry, onClearMessages, onOpenEmail, onDeleteRoom,
  ent, entLoading, onUpgrade,
  approvalRequired, onToggleApproval, pendingCount,
  canVibrate, vibrationEnabled, onToggleVibration, soundEnabled, onToggleSound,
  notificationsEnabled, onToggleNotifications, gpsEnabled, onToggleGps, isDarkMode, onToggleTheme,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(show, onClose, dialogRef);
  // Tapping the room photo opens an enlarged view (only when there's a real image).
  const [avatarPreview, setAvatarPreview] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  // Invite deep-link carrying room + PIN so the recipient doesn't retype them.
  // App.tsx reads ?room=&pin= on open, prefills the login form, then strips them.
  const inviteUrl = useMemo(() => {
    const base = window.location.origin + window.location.pathname;
    const p = new URLSearchParams({ room: config.roomName, pin: config.pin });
    return `${base}?${p.toString()}`;
  }, [config.roomName, config.pin]);
  const qrDataUrl = useMemo(() => {
    // Error-correction 'H' (~30% recoverable) so the centred logo doesn't break scanning.
    // cellSize 12 (not 6) renders at high resolution so that when the GIF is shown in
    // the 168px box on high-DPR phones (e.g. a Pixel at ~3x = ~500 device px) it stays
    // CRISP instead of upscaling to a blur — strict decoders (Google/Pixel) reject blurry
    // modules where the lenient iOS scanner still succeeds. margin=0: the pattern fills
    // the GIF edge-to-edge; the required ~4-module quiet zone comes from the white card
    // it sits on (p-4 ≈ 16px ≈ 4.7 modules) rather than being baked in a SECOND time —
    // the doubled white border (GIF margin + card padding) looked too heavy.
    try { const qr = qrcode(0, 'H'); qr.addData(inviteUrl); qr.make(); return qr.createDataURL(12, 0); }
    catch { return ''; }
  }, [inviteUrl]);
  if (!show) return null;

  // Only treat a feature as locked once entitlements have resolved (ent present).
  const lockedTrailing = <Lock size={16} className="text-slate-300 dark:text-slate-600" />;

  const onlineCount = participants.filter((p) => p.status === 'active').length;
  const total = participants.length;
  // Display name (owner rename) for the hero/avatar; invite + share keep the
  // identity name (config.roomName) so the derived room key still matches.
  const displayName = roomDisplayName || config.roomName;
  const initials = displayName.substring(0, 2).toUpperCase();
  const expiryHint = formatExpiryHint(roomExpiresAt);
  // A room sits on the FREE fixed 24h timer when it carries an `expires_at` but
  // NO chosen interval — only free creation does that. A paid-chosen auto-delete
  // room also has an `expires_at` (set via the RPC) but ALSO an `auto_delete_seconds`
  // (→ `roomExpiryLabel`), and must stay editable. So free-fixed = expires_at set
  // AND no roomExpiryLabel. The hero hint (above) shows the countdown for both.
  const roomOnFreeTimer = !!roomExpiresAt && !roomExpiryLabel;
  // Collaborative room: any logged-in member (not only the creator) can manage
  // room settings and toggle Inco; the original creator keeps access even when
  // anonymous. Deleting the room is open to every member (see Delete row below).
  // Inco/Auto-delete rows are ALWAYS shown (even to anonymous free users) so the
  // locked upsell is consistent across login states; the per-feature `ent` gate
  // below decides locked-vs-active. Anonymous users are always free -> locked.
  const showAi = true;
  const canManage = isOwner || isGoogleUser;    // appearance / disappearing messages

  // open a sub-screen: close this hub first so modals don't stack awkwardly
  const go = (fn: () => void) => { onClose(); setTimeout(fn, 0); };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch (err) { console.error('Copy failed:', err); }
  };

  const handleShare = async () => {
    // inviteUrl carries ?room=&pin= so the recipient lands on a prefilled login
    // (App.tsx reads + strips the params). Room + PIN are ALSO included as plain
    // text so a share target that drops the URL still lets them join manually.
    const shareText = `🔒 Join "${config.roomName}" on Incognito Chat\nRoom: ${config.roomName}\nPIN: ${config.pin}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Incognito Chat Invite', text: shareText, url: inviteUrl });
      else { await navigator.clipboard.writeText(`${shareText}\n${inviteUrl}`); setShowQr(true); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    } catch (err) { console.error('Error sharing:', err); }
  };

  return createPortal(
    <>
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex sm:items-center sm:justify-center sm:p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Room info"
        onClick={(e) => e.stopPropagation()}
        className="outline-none bg-white dark:bg-slate-900 w-full h-[100dvh] sm:h-auto sm:max-h-[88vh] sm:max-w-md sm:rounded-3xl shadow-2xl border border-white/10 dark:border-slate-800 overflow-y-auto flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
      >
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2.5 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 pt-[calc(0.625rem+env(safe-area-inset-top))]">
          <button onClick={onClose} aria-label="Back" className="p-2 -ml-1 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition sm:hidden">
            <ChevronLeft size={22} />
          </button>
          <h3 className="font-bold text-slate-800 dark:text-white text-sm">Room info</h3>
          <button onClick={onClose} aria-label="Close" className="p-2 -mr-1 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition max-sm:hidden">
            <X size={20} />
          </button>
          <span className="w-8 sm:hidden" />
        </div>

        {/* Hero */}
        <div className="flex flex-col items-center text-center px-6 pt-6 pb-5 border-b border-slate-100 dark:border-slate-800">
          {roomAvatarUrl ? (
            <button type="button" onClick={() => setAvatarPreview(true)} aria-label="View room photo" title="View photo" className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <img src={safeAvatarUrl(roomAvatarUrl)} alt={displayName} className="w-24 h-24 rounded-full object-cover shadow-lg border border-white/40 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 cursor-zoom-in transition-transform hover:scale-105 active:scale-95" />
            </button>
          ) : (
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-3xl shadow-lg">{initials}</div>
          )}
          <h2 className="mt-3 text-xl font-bold text-slate-800 dark:text-white break-words max-w-full">{displayName}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {total} participant{total === 1 ? '' : 's'}{onlineCount > 0 && <span className="text-green-500"> · {onlineCount} online</span>}
          </p>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] font-medium text-slate-400 dark:text-slate-500">
            <Lock size={12} /> Locked with your room PIN
          </div>
          {expiryHint && (
            <div className="flex items-center gap-1.5 mt-1.5 text-[11px] font-semibold text-red-500 dark:text-red-400">
              <Clock size={12} /> {expiryHint}
            </div>
          )}

          {/* Quick actions */}
          <div className="flex items-center justify-center gap-6 mt-5">
            <button onClick={handleShare} className="flex flex-col items-center gap-1.5 group">
              <span className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 transition group-active:scale-95"><Share2 size={20} /></span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Share</span>
            </button>
            <button onClick={() => go(onOpenMembers ?? onOpenParticipants)} className="flex flex-col items-center gap-1.5 group">
              <span className="relative w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center group-hover:bg-slate-200 dark:group-hover:bg-slate-700 transition group-active:scale-95">
                <Users size={20} />
                {!!pendingCount && pendingCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-slate-900">{pendingCount}</span>
                )}
              </span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Members</span>
            </button>
            <button onClick={() => setShowQr((v) => !v)} aria-expanded={showQr} className="flex flex-col items-center gap-1.5 group">
              <span className={`w-12 h-12 rounded-full flex items-center justify-center transition group-active:scale-95 ${showQr ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 group-hover:bg-slate-200 dark:group-hover:bg-slate-700'}`}><QrCode size={20} /></span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">QR code</span>
            </button>
          </div>

          {showQr && (
            <div className="mt-5 flex flex-col items-center gap-3 animate-in fade-in zoom-in-95 duration-200">
              <div className="relative bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                {qrDataUrl
                  ? <img src={qrDataUrl} alt="Room invite QR code" className="block" style={{ width: 168, height: 168 }} />
                  : <div className="flex items-center justify-center text-slate-400 text-xs" style={{ width: 168, height: 168 }}>QR unavailable</div>}
                {qrDataUrl && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-white rounded-xl p-1 shadow-md ring-1 ring-slate-200">
                      <img src={LOGO} alt="" width={32} height={32} className="w-8 h-8 rounded-lg" />
                    </div>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center max-w-[260px]">Scan to open the room with its name &amp; PIN prefilled.</p>
              <button onClick={copyLink} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition active:scale-95">
                {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy invite link</>}
              </button>
            </div>
          )}
        </div>

        {/* Conversation */}
        <SectionLabel>Conversation</SectionLabel>
        <Row icon={<Search size={18} />} label="Search in conversation" onClick={() => go(onToggleSearch)} />
        <Row icon={<ImageIcon size={18} />} label="Media, links & files" onClick={() => go(onOpenGallery)} tint="bg-cyan-500/10 text-cyan-500" />
        <Row icon={<Users size={18} />} label={`Participants (${total})`} onClick={() => go(onOpenParticipants)} />

        {/* Inco AI (owner + Google account only) */}
        {showAi && (
          <>
            <SectionLabel>Inco AI</SectionLabel>
            {!entLoading && ent && !ent.canAI ? (
              <Row
                icon={<Wand2 size={18} />}
                label="Inco AI assistant"
                onClick={() => { onClose(); onUpgrade?.('Inco AI', 'ultra'); }}
                tint="bg-purple-500/10 text-purple-500"
                trailing={lockedTrailing}
              />
            ) : (
              <Row
                icon={<Wand2 size={18} />}
                label="Inco AI assistant"
                onClick={onToggleAI}
                tint="bg-purple-500/10 text-purple-500"
                trailing={
                  <span role="switch" aria-checked={aiEnabled} className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${aiEnabled ? 'bg-purple-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${aiEnabled ? 'translate-x-4' : ''}`} />
                  </span>
                }
              />
            )}
            {!entLoading && ent && !ent.canAI ? (
              <Row icon={<Sparkles size={18} />} label="Customize AI look" onClick={() => { onClose(); onUpgrade?.('Inco AI', 'ultra'); }} tint="bg-purple-500/10 text-purple-500" trailing={lockedTrailing} />
            ) : (
              <Row icon={<Sparkles size={18} />} label="Customize AI look" onClick={() => go(onOpenAiAvatar)} tint="bg-purple-500/10 text-purple-500" />
            )}
          </>
        )}

        {/* Room settings. Rows are ALWAYS shown so the locked upsell is identical
            for everyone (incl. anonymous free joiners). Free -> locked -> Basic.
            Paid editing stays manager-only (owner or any logged-in member). */}
        <SectionLabel>Room</SectionLabel>
        {isOwner && (
          <Row
            icon={<ShieldCheck size={18} />}
            label="Approval to join"
            onClick={() => onToggleApproval?.()}
            tint="bg-emerald-500/10 text-emerald-500"
            trailing={
              <span role="switch" aria-checked={!!approvalRequired} className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${approvalRequired ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${approvalRequired ? 'translate-x-4' : ''}`} />
              </span>
            }
          />
        )}
        {!entLoading && ent && !ent.canDisappearing ? (
          <Row
            icon={<Timer size={18} />}
            label="Disappearing messages"
            onClick={() => { onClose(); onUpgrade?.('Disappearing messages', 'basic'); }}
            tint="bg-orange-500/10 text-orange-500"
            trailing={lockedTrailing}
          />
        ) : canManage ? (
            <Row
              icon={<Timer size={18} />}
              label="Disappearing messages"
              onClick={() => go(onOpenEphemeral)}
              tint="bg-orange-500/10 text-orange-500"
              trailing={
                <span className="flex items-center gap-1 text-slate-400">
                  <span className="text-xs font-semibold">{messageTtlLabel || 'Off'}</span>
                  <ChevronRight size={18} className="text-slate-300 dark:text-slate-600" />
                </span>
              }
            />
        ) : null}
        {/* Clear all messages (Basic+). Wipes every message in the room for
            everyone but keeps the room. Free -> locked -> Basic; paid action is
            offered to any logged-in member (mirrors the collaborative Delete row).
            Server-enforced by the clear_room_messages RPC (tier + membership). */}
        {!entLoading && ent && !ent.canClearMessages ? (
          <Row
            icon={<Eraser size={18} />}
            label="Clear all messages"
            onClick={() => { onClose(); onUpgrade?.('Clear all messages', 'basic'); }}
            tint="bg-rose-500/10 text-rose-500"
            trailing={lockedTrailing}
          />
        ) : canManage ? (
          <Row
            icon={<Eraser size={18} />}
            label="Clear all messages"
            onClick={() => go(onClearMessages)}
            tint="bg-rose-500/10 text-rose-500"
          />
        ) : null}
        {/* Auto-delete room. Label always reflects the ROOM's real state:
            free-owned rooms show their fixed "1 day" lifetime; otherwise the
            configurable inactivity TTL (or "Off"). Free viewers see it locked
            (-> Basic). The editable inactivity control is offered ONLY to paid
            managers AND only when the room is NOT on the free fixed timer — a
            free owner's 24h expiry can't be toggled away by a member, so we just
            surface the countdown (hero hint) instead of a misleading "Off". */}
        {!entLoading && ent && !ent.canDisappearing ? (
          <Row
            icon={<Trash2 size={18} />}
            label="Auto-delete room"
            onClick={() => { onClose(); onUpgrade?.('Auto-delete', 'basic'); }}
            tint="bg-red-500/10 text-red-500"
            trailing={
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="text-xs font-semibold">{roomOnFreeTimer ? '1 day' : (roomExpiryLabel || 'Off')}</span>
                {lockedTrailing}
              </span>
            }
          />
        ) : roomOnFreeTimer ? (
          <Row
            icon={<Trash2 size={18} />}
            label="Auto-delete room"
            onClick={() => {}}
            tint="bg-red-500/10 text-red-500"
            trailing={<span className="text-xs font-semibold text-slate-400">Free room · 1 day</span>}
          />
        ) : canManage ? (
          <Row
            icon={<Trash2 size={18} />}
            label="Auto-delete room"
            onClick={() => go(onOpenRoomExpiry)}
            tint="bg-red-500/10 text-red-500"
            trailing={
              <span className="flex items-center gap-1 text-slate-400">
                <span className="text-xs font-semibold">{roomExpiryLabel || 'Off'}</span>
                <ChevronRight size={18} className="text-slate-300 dark:text-slate-600" />
              </span>
            }
          />
        ) : null}
        {!entLoading && ent && !ent.canEmailAlerts ? (
          <Row
            icon={<Mail size={18} />}
            label="Email alerts"
            onClick={() => { onClose(); onUpgrade?.('Email alerts', 'basic'); }}
            tint="bg-emerald-500/10 text-emerald-500"
            trailing={lockedTrailing}
          />
        ) : (
          <Row
            icon={<Mail size={18} />}
            label="Email alerts"
            onClick={() => go(onOpenEmail)}
            tint="bg-emerald-500/10 text-emerald-500"
            trailing={
              <span className="flex items-center gap-1 text-slate-400">
                {emailAlertsEnabled && <span className="text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300 px-1.5 py-0.5 rounded">ON</span>}
                <ChevronRight size={18} className="text-slate-300 dark:text-slate-600" />
              </span>
            }
          />
        )}
        {!entLoading && ent && !ent.canRoomAppearance ? (
          <Row icon={<Palette size={18} />} label="Room appearance" onClick={() => { onClose(); onUpgrade?.('Room appearance', 'basic'); }} tint="bg-blue-500/10 text-blue-500" trailing={lockedTrailing} />
        ) : canManage ? (
          <Row icon={<Palette size={18} />} label="Room appearance" onClick={() => go(onOpenRoomAppearance)} tint="bg-blue-500/10 text-blue-500" />
        ) : null}

        {/* Preferences — device-scoped (vibration/sound/notifications/theme).
            Moved here from the old chat-header gear menu; these toggle in place
            and keep the modal open (like the AI / Approval switches above). */}
        <SectionLabel>Preferences</SectionLabel>
        {canVibrate && (
          <Row
            icon={vibrationEnabled ? <Vibrate size={18} /> : <VibrateOff size={18} />}
            label="Vibration"
            onClick={onToggleVibration}
            trailing={
              <span role="switch" aria-checked={vibrationEnabled} className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${vibrationEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${vibrationEnabled ? 'translate-x-4' : ''}`} />
              </span>
            }
          />
        )}
        <Row
          icon={soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          label="Sound"
          onClick={onToggleSound}
          trailing={
            <span role="switch" aria-checked={soundEnabled} className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${soundEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${soundEnabled ? 'translate-x-4' : ''}`} />
            </span>
          }
        />
        <Row
          icon={notificationsEnabled ? <Bell size={18} /> : <BellOff size={18} />}
          label="Notifications"
          onClick={onToggleNotifications}
          trailing={
            <span role="switch" aria-checked={notificationsEnabled} className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${notificationsEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notificationsEnabled ? 'translate-x-4' : ''}`} />
            </span>
          }
        />
        <Row
          icon={gpsEnabled ? <MapPin size={18} /> : <MapPinOff size={18} />}
          label="Location sharing"
          onClick={onToggleGps}
          trailing={
            <span role="switch" aria-checked={gpsEnabled} className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${gpsEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${gpsEnabled ? 'translate-x-4' : ''}`} />
            </span>
          }
        />
        <Row
          icon={isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
          label="Theme"
          onClick={onToggleTheme}
          ariaPressed={isDarkMode}
          trailing={<span className="text-xs font-semibold text-slate-400">{isDarkMode ? 'Dark' : 'Light'}</span>}
        />

        {/* Danger zone — any member can delete the room. */}
        <div className="h-px bg-slate-100 dark:bg-slate-800 my-2" />
        <Row icon={<Trash2 size={18} />} label="Delete room" onClick={() => go(onDeleteRoom)} danger />

        <div className="h-[env(safe-area-inset-bottom)] shrink-0" />
      </div>
    </div>
    {avatarPreview && roomAvatarUrl && (
      <div
        className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
        onClick={() => setAvatarPreview(false)}
        role="dialog"
        aria-modal="true"
        aria-label="Room photo"
      >
        <button onClick={() => setAvatarPreview(false)} aria-label="Close photo" className="absolute top-4 right-4 p-2.5 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition">
          <X size={24} />
        </button>
        <img
          src={safeAvatarUrl(roomAvatarUrl)}
          alt={displayName}
          onClick={(e) => e.stopPropagation()}
          className="max-w-full max-h-[85vh] rounded-2xl object-contain shadow-2xl animate-in zoom-in-95 duration-200"
        />
      </div>
    )}
    </>,
    document.body
  );
};

export default RoomInfoModal;
