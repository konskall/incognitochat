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

  it('annotates who a user message replies to (group-chat thread awareness)', () => {
    const out = buildIncoTurns([
      msg({ uid: 'u2', username: 'Bob', text: 'sure', replyTo: { id: 'r1', username: 'Alice', text: 'q', isAttachment: false } }),
    ], BOT);
    expect(out).toEqual([{ role: 'user', text: 'Bob (reply to Alice): sure' }]);
  });

  it('represents a (text-less) poll message as [poll: question — options: ...]', () => {
    const out = buildIncoTurns([
      msg({ uid: 'u1', username: 'Al', text: '', type: 'poll', poll: {
        question: 'Pizza tonight?',
        options: [{ id: '1', text: 'Yes' }, { id: '2', text: 'No' }],
        votes: {}, multi: false, closed: false,
      } }),
    ], BOT);
    expect(out).toEqual([{ role: 'user', text: 'Al: [poll: Pizza tonight? — options: Yes, No]' }]);
  });

  it('drops system + content-less messages and caps to maxTurns (last N)', () => {
    const many = Array.from({ length: 20 }, (_, i) => msg({ id: String(i), text: `m${i}`, username: 'Bob', uid: 'u2' }));
    many.splice(0, 0, msg({ type: 'system', text: 'Room created' }), msg({ text: '' }));
    const out = buildIncoTurns(many, BOT, 16);
    expect(out.length).toBe(16);
    expect(out.every((t) => t.role === 'user')).toBe(true);
    expect(out[out.length - 1].text).toBe('Bob: m19');
  });

  it('defaults to the last 24 turns', () => {
    const many = Array.from({ length: 30 }, (_, i) => msg({ id: String(i), text: `m${i}`, username: 'Bob', uid: 'u2' }));
    const out = buildIncoTurns(many, BOT);
    expect(out.length).toBe(24);
    expect(out[0].text).toBe('Bob: m6');
    expect(out[out.length - 1].text).toBe('Bob: m29');
  });

  it('truncates long message text to 700 chars (plus the name prefix)', () => {
    const long = 'a'.repeat(900);
    const out = buildIncoTurns([msg({ uid: 'u1', username: 'Al', text: long })], BOT);
    expect(out[0].text).toBe(`Al: ${'a'.repeat(700)}`);
  });
});
