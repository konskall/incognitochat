import { describe, it, expect } from 'vitest';
import { emojiToFilename, twemojiUrl } from './twemoji';

describe('emojiToFilename', () => {
  it('maps a simple single-codepoint emoji', () => {
    expect(emojiToFilename('👍')).toBe('1f44d');
    expect(emojiToFilename('🔥')).toBe('1f525');
    expect(emojiToFilename('😂')).toBe('1f602');
  });

  it('strips the U+FE0F variation selector (no ZWJ)', () => {
    expect(emojiToFilename('❤️')).toBe('2764'); // U+2764 U+FE0F
    expect(emojiToFilename('✌️')).toBe('270c');
    expect(emojiToFilename('☹️')).toBe('2639');
    expect(emojiToFilename('✍️')).toBe('270d');
    expect(emojiToFilename('❣️')).toBe('2763');
  });

  it('handles emoji without a variation selector unchanged', () => {
    expect(emojiToFilename('⭐')).toBe('2b50');
    expect(emojiToFilename('✅')).toBe('2705');
    expect(emojiToFilename('✨')).toBe('2728');
  });
});

describe('twemojiUrl', () => {
  it('builds a base-path-aware .svg url under /emoji', () => {
    expect(twemojiUrl('🔥')).toMatch(/emoji\/1f525\.svg$/);
    expect(twemojiUrl('❤️')).toMatch(/emoji\/2764\.svg$/);
  });
});
