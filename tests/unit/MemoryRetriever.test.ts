import { describe, it, expect } from 'vitest';
import { MemoryRetriever, MIN_RELEVANCE } from '../../src/memory/MemoryRetriever';
import { Memory } from '../../src/memory/types';

const NOW = 10_000;

function memory(over: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    npcId: 'npc1',
    type: 'episodic',
    content: 'Player likes dogs',
    importance: 0.9,
    confidence: 1,
    source: 'player',
    entities: ['player', 'dogs'],
    createdAt: NOW - 3600,
    lastAccessedAt: NOW - 3600,
    ...over,
  };
}

const query = {
  npcId: 'npc1',
  playerMessage: 'Do you like dogs?',
  mentionedEntities: ['player', 'dogs'],
  currentTime: NOW,
};

describe('MemoryRetriever ranking', () => {
  it('ranks an entity-matching memory first', () => {
    const retriever = new MemoryRetriever();
    const result = retriever.retrieve(query, [
      memory(),
      memory({
        id: 'm2',
        type: 'fact',
        source: 'world',
        content: 'Coffee shop is open',
        importance: 0.5,
        entities: ['coffee shop'],
      }),
    ]);

    expect(result[0].memory.id).toBe('m1');
    expect(result[0].reasons).toContain('entity_match');
  });

  it('drops memories that match nothing about the message', () => {
    const retriever = new MemoryRetriever();
    const result = retriever.retrieve(query, [
      memory(),
      // Scores on importance and recency alone, with nothing tying it to the
      // question. Offering it would put unrelated material in the prompt.
      memory({
        id: 'unrelated',
        content: 'The shopkeeper once sold a bicycle',
        importance: 0.5,
        entities: ['shopkeeper'],
      }),
    ]);

    expect(result.map((m) => m.memory.id)).toEqual(['m1']);
  });

  it('keeps a memory that matches by location', () => {
    const retriever = new MemoryRetriever();
    const result = retriever.retrieve(
      { ...query, currentLocationId: 'park' },
      [memory({ id: 'parkish', entities: [], importance: 0.5, locationId: 'park' })],
    );

    expect(result.map((m) => m.memory.id)).toEqual(['parkish']);
    expect(result[0].score).toBeGreaterThanOrEqual(MIN_RELEVANCE);
  });

  it('keeps an important memory that only matches on importance and recency', () => {
    const retriever = new MemoryRetriever();
    const result = retriever.retrieve(query, [
      memory({ id: 'important', entities: [], importance: 0.95 }),
    ]);
    expect(result.map((m) => m.memory.id)).toEqual(['important']);
  });

  it('respects an explicit limit', () => {
    const retriever = new MemoryRetriever();
    const many = Array.from({ length: 6 }, (_, i) =>
      memory({ id: `m${i}`, content: `Player has dog number ${i}` }),
    );
    expect(retriever.retrieve(query, many, { limit: 3 })).toHaveLength(3);
  });

  it('can be asked for everything by disabling the floor', () => {
    const retriever = new MemoryRetriever();
    const result = retriever.retrieve(
      query,
      [memory(), memory({ id: 'unrelated', entities: [], importance: 0.5 })],
      { minScore: 0 },
    );
    expect(result).toHaveLength(2);
  });

  it('returns nothing when nothing is relevant', () => {
    const retriever = new MemoryRetriever();
    const result = retriever.retrieve(query, [
      memory({ id: 'old', entities: [], importance: 0.3, createdAt: 0 }),
    ]);
    expect(result).toEqual([]);
  });
});