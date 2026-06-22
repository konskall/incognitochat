import { describe, it, expect } from 'vitest';
import { parseTierError } from './tierGatingErrors';

describe('parseTierError', () => {
  it('returns null for a non-tier error', () => {
    expect(parseTierError({ code: '23505', message: 'duplicate key' }, 'free')).toBeNull();
    expect(parseTierError(null, 'free')).toBeNull();
  });

  it('maps QT001 ROOM_LOCKED via error.code', () => {
    const r = parseTierError({ code: 'QT001', message: 'ROOM_LOCKED' }, 'free');
    expect(r?.code).toBe('QT001');
    expect(r?.requiredTier).toBe('basic');
    expect(r?.message).toMatch(/read-only/i);
  });

  it('maps QT002 and upsells to the next tier from currentTier', () => {
    expect(parseTierError({ code: 'QT002', message: 'QUOTA_EXCEEDED:free' }, 'free')?.requiredTier).toBe('basic');
    expect(parseTierError({ code: 'QT002', message: 'QUOTA_EXCEEDED:basic' }, 'basic')?.requiredTier).toBe('ultra');
  });

  it('maps QT003 ROOM_LIMIT', () => {
    const r = parseTierError({ code: 'QT003', message: 'ROOM_LIMIT:free' }, 'free');
    expect(r?.code).toBe('QT003');
    expect(r?.requiredTier).toBe('basic');
  });

  it('maps QT004 ai -> ultra and basic -> basic', () => {
    expect(parseTierError({ code: 'QT004', message: 'TIER_REQUIRED:ai' }, 'free')?.requiredTier).toBe('ultra');
    expect(parseTierError({ code: 'QT004', message: 'TIER_REQUIRED:basic' }, 'free')?.requiredTier).toBe('basic');
  });

  it('maps QT005 TIER_REQUIRED:basic -> basic (clear-messages / notes gate)', () => {
    const r = parseTierError({ code: 'QT005', message: 'TIER_REQUIRED:basic' }, 'free');
    expect(r?.code).toBe('QT005');
    expect(r?.requiredTier).toBe('basic');
    expect(r?.message).toMatch(/Basic/);
  });

  it('falls back to message matching when error.code is absent', () => {
    expect(parseTierError({ message: 'QUOTA_EXCEEDED:free' }, 'free')?.code).toBe('QT002');
    expect(parseTierError({ message: 'TIER_REQUIRED:ai' }, 'free')?.code).toBe('QT004');
  });
});
