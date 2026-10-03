import { describe, it, expect } from 'vitest';
import {
  buildExtractionMessages,
  extractJsonObject,
  parseExtractionResponse,
} from '../../src/memory/MemoryFormation';
import { Npc } from '../../src/npc/types';

const npc: Npc = {
  id: 'npc_1',
  identity: { name: 'Maria', age: 28 },
  personality: {
    traits: ['friendly'],
    speechStyle: ['warm'],
    values: ['community'],
    dislikes: ['rudeness'],
    socialDisposition: 0.8,
    trustBaseline: 0.6,
  },
  biography: 'Barista.',
  occupationId: 'barista',
  homeLocationId: 'apartments',
  schedule: [],
  state: {
    locationId: 'coffee-shop',
    mood: 'cheerful',
    energy: 0.9,
    stress: 0.1,
    hunger: 0.2,
    currentActivity: 'Working',
    lastSimulatedAt: 0,
  },
};

const turns = [
  { role: 'player' as const, content: 'My name is Alex.', at: 1 },
  { role: 'npc' as const, content: 'Nice to meet you, Alex.', at: 2 },
  { role: 'player' as const, content: 'I just moved into the apartments.', at: 3 },
];

describe('buildExtractionMessages', () => {
  it('never offers world as an authorizable source', () => {
    const [system] = buildExtractionMessages({ npc, turns });
    expect(system.role).toBe('system');
    expect(system.content).toContain('Never "world"');
    expect(system.content).toContain('JSON');
  });

  it('includes the character and the full transcript', () => {
    const [, user] = buildExtractionMessages({ npc, turns });
    expect(user.content).toContain('Maria');
    expect(user.content).toContain('Player: My name is Alex.');
    expect(user.content).toContain('Maria: Nice to meet you, Alex.');
    expect(user.content).toContain('I just moved into the apartments.');
  });
});

describe('extractJsonObject', () => {
  it('parses a bare object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses an object wrapped in prose and code fences', () => {
    const text = 'Sure! ```json\n{"memories":[]}\n``` hope that helps';
    expect(extractJsonObject(text)).toEqual({ memories: [] });
  });

  it('handles braces inside strings', () => {
    expect(extractJsonObject('{"content":"a } brace","x":2}')).toEqual({
      content: 'a } brace',
      x: 2,
    });
  });

  it('handles escaped quotes', () => {
    expect(extractJsonObject('{"content":"she said \\"hi\\" loudly"}')).toEqual({
      content: 'she said "hi" loudly',
    });
  });

  it('returns null when there is no JSON', () => {
    expect(extractJsonObject('I could not find anything worth saving.')).toBeNull();
  });

  it('returns null for truncated JSON', () => {
    expect(extractJsonObject('{"memories":[{"content":"half')).toBeNull();
  });
});

describe('parseExtractionResponse', () => {
  it('parses a well-formed envelope', () => {
    const result = parseExtractionResponse(
      JSON.stringify({
        memories: [
          {
            type: 'episodic',
            content: 'The player introduced themselves as Alex.',
            importance: 0.8,
            confidence: 0.95,
            source: 'player',
            entities: ['player', 'alex'],
            locationId: 'apartments',
          },
        ],
        relationship_updates: [
          { delta: { familiarity: 0.05, trust: 0.03 }, labels: ['acquaintance'], reason: 'met' },
        ],
      }),
    );

    expect(result).not.toBeNull();
    expect(result!.memories).toHaveLength(1);
    expect(result!.memories[0].type).toBe('episodic');
    expect(result!.memories[0].entities).toEqual(['player', 'alex']);
    expect(result!.relationshipUpdates).toHaveLength(1);
    expect(result!.relationshipUpdates[0].delta.familiarity).toBe(0.05);
    expect(result!.relationshipUpdates[0].labels).toEqual(['acquaintance']);
  });

  it('accepts the camelCase relationship field name', () => {
    const result = parseExtractionResponse(
      '{"memories":[],"relationshipUpdates":[{"delta":{"trust":0.1}}]}',
    );
    expect(result!.relationshipUpdates).toHaveLength(1);
  });

  it('returns null when nothing parseable is present', () => {
    expect(parseExtractionResponse('no memories here')).toBeNull();
  });

  it('drops unusable entries but keeps the usable ones', () => {
    const result = parseExtractionResponse(
      JSON.stringify({
        memories: [
          { type: 'nonsense', content: 'bad type', importance: 0.5, confidence: 0.5, source: 'player' },
          'not an object',
          {
            type: 'belief',
            content: 'The player seems to be new to the neighbourhood.',
            importance: 0.5,
            confidence: 0.6,
            source: 'inference',
            entities: ['player'],
          },
        ],
      }),
    );

    expect(result!.memories).toHaveLength(1);
    expect(result!.memories[0].type).toBe('belief');
    expect(result!.rejected).toHaveLength(2);
    expect(result!.warnings.length).toBeGreaterThan(0);
  });

  it('treats missing arrays as empty rather than failing', () => {
    const result = parseExtractionResponse('{}');
    expect(result).not.toBeNull();
    expect(result!.memories).toEqual([]);
    expect(result!.relationshipUpdates).toEqual([]);
  });

  it('ignores non-numeric relationship deltas', () => {
    const result = parseExtractionResponse(
      '{"memories":[],"relationship_updates":[{"delta":{"trust":"lots"}}]}',
    );
    expect(result!.relationshipUpdates).toHaveLength(0);
    expect(result!.warnings.join(' ')).toContain('no usable deltas');
  });
});
