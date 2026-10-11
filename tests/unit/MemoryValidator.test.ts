import { describe, it, expect } from 'vitest';
import {
  MemoryValidator,
  contentSimilarity,
  normalizeCandidate,
  normalizeText,
} from '../../src/memory/MemoryValidator';
import { MemoryCandidate } from '../../src/memory/MemoryTypes';
import { MEMORY_CONFIG } from '../../src/config/gameConfig';

function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    type: 'episodic',
    content: 'The player said they work at the hospital nearby.',
    importance: 0.7,
    confidence: 0.9,
    source: 'player',
    entities: ['player', 'hospital'],
    ...overrides,
  };
}

describe('normalizeText', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeText('  The Player, said: "hi!"  ')).toBe('the player said hi');
  });
});

describe('contentSimilarity', () => {
  it('is 1 for identical content', () => {
    expect(contentSimilarity('player has a dog', 'Player has a dog!')).toBe(1);
  });

  it('is 0 for disjoint content', () => {
    expect(contentSimilarity('alpha beta', 'gamma delta')).toBe(0);
  });

  it('is partial for overlapping content', () => {
    const score = contentSimilarity('the player has a dog', 'the player has a cat');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe('normalizeCandidate', () => {
  it('repairs out-of-range numbers and coerces entities', () => {
    const { candidate: result, reasons } = normalizeCandidate({
      type: 'belief',
      content: '  spaced   out  ',
      importance: 4,
      confidence: -1,
      source: 'inference',
      entities: ['Player', 'player', 'Hospital', 7],
    });

    expect(result).not.toBeNull();
    expect(result!.importance).toBe(1);
    expect(result!.confidence).toBe(0);
    expect(result!.content).toBe('spaced out');
    expect(result!.entities).toEqual(['player', 'hospital']);
    expect(reasons.join(' ')).toContain('clamped');
  });

  it('rejects an invalid type outright', () => {
    const { candidate: result, reasons } = normalizeCandidate({
      type: 'vibes',
      content: 'something',
      importance: 0.5,
      confidence: 0.5,
      source: 'player',
    });
    expect(result).toBeNull();
    expect(reasons.join(' ')).toContain('invalid memory type');
  });

  it('survives garbage input without throwing', () => {
    expect(normalizeCandidate(null).candidate).toBeNull();
    expect(normalizeCandidate('nope').candidate).toBeNull();
    expect(normalizeCandidate({ type: 'fact', source: 'world', content: 'ok' }).reasons.length)
      .toBeGreaterThan(0);
  });

  it('truncates oversized content', () => {
    const { candidate: result, reasons } = normalizeCandidate({
      type: 'episodic',
      content: 'x'.repeat(MEMORY_CONFIG.maxContentChars + 100),
      importance: 0.5,
      confidence: 0.5,
      source: 'player',
    });
    expect(result!.content).toHaveLength(MEMORY_CONFIG.maxContentChars);
    expect(reasons.join(' ')).toContain('truncated');
  });
});

describe('MemoryValidator.validateProposal', () => {
  const validator = new MemoryValidator();

  it('accepts a well-formed player-sourced memory', () => {
    expect(validator.validateProposal(candidate())).toEqual([]);
  });

  it('refuses model claims of world authority', () => {
    const reasons = validator.validateProposal(
      candidate({ source: 'world', type: 'fact' }),
    );
    expect(reasons.join(' ')).toContain('authoritative world source');
    expect(reasons.join(' ')).toContain('canonical fact');
  });

  it('refuses a canonical fact from any model source', () => {
    const reasons = validator.validateProposal(candidate({ type: 'fact', source: 'player' }));
    expect(reasons.join(' ')).toContain('canonical fact');
  });

  it('drops low-importance chatter', () => {
    const reasons = validator.validateProposal(
      candidate({ importance: 0.1, content: 'The player said hello in the street.' }),
    );
    expect(reasons.join(' ')).toContain('below threshold');
  });

  it('rejects memories written in the NPC\'s own first person', () => {
    // Observed with Qwen2.5-3B: extraction produced "I just moved into the
    // apartments" — the player's event in the NPC's voice. Read back as a memory
    // it teaches the NPC it was the one who moved in.
    for (const content of [
      "I'm new to the area.",
      'I just moved into the apartments above the bakery.',
      'My name is Maria.',
      'I work as a barista at the West Coffee Shop.',
    ]) {
      const reasons = validator.validateProposal(candidate({ content, type: 'belief' }));
      expect(reasons.join(' '), content).toContain('first person');
    }
  });

  it('accepts the same memory written in the third person', () => {
    expect(
      validator.validateProposal(
        candidate({ content: 'Alex just moved into the apartments above the bakery.' }),
      ),
    ).toEqual([]);
  });

  it('accepts third-person memories that merely mention a pronoun later', () => {
    expect(
      validator.validateProposal(
        candidate({ content: 'Alex said that he misses his old flat in the city.' }),
      ),
    ).toEqual([]);
  });

  it('drops placeholder content', () => {
    const reasons = validator.validateProposal(candidate({ content: 'n/a' }));
    expect(reasons.join(' ')).toContain('placeholder');
  });

  it('drops content that is too short to mean anything', () => {
    const reasons = validator.validateProposal(candidate({ content: 'ok' }));
    expect(reasons.join(' ')).toContain('too short');
  });

  it('requires confidence for relationship memories', () => {
    const reasons = validator.validateProposal(
      candidate({ type: 'relationship', confidence: 0.3 }),
    );
    expect(reasons.join(' ')).toContain('confidence');
  });
});

describe('MemoryValidator.findDuplicate', () => {
  const validator = new MemoryValidator();

  const existing = [
    {
      id: 'm1',
      npcId: 'npc_1',
      type: 'episodic' as const,
      content: 'The player said they work at the hospital nearby.',
      importance: 0.7,
      confidence: 0.9,
      source: 'player' as const,
      entities: ['player'],
      createdAt: 0,
      lastAccessedAt: 0,
    },
  ];

  it('matches identical content regardless of formatting', () => {
    expect(validator.findDuplicate(candidate({ content: 'the player said they work at the hospital nearby' }), existing)?.id)
      .toBe('m1');
  });

  it('matches near-duplicates above the similarity threshold', () => {
    const near = candidate({
      content: 'The player said they work at the hospital nearby, apparently.',
    });
    expect(validator.findDuplicate(near, existing)?.id).toBe('m1');
  });

  it('does not match unrelated content', () => {
    const other = candidate({ content: 'The player bought a bicycle from the shop.' });
    expect(validator.findDuplicate(other, existing)).toBeUndefined();
  });
});
