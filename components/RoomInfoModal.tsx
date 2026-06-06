import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Search, Image as ImageIcon, Users, Wand2, Sparkles, Palette, Timer, Mail, Share2, Trash2, ChevronRight, Lock, ChevronLeft,
} from 'lucide-react';
import { ChatConfig, Presence } from '../types';
import { useModalA11y } from '../hooks/useModalA11y';

interface RoomInfoModalProps {
  show: boolean;
  onClose: () => void;
  config: ChatConfig;
  participants: Presence[];
  roomAvatarUrl?: string;
  isOwner: boolean;
  isGoogleUser: boolean;
  aiEnabled: boolean;
  messageTtlLabel?: string | null;
  emailAlertsEnabled: boolean;
  // actions (all wired to the existing ChatScreen handlers)
  onToggleSearch: () => void;
  onOpenGallery: () => void;
  onOpenParticipants: () => void;
  onToggleAI: () => void;
  onOpenAiAvatar: () => void;
  onOpenRoomAppearance: () => void;
  onOpenEphemeral: () => void;
  onOpenEmail: () => void;
  onDeleteRoom: () => void;
}

// A tappable navigation row (icon chip + label + optional trailing badge/chevron).
const Row: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tint?: string;        // tailwind classes for the icon chip
  trailing?: React.ReactNode;
  danger?: boolean;
}> = ({ icon, label, onClick, tint = 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300', trailing, danger }) => (
  <button
    onClick={onClick}
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

const RoomInfoModal: React.FC<RoomInfoModalProps> = ({
  show, onClose, config, participants, roomAvatarUrl, isOwner, isGoogleUser,
  aiEnabled, messageTtlLabel, emailAlertsEnabled,
  onToggleSearch, onOpenGallery, onOpenParticipants, onToggleAI, onOpenAiAvatar,
  onOpenRoomAppearance, onOpenEphemeral, onOpenEmail, onDeleteRoom,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(show, onClose, dialogRef);
  if (!show) return null;

  const onlineCount = participants.filter((p) => p.status === 'active').length;
  const total = participants.length;
  const initials = config.roomName.substring(0, 2).toUpperCase();
  // Collaborative room: any logged-in member (not only the creator) can manage
  // room settings and toggle Inco; the original creator keeps access even when
  // anonymous. Deleting the room is open to every member (see Delete row below).
  const showAi = isGoogleUser;                  // Inco needs a logged-in account
  const canManage = isOwner || isGoogleUser;    // appearance / disappearing messages

  // open a sub-screen: close this hub first so modals don't stack awkwardly
  const go = (fn: () => void) => { onClose(); setTimeout(fn, 0); };

  const handleShare = async () => {
    const inviteUrl = window.location.href.split('?')[0];
    const shareText = `🔒 Join my secure room on Incognito Chat!\n\n🏠 Room: ${config.roomName}\n🔑 PIN: ${config.pin}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Incognito Chat Invite', text: shareText, url: inviteUrl });
      else { await navigator.clipboard.writeText(`${shareText}\n\n${inviteUrl}`); alert('Room details copied to clipboard!'); }
    } catch (err) { console.error('Error sharing:', err); }
  };

  return createPortal(
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
            <img src={roomAvatarUrl} alt={config.roomName} className="w-24 h-24 rounded-full object-cover shadow-lg border border-white/40 dark:border-slate-700 bg-slate-200 dark:bg-slate-800" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-3xl shadow-lg">{initials}</div>
          )}
          <h2 className="mt-3 text-xl font-bold text-slate-800 dark:text-white break-words max-w-full">{config.roomName}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {total} participant{total === 1 ? '' : 's'}{onlineCount > 0 && <span className="text-green-500"> · {onlineCount} online</span>}
          </p>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] font-medium text-slate-400 dark:text-slate-500">
            <Lock size={12} /> Messages are encrypted
          </div>

          {/* Quick actions */}
          <div className="flex items-center justify-center gap-6 mt-5">
            <button onClick={handleShare} className="flex flex-col items-center gap-1.5 group">
              <span className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 transition group-active:scale-95"><Share2 size={20} /></span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Share</span>
            </button>
            <button onClick={() => go(onOpenParticipants)} className="flex flex-col items-center gap-1.5 group">
              <span className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center group-hover:bg-slate-200 dark:group-hover:bg-slate-700 transition group-active:scale-95"><Users size={20} /></span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Members</span>
            </button>
          </div>
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
            <Row icon={<Sparkles size={18} />} label="Customize AI look" onClick={() => go(onOpenAiAvatar)} tint="bg-purple-500/10 text-purple-500" />
          </>
        )}

        {/* Room settings */}
        <SectionLabel>Room</SectionLabel>
        {canManage && (
          <Row icon={<Palette size={18} />} label="Room appearance" onClick={() => go(onOpenRoomAppearance)} tint="bg-blue-500/10 text-blue-500" />
        )}
        {canManage && (
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
        )}
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

        {/* Danger zone — any member can delete the room. */}
        <div className="h-px bg-slate-100 dark:bg-slate-800 my-2" />
        <Row icon={<Trash2 size={18} />} label="Delete room" onClick={() => go(onDeleteRoom)} danger />

        <div className="h-[env(safe-area-inset-bottom)] shrink-0" />
      </div>
    </div>,
    document.body
  );
};

export default RoomInfoModal;
