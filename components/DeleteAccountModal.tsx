import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';
import { deleteAccount } from '../services/supabase';

interface DeleteAccountModalProps {
  show: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

// GDPR self-serve account deletion, gated behind a type-"DELETE" confirmation so
// it can't be triggered by accident. Calls the delete-account edge function.
const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({ show, onClose, onDeleted }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Don't allow Esc / backdrop close mid-deletion (the request is irreversible
  // and in flight); useModalA11y handles focus-trap + restore.
  useModalA11y(show, busy ? () => {} : onClose, dialogRef);

  if (!show) return null;

  const canDelete = confirmText.trim().toUpperCase() === 'DELETE' && !busy;

  const handleDelete = async () => {
    if (!canDelete) return;
    setBusy(true);
    setError(null);
    const res = await deleteAccount();
    if (res.ok) { onDeleted(); return; }
    setBusy(false);
    setError(
      res.error === 'AUTH_REQUIRED'
        ? 'Your session expired. Please sign in again and retry.'
        : 'Could not delete your account. Please try again, or email info@incognitochat.gr.'
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-label="Delete account"
        className="outline-none bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-white/10 dark:border-slate-800 animate-in zoom-in-95 duration-200"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-11 h-11 rounded-full bg-red-500/10 text-red-500 shrink-0"><AlertTriangle size={22} /></span>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Delete account</h3>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="p-2 -mr-1 -mt-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition disabled:opacity-40">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400 mb-4">
          This permanently deletes your account, the rooms you created (and their messages &amp; files), your room memberships, and cancels any active subscription. <b className="text-slate-700 dark:text-slate-200">This cannot be undone.</b>
        </p>

        <label htmlFor="del-acc-confirm" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
          Type <b className="text-red-500">DELETE</b> to confirm
        </label>
        <input
          id="del-acc-confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoFocus
          disabled={busy}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="w-full px-3.5 py-2.5 mb-4 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 text-base"
          placeholder="DELETE"
        />

        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-40">Cancel</button>
          <button
            onClick={handleDelete}
            disabled={!canDelete}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <><Loader2 size={16} className="animate-spin" /> Deleting…</> : <><Trash2 size={16} /> Delete</>}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default DeleteAccountModal;
