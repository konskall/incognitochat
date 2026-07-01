import { describe, it, expect } from 'vitest';
import {
  TIER_CONFIG, resolveTier, entitlements, messagesRemaining, canSendBatch, MAX_FILES_PER_SEND, maxTier, type SubscriptionRow,
} from './entitlements';

const T0 = Date.parse('2026-06-14T12:00:00.000Z');
const sub = (over: Partial<SubscriptionRow>): SubscriptionRow =>
  ({ tier: 'basic', status: 'active', current_period_end: null, ...over });

describe('resolveTier (mirror of SQL effective_tier)', () => {
  it('no subscription row -> free', () => {
    expect(resolveTier(null, T0)).toBe('free');
  });
  it('active -> the subscribed tier', () => {
    expect(resolveTier(sub({ tier: 'ultra', status: 'active' }), T0)).toBe('ultra');
    expect(resolveTier(sub({ tier: 'basic', status: 'trialing' }), T0)).toBe('basic');
  });
  it('active wins regardless of an elapsed period_end', () => {
    expect(resolveTier(sub({ tier: 'basic', status: 'active', current_period_end: '2020-01-01T00:00:00.000Z' }), T0)).toBe('basic');
  });
  it('canceled but still within paid period -> tier (grace)', () => {
    expect(resolveTier(sub({ status: 'canceled', current_period_end: '2026-06-20T00:00:00.000Z' }), T0)).toBe('basic');
  });
  it('canceled and period elapsed -> free', () => {
    expect(resolveTier(sub({ status: 'canceled', current_period_end: '2026-06-10T00:00:00.000Z' }), T0)).toBe('free');
  });
  it('past_due within period -> tier; past_due with null period -> free', () => {
    expect(resolveTier(sub({ status: 'past_due', current_period_end: '2026-06-20T00:00:00.000Z' }), T0)).toBe('basic');
    expect(resolveTier(sub({ status: 'past_due', current_period_end: null }), T0)).toBe('free');
  });
  it('unknown/incomplete status -> free', () => {
    expect(resolveTier(sub({ status: 'incomplete', current_period_end: null }), T0)).toBe('free');
  });
});

describe('entitlements + helpers', () => {
  it('exposes the spec limits per tier', () => {
    expect(entitlements('free').msgPerRoomPerDay).toBe(10);
    expect(entitlements('basic').msgPerRoomPerDay).toBe(100);
    expect(entitlements('ultra').msgPerRoomPerDay).toBeNull();
    expect(entitlements('free').maxRooms).toBe(1);
    expect(entitlements('basic').maxRooms).toBe(10);
    expect(entitlements('ultra').maxRooms).toBeNull();
    expect(entitlements('free').roomLifetimeHours).toBe(24);
    expect(entitlements('basic').roomLifetimeHours).toBeNull();
    expect(entitlements('ultra').maxFileBytes).toBe(40 * 1024 * 1024);
    expect(entitlements('free').maxFileBytes).toBe(10 * 1024 * 1024);
  });
  it('gates premium features per tier', () => {
    expect(entitlements('free').canAudioCall).toBe(false);
    expect(entitlements('basic').canAudioCall).toBe(true);
    expect(entitlements('basic').canVideoCall).toBe(false);
    expect(entitlements('basic').canAI).toBe(false);
    expect(entitlements('ultra').canVideoCall).toBe(true);
    expect(entitlements('ultra').canScreenShare).toBe(true);
    expect(entitlements('ultra').canAI).toBe(true);
    expect(entitlements('basic').canRoomAppearance).toBe(true);
    expect(entitlements('basic').canDisappearing).toBe(true);
    expect(entitlements('free').canRoomAppearance).toBe(false);
  });
  it('messagesRemaining clamps at 0 and returns null for unlimited', () => {
    expect(messagesRemaining('free', 0)).toBe(10);
    expect(messagesRemaining('free', 10)).toBe(0);
    expect(messagesRemaining('free', 15)).toBe(0);
    expect(messagesRemaining('ultra', 9999)).toBeNull();
  });
});

describe('canMultiUpload', () => {
  it('is premium-only', () => {
    expect(entitlements('free').canMultiUpload).toBe(false);
    expect(entitlements('basic').canMultiUpload).toBe(true);
    expect(entitlements('ultra').canMultiUpload).toBe(true);
  });
});

describe('canClearMessages', () => {
  it('is premium-only (Basic+)', () => {
    expect(entitlements('free').canClearMessages).toBe(false);
    expect(entitlements('basic').canClearMessages).toBe(true);
    expect(entitlements('ultra').canClearMessages).toBe(true);
  });
});

describe('canSendBatch', () => {
  it('rejects empty selections', () => {
    expect(canSendBatch(0, null)).toEqual({ ok: false, reason: 'empty', limit: 0 });
  });
  it('allows within the file ceiling when quota is unlimited', () => {
    expect(canSendBatch(3, null)).toEqual({ ok: true });
    expect(canSendBatch(MAX_FILES_PER_SEND, null)).toEqual({ ok: true });
  });
  it('rejects more than the file ceiling', () => {
    expect(canSendBatch(MAX_FILES_PER_SEND + 1, null)).toEqual({ ok: false, reason: 'max', limit: MAX_FILES_PER_SEND });
  });
  it('rejects when the batch exceeds remaining daily quota', () => {
    expect(canSendBatch(5, 3)).toEqual({ ok: false, reason: 'quota', limit: 3 });
  });
  it('allows when the batch exactly fits remaining quota', () => {
    expect(canSendBatch(3, 3)).toEqual({ ok: true });
  });
});

describe('maxTier (host-tier inheritance)', () => {
  it('returns the higher-ranked tier (free < basic < ultra)', () => {
    expect(maxTier('free', 'ultra')).toBe('ultra');
    expect(maxTier('ultra', 'free')).toBe('ultra');
    expect(maxTier('free', 'basic')).toBe('basic');
    expect(maxTier('basic', 'free')).toBe('basic');
    expect(maxTier('basic', 'ultra')).toBe('ultra');
    expect(maxTier('free', 'free')).toBe('free');
    expect(maxTier('ultra', 'ultra')).toBe('ultra');
  });
});
