import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { Hourglass, Home } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';

interface Props { roomName: string; onCancel: () => void; }

// Shown to a user who tried to join a locked room: their request is pending the
// owner's approval. ChatScreen auto-admits them (re-running initRoom) when the
// owner approves; this is purely the waiting state + a way out.
const WaitingApprovalScreen: React.FC<Props> = ({ roomName, onCancel }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(true, onCancel, dialogRef);

  return createPortal(
  <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Waiting for approval" className="bg-slate-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl p-8 max-w-sm w-full text-center ring-1 ring-white/10">
      <div className="flex flex-col items-center gap-6">
        <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center ring-1 ring-blue-500/50">
          <Hourglass size={36} className="text-blue-400 animate-pulse" />
        </div>
        <div className="space-y-3">
          <h2 className="text-2xl font-bold text-white tracking-tight">Waiting for approval</h2>
          <p className="text-slate-300 text-sm font-medium leading-relaxed">
            "{roomName}" is locked. The owner has been asked to approve your access — you'll join automatically once they do.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="w-full py-3.5 px-6 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition active:scale-95 flex items-center justify-center gap-2">
          <Home size={18} /> Return to Home
        </button>
      </div>
    </div>
  </div>,
    document.body,
  );
};

export default WaitingApprovalScreen;
