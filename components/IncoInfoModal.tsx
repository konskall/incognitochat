import React, { useRef } from 'react';
import { X, Wand2, MessageCircle, Search, ShieldCheck } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';
import { safeAvatarUrl, INCO_BOT_AVATAR } from '../utils/helpers';

interface IncoInfoModalProps {
  // The avatar to show (the one tapped in chat). null = closed.
  avatar: string | null;
  onClose: () => void;
}

// "A few words about inco" — opens when a member taps the bot's avatar/name in
// chat, mirroring the user-profile modal but tailored to the AI assistant
// (no presence/last-seen; a short description + what it can do instead).
const IncoInfoModal: React.FC<IncoInfoModalProps> = ({ avatar, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(!!avatar, onClose, dialogRef);

  if (!avatar) return null;

  // Full static Tailwind classes (the JIT can't see `bg-${x}-100` template strings).
  const rows = [
    { Icon: MessageCircle, cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400', text: 'Type "inco" or reply to me to chat' },
    { Icon: Search, cls: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400', text: 'I can search the web for current info' },
    { Icon: ShieldCheck, cls: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400', text: 'I only read recent messages, and only when you call me' },
  ];

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm motion-reduce:backdrop-blur-none animate-in fade-in duration-200" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inco-info-title"
        className="outline-none bg-white dark:bg-slate-900 rounded-[2.5rem] w-full max-w-[320px] overflow-hidden shadow-2xl border border-white/20 dark:border-slate-800 animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="relative h-24 bg-gradient-to-br from-indigo-500 to-violet-700">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 p-1.5 bg-black/20 hover:bg-black/40 text-white rounded-full transition-colors backdrop-blur-md z-10"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative px-5 pb-8">
          <div className="flex justify-center -mt-12 mb-4">
            <div className="relative inline-block">
              <img
                src={safeAvatarUrl(avatar)}
                alt="inco"
                onError={(e) => { const img = e.currentTarget; if (img.src !== INCO_BOT_AVATAR) { img.onerror = null; img.src = INCO_BOT_AVATAR; } }}
                className="w-28 h-28 rounded-3xl object-cover border-4 border-white dark:border-slate-900 shadow-lg bg-indigo-100 dark:bg-indigo-900/40"
              />
              <span className="absolute -bottom-1 -right-1 p-1.5 bg-indigo-500 border-2 border-white dark:border-slate-900 rounded-full text-white shadow">
                <Wand2 size={13} />
              </span>
            </div>
          </div>

          <div className="text-center mb-6">
            <h2 id="inco-info-title" className="text-xl font-bold text-slate-900 dark:text-white leading-tight">inco</h2>
            <p className="text-xs font-semibold mt-0.5 text-indigo-600 dark:text-indigo-300">AI assistant</p>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-3 leading-relaxed">
              Hi, I'm inco — this room's built-in AI helper.
            </p>
          </div>

          <div className="space-y-2.5">
            {rows.map(({ Icon, cls, text }, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800/60">
                <div className={`p-2 rounded-xl shrink-0 ${cls}`}>
                  <Icon size={16} />
                </div>
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-snug">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(IncoInfoModal);
