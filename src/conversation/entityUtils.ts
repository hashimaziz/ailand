import { npcRegistry } from '../npc/NpcRegistry';

/**
 * Words that must never be treated as entities.
 *
 * Entity overlap is the dominant retrieval signal (+0.30), so a stop word leaking
 * through does real damage: asking "do you like dogs?" made "like" an entity, and
 * any memory mentioning liking anything would score as a match. The list is
 * deliberately conversational rather than grammatical — what matters is whether a
 * word can identify a topic, not whether it is a function word.
 */
const STOP_WORDS = new Set([
  // questions and function words
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'be', 'been',
  'you', 'your', 'yours', 'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'they', 'them',
  'their', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'but', 'with', 'from',
  'what', 'how', 'when', 'where', 'who', 'whom', 'why', 'which', 'that', 'this',
  'these', 'those', 'there', 'here',
  // conversational filler that carries no topic
  'like', 'liked', 'likes', 'want', 'wants', 'need', 'needs', 'know', 'knows',
  'think', 'thinks', 'thinkin', 'said', 'say', 'says', 'tell', 'tells', 'told',
  'going', 'goes', 'went', 'done', 'doing', 'got', 'get', 'gets', 'make', 'makes',
  'made', 'can', 'will', 'would', 'could', 'should', 'have', 'has', 'had', 'been',
  'thing', 'things', 'stuff', 'lot', 'bit', 'much', 'more', 'most', 'very', 'really',
  'just', 'also', 'too', 'well', 'yeah', 'okay', 'ok', 'yes', 'no', 'not', 'never',
  'always', 'sometimes', 'good', 'fine', 'great', 'nice', 'sure', 'please', 'thanks',
  'thank', 'hello', 'hi', 'hey', 'goodbye', 'bye', 'name', 'names', 'called',
  // three-letter function words, since topics are matched from three letters up
  'him', 'her', 'his', 'its', 'off', 'out', 'own', 'per', 'via', 'yet', 'nor',
  'few', 'all', 'any', 'may', 'run', 'saw', 'try', 'use', 'way', 'one', 'two',
  'who', 'why', 'how', 'now', 'new', 'old', 'see', 'get', 'put', 'let', 'and',
  'for', 'but', 'not', 'the', 'you', 'are', 'was', 'our', 'her', 'him', 'had',
  'its', 'was', 'him', 'yes', 'out', 'did', 'got', 'has', 'had', 'too', 'bit',
]);

/**
 * Shortest token treated as a topic.
 *
 * Three, not four: memories are given entity names by the model, which are often
 * three letters ("fox", "dog", "bus"). Filtering the player's message at four
 * while memories keep three means those entities can never match, and the memory
 * is silently unrecallable.
 */
export const MIN_ENTITY_LENGTH = 3;

export function extractMentionedEntities(message: string): string[] {
  const lower = message.toLowerCase();
  const found = new Set<string>(['player']);

  // "What do you do?" names no topic; without this the prompt would claim a
  // perfectly generic memory was relevant.
  if (/(^|\W)(do|does|did)(\s+\w+){0,2}\?*$/i.test(message.trim()) && message.trim().length < 24) {
    return ['player'];
  }

  for (const npc of npcRegistry.getAll()) {
    const name = npc.identity.name.toLowerCase();
    if (lower.includes(name)) {
      found.add(npc.identity.name);
      found.add(npc.id);
    }
  }

  const tokens = lower.match(/[a-z']+/g) ?? [];
  for (const token of tokens) {
      if (token.length >= MIN_ENTITY_LENGTH && !STOP_WORDS.has(token)) {
      found.add(token);
    }
  }

  return Array.from(found);
}
