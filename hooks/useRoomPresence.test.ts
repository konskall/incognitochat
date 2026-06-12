import { describe, it, expect } from 'vitest';
import { updateTypingRecords, currentTypers, TYPING_TTL_MS, type TyperRecord } from './useRoomPresence';

const cand = (uid: string, onlineAt: string, username = uid) => ({ uid, username, onlineAt });

describe('typing freshness records', () => {
  it('a new typer is fresh and shows immediately', () => {
    const recs = updateTypingRecords(new Map(), [cand('a', 't1', 'Alice')], 1000);
    expect(currentTypers(recs, 1000)).toEqual(['Alice']);
  });

  it('an UNCHANGED payload keeps the original local timestamp and expires after the TTL (dead client)', () => {
    let recs = updateTypingRecords(new Map(), [cand('a', 't1', 'Alice')], 1000);
    // Same onlineAt re-seen in later syncs (dead client still in the snapshot):
    recs = updateTypingRecords(recs, [cand('a', 't1', 'Alice')], 1000 + TYPING_TTL_MS - 1);
    expect(currentTypers(recs, 1000 + TYPING_TTL_MS - 1)).toEqual(['Alice']);
    recs = updateTypingRecords(recs, [cand('a', 't1', 'Alice')], 1000 + TYPING_TTL_MS + 1);
    expect(currentTypers(recs, 1000 + TYPING_TTL_MS + 1)).toEqual([]);
  });

  it('a heartbeat (changed onlineAt) refreshes the typer', () => {
    let recs = updateTypingRecords(new Map(), [cand('a', 't1', 'Alice')], 1000);
    recs = updateTypingRecords(recs, [cand('a', 't2', 'Alice')], 1000 + TYPING_TTL_MS + 500);
    expect(currentTypers(recs, 1000 + TYPING_TTL_MS + 500)).toEqual(['Alice']);
  });

  it('a typer absent from the latest sync is dropped immediately (stopped or left)', () => {
    let recs = updateTypingRecords(new Map(), [cand('a', 't1', 'Alice'), cand('b', 't1', 'Bob')], 1000);
    recs = updateTypingRecords(recs, [cand('b', 't1', 'Bob')], 1100);
    expect(currentTypers(recs, 1100)).toEqual(['Bob']);
  });

  it('is skew-immune: a sender onlineAt far in the past/future still works (only CHANGE matters)', () => {
    // Sender clock is wildly off — onlineAt values are arbitrary strings here.
    let recs = updateTypingRecords(new Map(), [cand('a', '1970-01-01T00:00:00Z', 'Alice')], 5000);
    expect(currentTypers(recs, 5000)).toEqual(['Alice']);
    recs = updateTypingRecords(recs, [cand('a', '1970-01-01T00:00:01Z', 'Alice')], 5000 + TYPING_TTL_MS);
    expect(currentTypers(recs, 5000 + TYPING_TTL_MS)).toEqual(['Alice']);
  });
});
