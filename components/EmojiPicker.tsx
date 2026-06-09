import React, { useRef } from 'react';
import { useModalA11y } from '../hooks/useModalA11y';

const EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
  '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩',
  '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪',
  '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨',
  '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
  '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕',
  '🤢', '🤮', '🤧', '🥵', '🥶', '😎', '🤓', '🧐',
  '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳',
  '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭',
  '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱',
  '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙',
  '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
  '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘',
  '🔥', '✨', '💫', '⭐', '🌟', '💥', '💯', '✅'
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, onClose }) => {
  // Focus-trap + Escape-to-close + focus restore (mounted only while open).
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(true, onClose, dialogRef);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* Use fixed positioning to ensure it's not clipped by overflow-hidden containers on mobile */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pick an emoji"
        tabIndex={-1}
        className="fixed bottom-20 right-4 sm:right-10 w-72 h-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col outline-none animate-in fade-in zoom-in duration-200"
      >
        <div className="p-2 bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700 font-medium text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Pick an Emoji
        </div>
        <div className="flex-1 overflow-y-auto p-2 grid grid-cols-6 gap-1">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => onSelect(emoji)}
              aria-label={`Emoji ${emoji}`}
              className="text-xl p-2 hover:bg-blue-50 dark:hover:bg-slate-700 hover:scale-110 transition rounded cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </>
  );
};

export default EmojiPicker;
