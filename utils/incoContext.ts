import { Message } from '../types';

// Turn the held messages into Gemini-style conversation turns so inco follows the
// thread (instead of one flattened blob). The bot's own messages become 'model'
// turns; everyone else is a 'user' turn prefixed with their name (group chat).
export function buildIncoTurns(
  messages: Message[],
  botUuid: string,
  maxTurns = 16,
): { role: 'user' | 'model'; text: string }[] {
  return messages
    .filter((m) => m.type !== 'system' && m.text)
    .slice(-maxTurns)
    .map((m) =>
      m.uid === botUuid
        ? { role: 'model' as const, text: m.text.substring(0, 300) }
        : { role: 'user' as const, text: `${m.username}: ${m.text.substring(0, 300)}` },
    );
}
