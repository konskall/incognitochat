import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Reply, Copy, Edit2, Pin, PinOff, Trash2 } from 'lucide-react';
import EmojiPicker from './EmojiPicker';
import Emoji from './Emoji';
import { useModalA11y } from '../hooks/useModalA11y';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

// Lightweight transient toast (e.g. "Copied"). Imperative so it needs no state
// plumbing from the deeply-nested message tree.
export function flashToast(text: string) {
  const el = document.createElement('div');
  el.textContent = text;
  el.className = 'fixed left-1/2 bottom-6 -translate-x-1/2 z-[200] bg-slate-900 text-white text-sm font-semibold px-4 py-2 rounded-full shadow-2xl border border-white/10 pointer-events-none';
  el.style.transition = 'opacity .2s';
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 1200);
  setTimeout(() => { el.remove(); }, 1450);
}

interface MessageActionMenuProps {
  anchorRect: DOMRect;
  bubbleHTML: string;     // snapshot of the pressed bubble's inner HTML
  bubbleClass: string;    // the bubble's className, so the lifted clone matches
  isMe: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
  isPinned: boolean;
  canCopy: boolean;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void | Promise<unknown>;
  onEdit: () => void;
  onPin: () => void;
  onDelete: () => void;
}

/**
 * iOS / Telegram-style long-press context menu: the screen dims, the pressed
 * bubble is "lifted" above the blur, a reaction row floats above it and an
 * action list below. Replaces the always-visible per-message button column.
 */
const MessageActionMenu: React.FC<MessageActionMenuProps> = ({
  anchorRect, bubbleHTML, bubbleClass, isMe, canEdit, canDelete, canPin, isPinned, canCopy,
  onClose, onReact, onReply, onCopy, onEdit, onPin, onDelete,
}) => {
  const liftRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  // Ignore the trailing click that a long-press synthesizes (it would otherwise
  // land on the backdrop and close the menu the instant it opens).
  const [armed, setArmed] = useState(false);

  useLayoutEffect(() => {
    const el = liftRef.current;
    if (!el) return;
    // The container is capped to the viewport height (max-h below) and the
    // bubble preview can shrink, so lh never exceeds the viewport — the clamp
    // then always lands the whole menu (reaction row + actions) on screen, even
    // for very tall messages that previously overflowed and got clipped.
    const lw = el.offsetWidth, lh = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    const r = anchorRect;
    let left = isMe ? r.right - lw : r.left;
    left = Math.max(8, Math.min(left, vw - lw - 8));
    let top = r.top - 52;               // lift a little so the reaction row clears the bubble
    top = Math.max(8, Math.min(top, vh - lh - 8));
    setPos({ left, top });
  }, [anchorRect, isMe]);

  // Focus-trap + Escape-to-close + focus restore. On open, focus moves into the
  // menu (first reaction button); on close, focus returns to the long-pressed
  // bubble. The menu is only mounted while open, so it is always "active". The
  // layout effect above flips visibility to visible before this runs, so the
  // initial focus lands correctly.
  useModalA11y(true, onClose, liftRef);

  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 350);
    return () => clearTimeout(t);
  }, []);

  const run = (fn: () => void) => { fn(); onClose(); };

  return createPortal(
    <div className="fixed inset-0 z-[120]">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm animate-fade-in"
        onClick={() => { if (armed) onClose(); }}
      />
      <div
        ref={liftRef}
        role="dialog"
        aria-modal="true"
        aria-label="Message actions"
        tabIndex={-1}
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
        className={`fixed flex flex-col gap-2.5 max-h-[calc(100dvh_-_1rem)] outline-none ${isMe ? 'items-end' : 'items-start'} animate-in zoom-in-95 fade-in duration-150`}
      >
        {/* Reaction row */}
        <div className="shrink-0 flex items-center gap-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full px-1.5 py-1 shadow-2xl">
          {QUICK_REACTIONS.map((e) => (
            <button key={e} onClick={() => run(() => onReact(e))} aria-label={`React with ${e}`} className="p-1 rounded-full hover:scale-125 transition-transform"><Emoji emoji={e} className="w-7 h-7" /></button>
          ))}
          <button onClick={() => setShowPicker(true)} aria-label="More emojis" className="w-8 h-8 ml-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 flex items-center justify-center text-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition">＋</button>
        </div>

        {/* Lifted snapshot of the bubble. Capped + shrinkable so a long message
            can't push the reaction row / actions off-screen (it just clips). */}
        <div
          aria-hidden="true"
          className={`${bubbleClass} shadow-2xl pointer-events-none shrink min-h-0 overflow-hidden`}
          style={{ width: 'fit-content', maxWidth: '80vw', maxHeight: '40vh' }}
          dangerouslySetInnerHTML={{ __html: bubbleHTML }}
        />

        {/* Action list */}
        <div className="shrink-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-2xl min-w-[212px] divide-y divide-slate-100 dark:divide-slate-700/60">
          <button onClick={() => run(onReply)} className="flex items-center gap-3 w-full px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition text-left">
            <Reply size={18} /> Reply
          </button>
          {canCopy && (
            <button onClick={() => { Promise.resolve(onCopy()).then(() => flashToast('Copied to clipboard')).catch(() => flashToast('Copy failed')); onClose(); }} className="flex items-center gap-3 w-full px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition text-left">
              <Copy size={18} /> Copy message
            </button>
          )}
          {canEdit && (
            <button onClick={() => run(onEdit)} className="flex items-center gap-3 w-full px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition text-left">
              <Edit2 size={18} /> Edit message
            </button>
          )}
          {canPin && (
            <button onClick={() => run(onPin)} className="flex items-center gap-3 w-full px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition text-left">
              {isPinned ? <PinOff size={18} /> : <Pin size={18} />} {isPinned ? 'Unpin message' : 'Pin message'}
            </button>
          )}
          {canDelete && (
            <button onClick={() => run(onDelete)} className="flex items-center gap-3 w-full px-4 py-3 text-sm font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition text-left">
              <Trash2 size={18} /> Delete message
            </button>
          )}
        </div>
      </div>

      {showPicker && <EmojiPicker onSelect={(e) => run(() => onReact(e))} onClose={() => setShowPicker(false)} />}
    </div>,
    document.body
  );
};

export default MessageActionMenu;
