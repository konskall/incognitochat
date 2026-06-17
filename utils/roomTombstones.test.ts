import { describe, it, expect, beforeEach } from 'vitest';
import { readTombstones, upsertTombstone, removeTombstone, type RoomTombstone } from './roomTombstones';

// Minimal in-memory localStorage so the test is independent of the test env.
function installStorage() {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

const T: RoomTombstone = {
  room_key: 'rk1', room_name: 'Room', pin: '1234',
  created_by: 'u1', expires_at: '2026-01-01T00:00:00.000Z', name: 'Room',
};

describe('roomTombstones', () => {
  beforeEach(() => { installStorage(); });

  it('returns {} when none stored', () => {
    expect(readTombstones('u1')).toEqual({});
  });
  it('upserts and reads back by room_key', () => {
    upsertTombstone('u1', T);
    expect(readTombstones('u1')).toEqual({ rk1: T });
  });
  it('scopes by uid', () => {
    upsertTombstone('u1', T);
    expect(readTombstones('u2')).toEqual({});
  });
  it('removes an entry', () => {
    upsertTombstone('u1', T);
    removeTombstone('u1', 'rk1');
    expect(readTombstones('u1')).toEqual({});
  });
  it('tolerates corrupt JSON', () => {
    localStorage.setItem('roomTombstones_u1', '{not json');
    expect(readTombstones('u1')).toEqual({});
  });
});
