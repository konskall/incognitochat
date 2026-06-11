import { describe, it, expect, afterEach } from 'vitest';
import { encryptMessage, decryptMessage, generateRoomKey, getYouTubeId, getDisplayMediaSupported, displayMediaErrorMessage } from './helpers';

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
