// Single source of truth for tier limits on the CLIENT. These numbers MUST match
// the hardcoded limits in the SQL (effective_tier / enforce_message_quota /
// join_or_create_room / reconcile_entitlements). The database is authoritative;
// this mirror exists only so the UI can gray out / show counters instantly.
export type Tier = 'free' | 'basic' | 'ultra';

export interface TierEntitlements {
  msgPerRoomPerDay: number | null; // null = unlimited
  maxRooms: number | null;         // null = unlimited
  maxFileBytes: number;
  roomLifetimeHours: number | null; // free rooms auto-delete after N hours; null = permanent
  canAudioCall: boolean;
  canVideoCall: boolean;
  canScreenShare: boolean;
  canRoomAppearance: boolean;
  canDisappearing: boolean; // disappearing messages + custom auto-delete
  canEmailAlerts: boolean;  // email notifications on new messages
  canAI: boolean;
}

const MB = 1024 * 1024;

export const TIER_CONFIG: Readonly<Record<Tier, Readonly<TierEntitlements>>> = {
  free: {
    msgPerRoomPerDay: 10, maxRooms: 1, maxFileBytes: 10 * MB, roomLifetimeHours: 24,
    canAudioCall: false, canVideoCall: false, canScreenShare: false,
    canRoomAppearance: false, canDisappearing: false, canEmailAlerts: false, canAI: false,
  },
  basic: {
    msgPerRoomPerDay: 100, maxRooms: 10, maxFileBytes: 10 * MB, roomLifetimeHours: null,
    canAudioCall: true, canVideoCall: false, canScreenShare: false,
    canRoomAppearance: true, canDisappearing: true, canEmailAlerts: true, canAI: false,
  },
  ultra: {
    msgPerRoomPerDay: null, maxRooms: null, maxFileBytes: 40 * MB, roomLifetimeHours: null,
    canAudioCall: true, canVideoCall: true, canScreenShare: true,
    canRoomAppearance: true, canDisappearing: true, canEmailAlerts: true, canAI: true,
  },
};

export interface SubscriptionRow {
  tier: 'basic' | 'ultra'; // free users have no subscription row; never 'free' here
  status: string;            // Stripe subscription status, verbatim
  current_period_end: string | null; // ISO timestamp
}

// Mirror of SQL effective_tier(). `nowMs` is injected so tests are deterministic.
export function resolveTier(sub: SubscriptionRow | null, nowMs: number): Tier {
  if (!sub) return 'free';
  const periodMs = sub.current_period_end ? Date.parse(sub.current_period_end) : NaN;
  const inPeriod = Number.isFinite(periodMs) && periodMs > nowMs;
  const entitled =
    sub.status === 'active' ||
    sub.status === 'trialing' ||
    ((sub.status === 'past_due' || sub.status === 'canceled') && inPeriod);
  return entitled ? sub.tier : 'free';
}

export function entitlements(tier: Tier): Readonly<TierEntitlements> {
  return TIER_CONFIG[tier];
}

// Remaining sends today in one room. null = unlimited.
export function messagesRemaining(tier: Tier, sentToday: number): number | null {
  const lim = TIER_CONFIG[tier].msgPerRoomPerDay;
  return lim === null ? null : Math.max(0, lim - sentToday);
}
