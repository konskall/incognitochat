import { describe, it, expect } from 'vitest';
import { buildIncoTurns } from './incoContext';
import { Message } from '../types';

const BOT = '00000000-0000-0000-0000-000000000000';
const msg = (over: Partial<Message>): Message => ({
  id: 'x', text: 'hi', uid: 'u1', username: 'Alice', avatarURL: '', createdAt: '2026-06-25T10:00:00Z', ...over,
});

describe('buildIncoTurns', () => {
  it('maps users to user turns (name-prefixed) and the bot to model turns', () => {
    const out = buildIncoTurns([
      msg({ uid: 'u1', username: 'Alice', text: 'hello' }),
      msg({ uid: BOT, username: 'inco', text: 'hi Alice' }),
    ], BOT);
    expect(out).toEqual([
      { role: 'user', text: 'Alice: hello' },
      { role: 'model', text: 'hi Alice' },
    ]);
  });
  it('drops system + empty-text messages and caps to maxTurns (last N)', () => {
    const many = Array.from({ length: 20 }, (_, i) => msg({ id: String(i), text: `m${i}`, username: 'Bob', uid: 'u2' }));
    many.splice(0, 0, msg({ type: 'system', text: 'Room created' }), msg({ text: '' }));
    const out = buildIncoTurns(many, BOT, 16);
    expect(out.length).toBe(16);
    expect(out.every((t) => t.role === 'user')).toBe(true);
    expect(out[out.length - 1].text).toBe('Bob: m19');
  });
  it('truncates long message text to 300 chars (plus the name prefix)', () => {
    const long = 'a'.repeat(500);
    const out = buildIncoTurns([msg({ uid: 'u1', username: 'Al', text: long })], BOT);
    expect(out[0].text).toBe(`Al: ${'a'.repeat(300)}`);
  });
});
