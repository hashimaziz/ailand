import { npcRegistry } from '../npc/NpcRegistry';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'you', 'your',
  'i', 'me', 'my', 'we', 'they', 'them', 'to', 'of', 'in', 'on', 'at', 'for', 'and',
  'or', 'but', 'what', 'how', 'when', 'where', 'who', 'why', 'hi', 'hello', 'hey',
]);

export function extractMentionedEntities(message: string): string[] {
  const lower = message.toLowerCase();
  const found = new Set<string>(['player']);

  for (const npc of npcRegistry.getAll()) {
    const name = npc.identity.name.toLowerCase();
    if (lower.includes(name)) {
      found.add(npc.identity.name);
      found.add(npc.id);
    }
  }

  const tokens = lower.match(/[a-z']+/g) ?? [];
  for (const token of tokens) {
    if (token.length >= 3 && !STOP_WORDS.has(token)) {
      found.add(token);
    }
  }

  return Array.from(found);
}
