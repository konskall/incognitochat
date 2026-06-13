import { describe, it, expect } from 'vitest';
import { applyTypingEvent, liveTypers, applyReadReceipt, TYPING_TTL_MS } from './useRoomPresence';

const ev = (uid: string, typing: boolean, username = uid) => ({ uid, username, typing });

describe('typing broadcast records', () => {
  it('a typing:true event shows the user immediately', () => {
    const recs = applyTypingEvent(new Map(), ev('a', true, 'Alice'), 1000);
    expect(liveTypers(recs, 1000)).toEqual(['Alice']);
  });

  it('expires a typer TTL ms after its last typing event (dead client / missed stop)', () => {
    const recs = applyTypingEvent(new Map(), ev('a', true, 'Alice'), 1000);
    expect(liveTypers(recs, 1000 + TYPING_TTL_MS - 1)).toEqual(['Alice']);
    expect(liveTypers(recs, 1000 + TYPING_TTL_MS + 1)).toEqual([]);
  });

  it('a heartbeat (a fresh typing:true) refreshes the expiry — a long message does not vanish', () => {
    let recs = applyTypingEvent(new Map(), ev('a', true, 'Alice'), 1000);
    // Heartbeat just before the original would expire:
    recs = applyTypingEvent(recs, ev('a', true, 'Alice'), 1000 + TYPING_TTL_MS - 100);
    // Past the ORIGINAL expiry, still live thanks to the refresh:
    expect(liveTypers(recs, 1000 + TYPING_TTL_MS + 50)).toEqual(['Alice']);
  });

  it('a typing:false event clears the user immediately', () => {
    let recs = applyTypingEvent(new Map(), ev('a', true, 'Alice'), 1000);
    recs = applyTypingEvent(recs, ev('a', false, 'Alice'), 1100);
    expect(liveTypers(recs, 1100)).toEqual([]);
  });

  it('tracks multiple typers independently', () => {
    let recs = applyTypingEvent(new Map(), ev('a', true, 'Alice'), 1000);
    recs = applyTypingEvent(recs, ev('b', true, 'Bob'), 1000);
    expect(liveTypers(recs, 1000).sort()).toEqual(['Alice', 'Bob']);
    recs = applyTypingEvent(recs, ev('a', false, 'Alice'), 1200);
    expect(liveTypers(recs, 1200)).toEqual(['Bob']);
  });

  it('is immutable — does not mutate the input map', () => {
    const orig = new Map();
    const recs = applyTypingEvent(orig, ev('a', true, 'Alice'), 1000);
    expect(orig.size).toBe(0);
    expect(recs.size).toBe(1);
  });
});

describe('read receipts (applyReadReceipt)', () => {
  it('records a new uid lastReadAt', () => {
    const recs = applyReadReceipt(new Map(), 'a', '2026-06-13T10:00:00.000Z');
    expect(recs.get('a')).toBe('2026-06-13T10:00:00.000Z');
  });

  it('advances monotonically to a newer lastReadAt', () => {
    let recs = applyReadReceipt(new Map(), 'a', '2026-06-13T10:00:00.000Z');
    recs = applyReadReceipt(recs, 'a', '2026-06-13T10:05:00.000Z');
    expect(recs.get('a')).toBe('2026-06-13T10:05:00.000Z');
  });

  it('ignores an older/equal lastReadAt and returns the SAME map ref (no re-render)', () => {
    const recs = applyReadReceipt(new Map(), 'a', '2026-06-13T10:05:00.000Z');
    expect(applyReadReceipt(recs, 'a', '2026-06-13T10:00:00.000Z')).toBe(recs); // older → same ref
    expect(applyReadReceipt(recs, 'a', '2026-06-13T10:05:00.000Z')).toBe(recs); // equal → same ref
  });

  it('tracks receipts per uid independently and is immutable', () => {
    const orig = applyReadReceipt(new Map(), 'a', '2026-06-13T10:00:00.000Z');
    const next = applyReadReceipt(orig, 'b', '2026-06-13T10:01:00.000Z');
    expect([...next.keys()].sort()).toEqual(['a', 'b']);
    expect(orig.has('b')).toBe(false); // original untouched
  });
});
