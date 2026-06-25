import { describe, it, expect } from 'vitest';
import { computeSeenBy, ReadReceipt } from './readReceipts';
import { Message, Presence } from '../types';

const BOT = '00000000-0000-0000-0000-000000000000';
const msg = (over: Partial<Message>): Message => ({
  id: 'm1', text: 'hi', uid: 'me', username: 'Me', avatarURL: '', createdAt: '2026-06-26T10:00:00.000Z', ...over,
});
const part = (uid: string, username: string): Presence => ({
  uid, username, avatar: `https://x/${uid}.png`, status: 'active', isTyping: false, onlineAt: '',
});
const recs = (e: Record<string, ReadReceipt>) => new Map(Object.entries(e));

describe('computeSeenBy', () => {
  const M = msg({ uid: 'me', createdAt: '2026-06-26T10:00:00.000Z' });
  const parts = [part('me', 'Me'), part('a', 'Alice'), part('b', 'Bob'), part(BOT, 'inco')];

  it('lists members whose read position is at/after the message, with their seen-at time', () => {
    const r = recs({
      a: { pos: '2026-06-26T10:05:00.000Z', at: '2026-06-26T10:05:30.000Z' }, // read past it
      b: { pos: '2026-06-26T09:00:00.000Z', at: '2026-06-26T09:00:10.000Z' }, // before it
    });
    const out = computeSeenBy(M, r, parts, 'me');
    expect(out).toEqual([{ uid: 'a', username: 'Alice', avatar: 'https://x/a.png', at: '2026-06-26T10:05:30.000Z' }]);
  });

  it('excludes the viewer, the author, and the bot', () => {
    const r = recs({
      me: { pos: '2026-06-26T11:00:00.000Z', at: '2026-06-26T11:00:00.000Z' },
      [BOT]: { pos: '2026-06-26T11:00:00.000Z', at: '2026-06-26T11:00:00.000Z' },
    });
    // viewer is 'a' here; author 'me' and bot both excluded
    expect(computeSeenBy(M, r, parts, 'a')).toEqual([]);
  });

  it('sorts newest-seen first', () => {
    const r = recs({
      a: { pos: '2026-06-26T10:01:00.000Z', at: '2026-06-26T10:01:00.000Z' },
      b: { pos: '2026-06-26T10:01:00.000Z', at: '2026-06-26T10:09:00.000Z' },
    });
    expect(computeSeenBy(M, r, parts, 'me').map((s) => s.username)).toEqual(['Bob', 'Alice']);
  });

  it('ignores members with no receipt and offline (not-in-participants) readers', () => {
    const r = recs({ ghost: { pos: '2026-06-26T12:00:00.000Z', at: '2026-06-26T12:00:00.000Z' } });
    expect(computeSeenBy(M, r, parts, 'me')).toEqual([]); // 'ghost' isn't a participant
  });

  it('returns [] for a message with a missing/invalid timestamp', () => {
    expect(computeSeenBy(msg({ createdAt: '' }), recs({}), parts, 'me')).toEqual([]);
    expect(computeSeenBy(msg({ createdAt: 'nope' }), recs({}), parts, 'me')).toEqual([]);
  });
});
