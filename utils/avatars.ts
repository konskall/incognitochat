// Live avatar resolution. Avatars used to be baked into each message at send
// time (and the member roster derived from the latest message), so a user who
// changed their photo never saw it update on old messages, in the tap-user
// modal, in Members, or in participants. These helpers resolve a user's CURRENT
// avatar instead: the membership roster (`subscribers.avatar_url`, which covers
// offline users and old messages) overlaid by live presence (freshest for
// online users), falling back to the baked message value only when neither knows.

export interface MemberAvatarRow {
  uid: string;
  avatar_url?: string | null;
}

export interface ParticipantAvatar {
  uid: string;
  avatar?: string | null;
}

// True only for a non-empty, non-whitespace string.
function nonEmpty(s: string | null | undefined): s is string {
  return typeof s === 'string' && s.trim().length > 0;
}

// Build the uid -> current-avatar map. Seed from the roster (offline coverage),
// then overlay presence so an online user's freshest avatar wins. Empty /
// whitespace values are skipped so they never clobber a known-good avatar.
export function buildLiveAvatars(
  members: MemberAvatarRow[],
  participants: ParticipantAvatar[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of members) if (nonEmpty(m.avatar_url)) map.set(m.uid, m.avatar_url);
  for (const p of participants) if (nonEmpty(p.avatar)) map.set(p.uid, p.avatar);
  return map;
}

// Resolve the avatar to DISPLAY for a message/user: the live current avatar if
// we have one, else the value baked into the message, else ''.
export function resolveDisplayAvatar(
  uid: string,
  baked: string | null | undefined,
  live: Map<string, string>,
): string {
  const cur = live.get(uid);
  if (nonEmpty(cur)) return cur;
  return baked || '';
}
