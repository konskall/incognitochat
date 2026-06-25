import { Message } from '../types';

// How many recent messages inco gets, and how many chars of each. The cap is on
// REQUESTS (rate limits), not tokens — we have huge TPM headroom — so a wider,
// less-truncated window improves answers at zero extra API calls.
const MAX_TURNS = 24;
const MAX_CHARS = 700;

// Turn the held messages into Gemini-style conversation turns so inco follows the
// thread (instead of one flattened blob). The bot's own messages become 'model'
// turns; everyone else is a 'user' turn prefixed with their name (group chat),
// plus who they're replying to so inco can track sub-threads.
export function buildIncoTurns(
  messages: Message[],
  botUuid: string,
  maxTurns = MAX_TURNS,
): { role: 'user' | 'model'; text: string }[] {
  return messages
    .filter((m) => m.type !== 'system')
    .map((m) => {
      // A poll usually carries no body text — surface it so inco isn't blind to
      // it. Images/files are deliberately NOT described: inco can't see them and
      // a placeholder tag only invites hallucinated descriptions.
      const body = m.poll
        ? `[poll: ${m.poll.question}${m.poll.options.length ? ` — options: ${m.poll.options.map((o) => o.text).join(', ')}` : ''}]`
        : (m.text || '');
      return { m, body };
    })
    .filter(({ body }) => !!body)
    .slice(-maxTurns)
    .map(({ m, body }) => {
      const text = body.substring(0, MAX_CHARS);
      if (m.uid === botUuid) return { role: 'model' as const, text };
      const who = m.replyTo ? `${m.username} (reply to ${m.replyTo.username})` : m.username;
      return { role: 'user' as const, text: `${who}: ${text}` };
    });
}
