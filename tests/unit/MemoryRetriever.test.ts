import { describe, it, expect } from 'vitest';
import { MemoryRetriever } from '../../src/memory/MemoryRetriever';
import { Memory } from '../../src/memory/types';

describe('MemoryRetriever', () => {
  it('ranks memories correctly', () => {
    const retriever = new MemoryRetriever();
    
    const memories: Memory[] = [
      {
        id: '1', npcId: 'npc1', type: 'episodic', content: 'Player likes dogs',
        importance: 0.9, confidence: 1, source: 'player', entities: ['player', 'dogs'],
        createdAt: 1000, lastAccessedAt: 1000
      },
      {
        id: '2', npcId: 'npc1', type: 'fact', content: 'Coffee shop is open',
        importance: 0.5, confidence: 1, source: 'world', entities: ['coffee shop'],
        createdAt: 500, lastAccessedAt: 500
      }
    ];

    const result = retriever.retrieve({
      npcId: 'npc1',
      playerMessage: 'Do you like dogs?',
      mentionedEntities: ['dogs'],
      currentTime: 1100
    }, memories);

    expect(result.length).toBe(2);
    // memory 1 should rank higher due to entity match and high importance
    expect(result[0].memory.id).toBe('1');
    expect(result[0].reasons).toContain('entity_match');
  });
});
