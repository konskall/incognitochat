import React, { useState } from 'react';
import { twemojiUrl } from '../utils/twemoji';

interface EmojiProps {
  emoji: string;
  // Sizing/utility classes for the rendered glyph (e.g. "w-7 h-7").
  className?: string;
  // Explicit pixel size. Sizes BOTH the Twemoji image AND the native fallback
  // glyph — so a non-bundled emoji (e.g. a historical reaction outside our SVG
  // set) renders at the right size instead of shrinking to the inherited
  // font-size (which made reactions look microscopic in small `text-xs` badges).
  size?: number;
}

// Renders an emoji as a self-hosted Twemoji SVG so reactions and the picker look
// modern and IDENTICAL on every device (instead of the OS emoji font). Falls
// back to the OS-rendered unicode glyph if the asset is missing — e.g. a
// historical reaction outside our bundled set — so nothing ever shows broken.
const Emoji: React.FC<EmojiProps> = ({ emoji, className = '', size }) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    // Match the fallback glyph to the requested box: without an explicit
    // font-size the native emoji inherits the (often tiny) surrounding text size.
    const fallbackStyle = size
      ? { width: size, height: size, fontSize: Math.round(size * 0.9), lineHeight: 1 }
      : undefined;
    return (
      <span
        className={`inline-flex items-center justify-center leading-none ${className}`}
        style={fallbackStyle}
        role="img"
        aria-label={emoji}
      >
        {emoji}
      </span>
    );
  }
  return (
    <img
      src={twemojiUrl(emoji)}
      alt={emoji}
      draggable={false}
      loading="lazy"
      onError={() => setFailed(true)}
      style={size ? { width: size, height: size } : undefined}
      className={`inline-block object-contain select-none align-[-0.15em] ${className}`}
    />
  );
};

export default React.memo(Emoji);
