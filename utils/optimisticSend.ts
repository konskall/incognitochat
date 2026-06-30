import { Message, Attachment } from '../types';

// Random temp id for a not-yet-persisted message. Kept separate from
// buildTempMessage so that builder stays pure (testable without randomness).
export function makeTempId(): string {
  return `temp_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export interface TempMessageParams {
  tempId: string;
  text: string;
  uid: string;
  username: string;
  avatarURL: string;
  createdAt: string;
  replyTo: { id: string; username: string; text: string; isAttachment: boolean } | null;
  // Optimistic media: a local-blob-URL Attachment shown instantly, swapped for
  // the uploaded one on reconcile. Omitted for plain text bubbles.
  attachment?: Attachment | null;
}

// The optimistic bubble shown the instant the user hits send.
export function buildTempMessage(p: TempMessageParams): Message {
  return {
    id: p.tempId,
    text: p.text,
    uid: p.uid,
    username: p.username,
    avatarURL: p.avatarURL,
    createdAt: p.createdAt,
    reactions: {},
    replyTo: p.replyTo,
    type: 'text',
    attachment: p.attachment ?? undefined,
    status: 'sending',
  };
}

// Idempotent temp -> real swap. Safe from EITHER the realtime echo path or the
// insert-response path; whichever runs first replaces, the second is a no-op.
// Never produces a duplicate, never resurrects a removed message.
export function reconcileTemp(messages: Message[], tempId: string, realMsg: Message): Message[] {
  const hasReal = messages.some((m) => m.id === realMsg.id);
  if (hasReal) {
    // The real row is already present (the other path won the race) — drop the temp.
    return messages.some((m) => m.id === tempId) ? messages.filter((m) => m.id !== tempId) : messages;
  }
  if (messages.some((m) => m.id === tempId)) {
    // Replace the temp in place (preserves position).
    return messages.map((m) => (m.id === tempId ? realMsg : m));
  }
  // Neither present (temp was removed, e.g. clear-messages) — do not resurrect.
  return messages;
}

// Set/clear the optimistic status of one message. Returns the same array ref
// when nothing changed so React.memo holds.
export function markMessageStatus(
  messages: Message[],
  id: string,
  status: 'sending' | 'failed' | undefined,
): Message[] {
  let changed = false;
  const next = messages.map((m) => {
    if (m.id !== id) return m;
    changed = true;
    const { status: _drop, ...rest } = m;
    return status ? { ...rest, status } : (rest as Message);
  });
  return changed ? next : messages;
}
