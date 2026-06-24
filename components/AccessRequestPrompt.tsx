import React from 'react';
import { createPortal } from 'react-dom';
import { UserPlus } from 'lucide-react';

interface Props {
  username: string;
  onApprove: () => void;
  onDeny: () => void;
  busy?: boolean;
}

// Owner-facing pop-up: a user is knocking on a locked room. Sits above the chat
// (z-[115]) but below the toast (z-[200]).
const AccessRequestPrompt: React.FC<Props> = ({ username, onApprove, onDeny, busy }) => createPortal(
  <div className="fixed inset-x-0 top-0 z-[115] flex justify-center px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] animate-in slide-in-from-top-4 fade-in duration-200">
    <div role="dialog" aria-modal="false" aria-label="Access request" className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center gap-3">
        <span className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-500/10 text-blue-500 shrink-0"><UserPlus size={20} /></span>
        <p className="flex-1 text-sm text-slate-700 dark:text-slate-200">
          <span className="font-bold">{username}</span> wants to join this room.
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={onDeny} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50">Deny</button>
        <button onClick={onApprove} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 transition active:scale-95 disabled:opacity-60">Approve</button>
      </div>
    </div>
  </div>,
  document.body,
);

export default AccessRequestPrompt;
