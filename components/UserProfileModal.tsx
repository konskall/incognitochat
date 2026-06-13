
import React, { useRef, useMemo } from 'react';
import { X, Calendar, Clock, ShieldCheck } from 'lucide-react';
import { Presence, Subscriber } from '../types';
import { useModalA11y } from '../hooks/useModalA11y';
import { safeAvatarUrl } from '../utils/helpers';

interface UserProfileModalProps {
  user: Presence | null;
  subscriberInfo?: Subscriber | null;
  isRoomOwner: boolean;
  onClose: () => void;
}

// Honest "last seen" label. We only ever have a real timestamp for users who
// are (or were just) live in the presence channel; offline users carry no
// onlineAt (we deliberately stopped surfacing the email-notification time as
// "activity"), so they read simply as "Offline".
function formatLastSeen(status: Presence['status'], onlineAt: string): string {
  if (status === 'active') return 'Active now';
  if (!onlineAt) return 'Offline';
  const t = new Date(onlineAt).getTime();
  if (Number.isNaN(t)) return 'Offline';
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(onlineAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

const UserProfileModal: React.FC<UserProfileModalProps> = ({ user, subscriberInfo, isRoomOwner, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(!!user, onClose, dialogRef);

  const lastSeen = useMemo(
    () => (user ? formatLastSeen(user.status, user.onlineAt) : ''),
    [user?.status, user?.onlineAt],
  );

  // Only resolves for your OWN profile — RLS scopes the subscribers table to
  // your own row, so another member's join date isn't readable. When absent we
  // hide the row entirely rather than show a perpetual "Unknown".
  const joinedAt = useMemo(
    () => (subscriberInfo?.created_at
      ? new Date(subscriberInfo.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
      : null),
    [subscriberInfo?.created_at],
  );

  if (!user) return null;

  const isActive = user.status === 'active';
  // Live status text, with the typing state surfaced when we have it.
  const presenceLabel = isActive ? (user.isTyping ? 'Typing…' : 'Active now') : 'Offline';

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm motion-reduce:backdrop-blur-none animate-in fade-in duration-200" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-profile-title"
        className="outline-none bg-white dark:bg-slate-900 rounded-[2.5rem] w-full max-w-[320px] overflow-hidden shadow-2xl border border-white/20 dark:border-slate-800 animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header - shorter height for less empty space */}
        <div className="relative h-24 bg-gradient-to-br from-blue-600 to-indigo-700">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 p-1.5 bg-black/20 hover:bg-black/40 text-white rounded-full transition-colors backdrop-blur-md z-10"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Area */}
        <div className="relative px-5 pb-8">
          {/* Avatar - positioned so it doesn't cover the name */}
          <div className="flex justify-center -mt-12 mb-4">
            <div className="relative inline-block">
              <img
                src={safeAvatarUrl(user.avatar)}
                alt={user.username}
                className="w-28 h-28 rounded-3xl object-cover border-4 border-white dark:bg-slate-900 shadow-lg bg-slate-200"
              />
              <span
                aria-label={isActive ? 'Online' : 'Offline'}
                className={`absolute bottom-1 right-1 w-4 h-4 border-2 border-white dark:border-slate-900 rounded-full ${isActive ? 'bg-green-500' : 'bg-orange-500'}`}
              />
            </div>
          </div>

          {/* User Info - proper name alignment */}
          <div className="text-center mb-6">
            <h2 id="user-profile-title" className="text-xl font-bold text-slate-900 dark:text-white flex items-center justify-center gap-1.5 leading-tight">
              {user.username}
              {isRoomOwner && <span aria-label="Room Owner" title="Room Owner"><ShieldCheck size={18} className="text-yellow-500 fill-yellow-500/10" /></span>}
            </h2>
            <p className={`text-xs font-semibold mt-0.5 ${isActive ? 'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}`}>
              {presenceLabel}
            </p>
          </div>

          {/* Info Rows - more compact design */}
          <div className="space-y-2.5">
            {joinedAt && (
              <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800/60">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
                  <Calendar size={16} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Member since</span>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{joinedAt}</span>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800/60">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl">
                <Clock size={16} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Last seen</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{lastSeen}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(UserProfileModal);
