// Translates Phase-1 server tier-gating errors (stable Postgres SQLSTATEs) into
// English copy + the tier the user must upgrade to. The DB is the authoritative
// gate; this only formats what the server already enforced.
//
// Server contract (verified): supabase-js puts the SQLSTATE on error.code and the
// RAISE text on error.message:
//   QT001  "ROOM_LOCKED"
//   QT002  "QUOTA_EXCEEDED:<currentTier>"
//   QT003  "ROOM_LIMIT:<currentTier>"
//   QT004  "TIER_REQUIRED:ai"    -> needs ultra
//          "TIER_REQUIRED:basic" -> needs basic
//   QT005  "TIER_REQUIRED:basic" -> needs basic
//          (clear_room_messages / get_or_create_notes_room — basic+ gates added
//           after QT001-QT004; handled identically to QT004 via the suffix.)
import { Tier } from './entitlements';

export type TierErrorCode = 'QT001' | 'QT002' | 'QT003' | 'QT004' | 'QT005';

export interface TierError {
  code: TierErrorCode;
  requiredTier: 'basic' | 'ultra'; // tier the user must reach to proceed
  message: string;                 // English, ready to show
}

const QT_CODES: TierErrorCode[] = ['QT001', 'QT002', 'QT003', 'QT004', 'QT005'];

// Next paid tier up from the user's current tier (quota / room-limit upsell).
function nextTierUp(current: Tier): 'basic' | 'ultra' {
  return current === 'free' ? 'basic' : 'ultra';
}

function extractCode(err: any): TierErrorCode | null {
  const raw = (err?.code ?? '').toString().toUpperCase();
  if ((QT_CODES as string[]).includes(raw)) return raw as TierErrorCode;
  // A present-but-different SQLSTATE means a NON-tier error — don't message-match
  // (avoids a false upsell when an unrelated error's text happens to contain a
  // gating keyword). Only fall back to the message when there's no usable code
  // (some transports strip err.code).
  if (raw) return null;
  const msg = (err?.message ?? '').toString().toUpperCase();
  for (const c of QT_CODES) if (msg.includes(c)) return c;
  if (msg.includes('ROOM_LOCKED')) return 'QT001';
  if (msg.includes('QUOTA_EXCEEDED')) return 'QT002';
  if (msg.includes('ROOM_LIMIT')) return 'QT003';
  if (msg.includes('TIER_REQUIRED')) return 'QT004';
  return null;
}

// Parse a thrown error. `currentTier` lets quota/room-limit errors point at the
// right upsell tier. Returns null if the error is not a tier-gating error.
export function parseTierError(err: any, currentTier: Tier = 'free'): TierError | null {
  const code = extractCode(err);
  if (!code) return null;
  const msg = (err?.message ?? '').toString();

  if (code === 'QT001') {
    // The lock is OWNER-scoped (reconcile_entitlements locks the owner's excess
    // rooms by their plan limit), so a non-owner viewer upgrading won't clear it —
    // don't promise that. ChatScreen surfaces this as an info toast, not an upsell.
    return { code, requiredTier: nextTierUp(currentTier), message: "This room is read-only — the owner's plan limit was reached." };
  }
  if (code === 'QT002') {
    return { code, requiredTier: nextTierUp(currentTier), message: "You've reached today's message limit in this room. Upgrade to send more." };
  }
  if (code === 'QT003') {
    return { code, requiredTier: nextTierUp(currentTier), message: "You've reached your room limit. Upgrade to create more rooms." };
  }
  // QT004 / QT005 — suffix encodes the required tier directly ('ai' => ultra, else basic).
  const needsUltra = /TIER_REQUIRED:\s*ai/i.test(msg);
  const req: 'basic' | 'ultra' = needsUltra ? 'ultra' : 'basic';
  return { code, requiredTier: req, message: `This feature is available on ${req === 'ultra' ? 'Ultra' : 'Basic'}.` };
}
