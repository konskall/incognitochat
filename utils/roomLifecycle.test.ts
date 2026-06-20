import { describe, it, expect } from 'vitest';
import { parseRoomDeletedPayload, expiryShortLabel, isExpired } from './roomLifecycle';

const NOW = 1_700_000_000_000; // fixed reference instant
const inMin = (m: number) => new Date(NOW + m * 60000).toISOString();

describe('expiryShortLabel', () => {
  it('returns null when no timestamp', () => {
    expect(expiryShortLabel(null, NOW)).toBeNull();
    expect(expiryShortLabel(undefined, NOW)).toBeNull();
  });
  it('returns null when already past or malformed', () => {
    expect(expiryShortLabel(inMin(-1), NOW)).toBeNull();
    expect(expiryShortLabel('not-a-date', NOW)).toBeNull();
  });
  it('formats minutes under an hour', () => {
    expect(expiryShortLabel(inMin(30), NOW)).toBe('~30m');
    expect(expiryShortLabel(inMin(59), NOW)).toBe('~59m');
  });
  it('formats hours from 60 minutes up to a day', () => {
    expect(expiryShortLabel(inMin(60), NOW)).toBe('~1h');
    expect(expiryShortLabel(inMin(23 * 60), NOW)).toBe('~23h');
  });
  it('formats days at/over 1440 minutes', () => {
    expect(expiryShortLabel(inMin(1440), NOW)).toBe('~1d');
  });
});

describe('isExpired', () => {
  it('false when absent', () => {
    expect(isExpired(null, NOW)).toBe(false);
    expect(isExpired(undefined, NOW)).toBe(false);
  });
  it('false when in the future', () => {
    expect(isExpired(inMin(1), NOW)).toBe(false);
  });
  it('true when in the past', () => {
    expect(isExpired(inMin(-1), NOW)).toBe(true);
  });
  it('false when malformed', () => {
    expect(isExpired('garbage', NOW)).toBe(false);
  });
});

describe('parseRoomDeletedPayload', () => {
  it('extracts a string deletedBy', () => {
    expect(parseRoomDeletedPayload({ deletedBy: 'Kostas' })).toEqual({ deletedBy: 'Kostas' });
  });
  it('returns {} for missing / non-string / non-object payloads', () => {
    expect(parseRoomDeletedPayload({})).toEqual({});
    expect(parseRoomDeletedPayload({ deletedBy: 42 })).toEqual({});
    expect(parseRoomDeletedPayload(null)).toEqual({});
    expect(parseRoomDeletedPayload(undefined)).toEqual({});
    expect(parseRoomDeletedPayload('x')).toEqual({});
  });
});
