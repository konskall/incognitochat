import React, { useState } from 'react';
import { twemojiUrl } from '../utils/twemoji';

interface EmojiProps {
  emoji: string;
  // Sizing/utility classes for the rendered glyph (e.g. "w-7 h-7").
  className?: string;
}

// Renders an emoji as a self-hosted Twemoji SVG so reactions and the picker look
// modern and IDENTICAL on every device (instead of the OS emoji font). Falls
// back to the OS-rendered unicode glyph if the asset is missing — e.g. a
// historical reaction outside our bundled set — so nothing ever shows broken.
const Emoji: React.FC<EmojiProps> = ({ emoji, className = '' }) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={`inline-flex items-center justify-center leading-none ${className}`} role="img" aria-label={emoji}>{emoji}</span>;
  }
  return (
    <img
      src={twemojiUrl(emoji)}
      alt={emoji}
      draggable={false}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`inline-block object-contain select-none align-[-0.15em] ${className}`}
    />
  );
};

export default React.memo(Emoji);
