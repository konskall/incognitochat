import { describe, it, expect } from 'vitest';
import { makeTempId, buildTempMessage, reconcileTemp, markMessageStatus, TempMessageParams } from './optimisticSend';
import { Message } from '../types';

const params = (over: Partial<TempMessageParams> = {}): TempMessageParams => ({
  tempId: 'temp_x', text: 'hello', uid: 'u1', username: 'Alice', avatarURL: '',
  createdAt: '2026-06-24T10:00:00.000Z', replyTo: null, ...over,
});
const real = (id: string, over: Partial<Message> = {}): Message => ({
  id, text: 'hello', uid: 'u1', username: 'Alice', avatarURL: '',
  createdAt: '2026-06-24T10:00:00.050Z', reactions: {}, type: 'text', ...over,
});

describe('makeTempId', () => {
  it('is unique and temp-prefixed', () => {
    const a = makeTempId(), b = makeTempId();
    expect(a.startsWith('temp_')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('buildTempMessage', () => {
  it('builds a sending text message with the temp id and empty reactions', () => {
    const m = buildTempMessage(params());
    expect(m.id).toBe('temp_x');
    expect(m.status).toBe('sending');
    expect(m.type).toBe('text');
    expect(m.text).toBe('hello');
    expect(m.reactions).toEqual({});
  });
  it('carries a reply quote when given', () => {
    const m = buildTempMessage(params({ replyTo: { id: 'r1', username: 'Bob', text: 'hi', isAttachment: false } }));
    expect(m.replyTo).toEqual({ id: 'r1', username: 'Bob', text: 'hi', isAttachment: false });
  });
});

describe('reconcileTemp', () => {
  it('replaces the temp in place when only the temp is present (insert-resolve, echo not yet seen)', () => {
    const msgs = [real('m0'), buildTempMessage(params())];
    const out = reconcileTemp(msgs, 'temp_x', real('server-1'));
    expect(out.map((m) => m.id)).toEqual(['m0', 'server-1']);
    expect(out[1].status).toBeUndefined();
  });
  it('drops the temp (no duplicate) when the real row already arrived via echo first', () => {
    const msgs = [real('m0'), real('server-1'), buildTempMessage(params())];
    const out = reconcileTemp(msgs, 'temp_x', real('server-1'));
    expect(out.map((m) => m.id)).toEqual(['m0', 'server-1']);
  });
  it('is a no-op when the real row is present and the temp is already gone (second path runs)', () => {
    const msgs = [real('m0'), real('server-1')];
    const out = reconcileTemp(msgs, 'temp_x', real('server-1'));
    expect(out).toBe(msgs);
  });
  it('does not resurrect a message when neither temp nor real is present', () => {
    const msgs = [real('m0')];
    const out = reconcileTemp(msgs, 'temp_x', real('server-1'));
    expect(out).toBe(msgs);
  });
});

describe('markMessageStatus', () => {
  it('sets a status', () => {
    const msgs = [buildTempMessage(params())];
    expect(markMessageStatus(msgs, 'temp_x', 'failed')[0].status).toBe('failed');
  });
  it('clears the status with undefined', () => {
    const msgs = [buildTempMessage(params())];
    expect(markMessageStatus(msgs, 'temp_x', undefined)[0].status).toBeUndefined();
  });
  it('returns the same ref when the id is not found (no re-render)', () => {
    const msgs = [buildTempMessage(params())];
    expect(markMessageStatus(msgs, 'nope', 'failed')).toBe(msgs);
  });
});
