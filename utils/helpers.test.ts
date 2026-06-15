import { describe, it, expect, afterEach } from 'vitest';
import { generateRoomKey, getYouTubeId, getDisplayMediaSupported, displayMediaErrorMessage, cleanUrl } from './helpers';
import { encryptMessage, decryptMessage } from './crypto';

describe('encrypt/decrypt', () => {
  const pin = '1234';
  const roomKey = 'myroom_1234';

  it('round-trips a message', () => {
    const text = 'hello world 🌍';
    const enc = encryptMessage(text, pin, roomKey);
    expect(enc).not.toBe(text);
    expect(decryptMessage(enc, pin, roomKey)).toBe(text);
  });

  it('returns empty string for empty input', () => {
    expect(encryptMessage('', pin, roomKey)).toBe('');
    expect(decryptMessage('', pin, roomKey)).toBe('');
  });

  it('uses a random IV so identical plaintext encrypts differently', () => {
    const a = encryptMessage('same', pin, roomKey);
    const b = encryptMessage('same', pin, roomKey);
    expect(a).not.toBe(b);
    expect(decryptMessage(a, pin, roomKey)).toBe('same');
    expect(decryptMessage(b, pin, roomKey)).toBe('same');
  });

  it('does not reveal the plaintext when decrypted with the wrong PIN', () => {
    const enc = encryptMessage('secret', pin, roomKey);
    const wrong = decryptMessage(enc, '0000', roomKey);
    expect(wrong).not.toBe('secret');
  });
});

describe('generateRoomKey', () => {
  it('lowercases and trims the room name and joins with the pin', () => {
    expect(generateRoomKey('1234', '  MyRoom ')).toBe('myroom_1234');
  });
});

describe('getYouTubeId', () => {
  it('extracts the id from watch / youtu.be / shorts URLs', () => {
    expect(getYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(getYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(getYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-YouTube URLs', () => {
    expect(getYouTubeId('https://example.com/video')).toBeNull();
  });

  it('does not false-positive on non-YouTube hosts with v/ or 11-char paths', () => {
    expect(getYouTubeId('https://files.example.com/v/abcdefghijk')).toBeNull();
    expect(getYouTubeId('look at this tv/abcdefghijk thing')).toBeNull();
  });

  it('rejects host-spoofing and substring-in-path/fragment attacks', () => {
    // Host SUFFIX spoof: "notyoutube.com" must not be treated as youtube.com.
    expect(getYouTubeId('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    // youtube.com/watch?v=… hidden in the #fragment of an attacker domain.
    expect(getYouTubeId('https://attacker-tracker.com/collect#youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    // youtube.com/watch?v=… hidden in the PATH of an attacker domain.
    expect(getYouTubeId('https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('accepts the embed form and subdomains/nocookie', () => {
    expect(getYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(getYouTubeId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(getYouTubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
});

describe('decryptMessage legacy handling', () => {
  it('returns legacy plaintext containing a colon as-is (not the wrong-PIN placeholder)', () => {
    // Not IV:ciphertext (no 32-hex prefix) — must fall through to legacy, not AES.
    expect(decryptMessage('see you at 10:30', '1234', 'r_1234')).toBe('see you at 10:30');
  });
});

describe('cleanUrl', () => {
  it('strips sentence-final punctuation', () => {
    expect(cleanUrl('https://example.com.')).toBe('https://example.com');
    expect(cleanUrl('https://example.com),')).toBe('https://example.com');
  });
  it('keeps balanced trailing parens (Wikipedia-style)', () => {
    expect(cleanUrl('https://en.wikipedia.org/wiki/Pin_(disambiguation)')).toBe('https://en.wikipedia.org/wiki/Pin_(disambiguation)');
    expect(cleanUrl('https://en.wikipedia.org/wiki/Pin_(disambiguation).')).toBe('https://en.wikipedia.org/wiki/Pin_(disambiguation)');
  });
});

describe('getDisplayMediaSupported', () => {
  const orig = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  afterEach(() => {
    if (orig) Object.defineProperty(navigator, 'mediaDevices', orig);
  });

  it('is true when getDisplayMedia exists', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia: () => {} }, configurable: true,
    });
    expect(getDisplayMediaSupported()).toBe(true);
  });

  it('is false when getDisplayMedia is missing (iOS)', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
    expect(getDisplayMediaSupported()).toBe(false);
  });
});

describe('displayMediaErrorMessage', () => {
  it('returns null when the user cancels the picker', () => {
    expect(displayMediaErrorMessage({ name: 'NotAllowedError' })).toBeNull();
    expect(displayMediaErrorMessage({ name: 'AbortError' })).toBeNull();
  });
  it('explains a screen that cannot be captured', () => {
    expect(displayMediaErrorMessage({ name: 'NotReadableError' })).toMatch(/in use/i);
  });
  it('falls back to a generic message', () => {
    expect(displayMediaErrorMessage({ name: 'WeirdError' })).toMatch(/could not start screen sharing/i);
    expect(displayMediaErrorMessage(null)).toMatch(/could not start screen sharing/i);
  });
});
