import { describe, it, expect } from 'vitest';
import { parseRoomDeletedPayload } from './roomLifecycle';

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
