import { describe, it, expect, beforeAll } from 'vitest';
import { extractMentionedEntities } from '../../src/conversation/entityUtils';
import { npcRegistry } from '../../src/npc/NpcRegistry';
import { fixtures } from '../../src/npc/fixtures';

beforeAllFixtures();

function beforeAllFixtures() {
  for (const npc of fixtures) npcRegistry.register(npc);
}

describe('extractMentionedEntities', () => {
  beforeAll(() => beforeAllFixtures());

  it('always includes the player', () => {
    expect(extractMentionedEntities('Hello there')).toContain('player');
  });

  it('finds topics in the message', () => {
    const entities = extractMentionedEntities('Do you like dogs?');
    expect(entities).toContain('dogs');
  });

  it('does not turn conversational verbs into entities', () => {
    // "like" was previously an entity, so any memory mentioning liking anything
    // scored as a match — the largest retrieval signal, from the word "like".
    const entities = extractMentionedEntities('Do you like dogs?');
    expect(entities).not.toContain('like');
    expect(entities).not.toContain('you');
  });

  it('ignores short noise words', () => {
    const entities = extractMentionedEntities('It is a bit of a thing');
    for (const word of ['thing', 'the', 'bit']) {
      expect(entities).not.toContain(word);
    }
  });

  it('matches three-letter topics that memories use', () => {
    // Memories get short entity names from the model ("fox"); if the player's
    // message filtered them out, the memory could never be recalled.
    expect(extractMentionedEntities('Did you see the fox?')).toContain('fox');
  });

  it('recognises an NPC by name', () => {
    const entities = extractMentionedEntities('Have you seen David today?');
    expect(entities).toContain('David');
    expect(entities).toContain('npc_2');
  });

  it('returns almost nothing for a contentless question', () => {
    // "What do you do?" must not pull in unrelated memories.
    expect(extractMentionedEntities('What do you do?')).toEqual(['player']);
  });

  it('keeps a topic even in a short question', () => {
    expect(extractMentionedEntities('What about the park?')).toContain('park');
  });

  it('handles punctuation and case', () => {
    const entities = extractMentionedEntities('Tell me about the FOX!');
    expect(entities).toContain('fox');
  });
});