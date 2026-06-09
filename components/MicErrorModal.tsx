import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { MicOff, X } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';

interface MicErrorModalProps {
  show: boolean;
  message: string;
  onClose: () => void;
}

// Friendly replacement for the old `alert('Could not access microphone.')`.
const MicErrorModal: React.FC<MicErrorModalProps> = ({ show, message, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(show, onClose, dialogRef);

  if (!show) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-label="Microphone unavailable"
        className="outline-none bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-white/10 dark:border-slate-800 animate-in zoom-in-95 duration-200"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-11 h-11 rounded-full bg-red-500/10 text-red-500 shrink-0">
              <MicOff size={22} />
            </span>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Microphone unavailable</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 -mr-1 -mt-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400 mb-6">{message}</p>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 transition active:scale-[0.98]"
        >
          Got it
        </button>
      </div>
    </div>,
    document.body
  );
};

export default MicErrorModal;
