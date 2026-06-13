import React from 'react';
import { BarChart3, Check, Lock } from 'lucide-react';
import { Poll } from '../types';

interface PollMessageProps {
  poll: Poll;
  currentUid: string;
  isMe: boolean;       // poll bubble belongs to the current user (controls colors)
  canManage: boolean;  // author or room owner — may close/reopen
  onVote: (optionId: string) => void;
  onToggleClosed: (closed: boolean) => void;
}

const PollMessage: React.FC<PollMessageProps> = ({ poll, currentUid, isMe, canManage, onVote, onToggleClosed }) => {
  const counts: { [id: string]: number } = {};
  let totalVotes = 0;
  for (const opt of poll.options) {
    const c = (poll.votes?.[opt.id] || []).length;
    counts[opt.id] = c;
    totalVotes += c;
  }

  return (
    <div className="flex flex-col gap-2 w-[240px] sm:w-[280px] max-w-full">
      <div className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${isMe ? 'text-blue-100/90' : 'text-blue-500 dark:text-blue-400'}`}>
        <BarChart3 size={13} /> Poll {poll.multi && <span className="opacity-70 normal-case font-medium">· multiple</span>}
      </div>
      <p className="font-semibold leading-snug break-words">{poll.question}</p>

      <div className="flex flex-col gap-1.5 mt-0.5">
        {poll.options.map((opt) => {
          const c = counts[opt.id];
          const pct = totalVotes > 0 ? Math.round((c / totalVotes) * 100) : 0;
          const voted = (poll.votes?.[opt.id] || []).includes(currentUid);
          return (
            <button
              key={opt.id}
              onClick={() => !poll.closed && onVote(opt.id)}
              disabled={poll.closed}
              className={`relative w-full text-left rounded-xl overflow-hidden border transition-all ${poll.closed ? 'cursor-default' : 'active:scale-[0.99]'} ${
                voted
                  ? (isMe ? 'border-white/60 bg-white/10' : 'border-blue-400 dark:border-blue-500 bg-blue-50/60 dark:bg-blue-900/20')
                  : (isMe ? 'border-white/20 bg-white/5 hover:bg-white/10' : 'border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800')
              }`}
            >
              <span
                className={`absolute inset-y-0 left-0 transition-all duration-500 ${isMe ? 'bg-white/20' : 'bg-blue-500/15 dark:bg-blue-400/20'}`}
                style={{ width: `${pct}%` }}
              />
              <span className="relative flex items-center justify-between gap-2 px-3 py-2">
                <span className="flex items-center gap-1.5 min-w-0">
                  {voted && <Check size={13} className="shrink-0" />}
                  <span className="text-sm truncate">{opt.text}</span>
                </span>
                <span className="text-xs font-semibold opacity-80 shrink-0">{pct}%</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className={`flex items-center justify-between text-[11px] mt-0.5 ${isMe ? 'text-blue-100/80' : 'text-slate-400 dark:text-slate-500'}`}>
        <span>{totalVotes} vote{totalVotes === 1 ? '' : 's'}{poll.closed && ' · final'}</span>
        {poll.closed ? (
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1 font-semibold"><Lock size={11} /> Closed</span>
            {canManage && (
              <button onClick={() => onToggleClosed(false)} className={`font-semibold hover:underline ${isMe ? 'text-white' : 'text-blue-600 dark:text-blue-400'}`}>
                Reopen
              </button>
            )}
          </span>
        ) : (
          canManage && (
            <button onClick={() => onToggleClosed(true)} className={`font-semibold hover:underline ${isMe ? 'text-white' : 'text-blue-600 dark:text-blue-400'}`}>
              Close poll
            </button>
          )
        )}
      </div>
    </div>
  );
};

export default PollMessage;
