import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalA11y } from '../hooks/useModalA11y';

export interface SheetAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Tailwind classes for the icon tile (bg + text colour). */
  tileClass: string;
}

interface AttachmentSheetProps {
  show: boolean;
  onClose: () => void;
  actions: SheetAction[];
}

/**
 * Viber-style "+" sheet: slides up from the bottom with a grid of attachment
 * actions (file, location, poll…). Each action closes the sheet then runs.
 */
const AttachmentSheet: React.FC<AttachmentSheetProps> = ({ show, onClose, actions }) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  useModalA11y(show, onClose, sheetRef);

  if (!show) return null;

  // Portal to <body>: the composer footer now has `backdrop-filter` (glass-bar),
  // which makes it a containing block for fixed-positioned descendants — that
  // confined this full-screen dismiss backdrop to the ~60px footer box, so a tap
  // outside it never closed the sheet. Escaping to body restores viewport-fixed.
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Attach"
        className="outline-none fixed bottom-0 inset-x-0 z-[90] bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-3xl shadow-2xl animate-sheet-up pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <div className="max-w-md mx-auto px-5 pt-3">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" aria-hidden="true" />
          <div className="grid grid-cols-3 gap-3">
            {actions.map((a) => (
              <button
                key={a.key}
                onClick={() => { onClose(); a.onClick(); }}
                disabled={a.disabled}
                className="flex flex-col items-center gap-2 rounded-2xl p-2 transition active:scale-95 hover:bg-slate-50 dark:hover:bg-slate-800/60 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                <span className={`flex h-14 w-14 items-center justify-center rounded-2xl ${a.tileClass}`}>
                  {a.icon}
                </span>
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};

export default AttachmentSheet;
