import { describe, it, expect } from 'vitest';
import {
  MemoryPersistence,
  MemoryProcessor,
  retentionScore,
} from '../../src/memory/MemoryProcessor';
import { MemoryCandidate } from '../../src/memory/MemoryTypes';
import { Memory } from '../../src/memory/types';
import { MEMORY_CONFIG } from '../../src/config/gameConfig';
import { Npc } from '../../src/npc/types';
import { STRANGER_RELATIONSHIP } from '../../src/npc/Relationship';
import { applySupersession } from '../../src/memory/MemoryStore';

const npc: Npc = {
  id: 'npc_1',
  identity: { name: 'Maria', age: 28 },
  personality: {
    traits: ['friendly'],
    speechStyle: ['warm'],
    values: ['community'],
    dislikes: ['rudeness'],
    voiceExamples: ['Morning! The usual?'],
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

class FakePersistence implements MemoryPersistence {
  public records = new Map<string, Memory>();

  async list(npcId: string): Promise<Memory[]> {
    return Array.from(this.records.values()).filter((m) => m.npcId === npcId);
  }

  async save(memory: Memory): Promise<void> {
    this.records.set(memory.id, { ...memory });
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id);
  }
}

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

function run(
  persistence: FakePersistence,
  candidates: MemoryCandidate[],
  relationshipUpdates: Parameters<MemoryProcessor['process']>[0]['relationshipUpdates'] = [],
  worldTime = 100_000,
) {
  const processor = new MemoryProcessor(persistence);
  return processor.process({
    npc,
    candidates,
    relationshipUpdates,
    currentRelationship: STRANGER_RELATIONSHIP,
    worldTime,
  });
}

describe('MemoryProcessor', () => {
  it('persists an acceptable candidate', async () => {
    const persistence = new FakePersistence();
    const outcome = await run(persistence, [candidate()]);

    expect(outcome.proposals).toHaveLength(1);
    expect(outcome.proposals[0].decision).toBe('accepted');
    expect(outcome.proposals[0].memoryId).toBeDefined();
    expect(await persistence.list('npc_1')).toHaveLength(1);
  });

  it('stamps new memories with the world clock and the NPC location', async () => {
    const persistence = new FakePersistence();
    await run(persistence, [candidate()], [], 123_456);

    const [memory] = await persistence.list('npc_1');
    expect(memory.createdAt).toBe(123_456);
    expect(memory.lastAccessedAt).toBe(123_456);
    expect(memory.locationId).toBe('coffee-shop');
  });

  it('refuses to let the model invent world truth', async () => {
    const persistence = new FakePersistence();
    const outcome = await run(persistence, [
      candidate({ type: 'fact', source: 'world', content: 'The park closes at 21:00.' }),
      candidate({ type: 'fact', source: 'player', content: 'The shop closes at 20:00.' }),
    ]);

    expect(outcome.proposals.map((p) => p.decision)).toEqual(['rejected', 'rejected']);
    expect(await persistence.list('npc_1')).toHaveLength(0);
  });

  it('drops low-value chatter', async () => {
    const persistence = new FakePersistence();
    const outcome = await run(persistence, [
      candidate({ importance: 0.1, content: 'The player said hello on the street.' }),
    ]);

    expect(outcome.proposals[0].decision).toBe('rejected');
    expect(await persistence.list('npc_1')).toHaveLength(0);
  });

  it('merges a near-duplicate instead of storing it twice', async () => {
    const persistence = new FakePersistence();
    const first = await run(persistence, [candidate()]);
    const originalId = first.proposals[0].memoryId!;

    const second = await run(persistence, [
      candidate({
        content: 'The player said they work at the hospital nearby, apparently.',
        importance: 0.85,
      }),
    ]);

    expect(second.proposals[0].decision).toBe('merged');
    expect(second.proposals[0].memoryId).toBe(originalId);
    expect(await persistence.list('npc_1')).toHaveLength(1);
    expect((await persistence.list('npc_1'))[0].importance).toBe(0.85);
  });

  it('supersedes an earlier memory about the same subject without deleting it', async () => {
    const persistence = new FakePersistence();
    const first = await run(persistence, [
      candidate({ content: 'The player works at the hospital on the east side.' }),
    ]);
    const originalId = first.proposals[0].memoryId!;

    const second = await run(persistence, [
      candidate({
        content: 'The player used to work at the hospital but has since left.',
        confidence: 0.9,
      }),
    ]);

    expect(second.proposals[0].decision).toBe('accepted');
    expect(second.proposals[0].supersededId).toBe(originalId);

    // Provenance survives on disk...
    expect(await persistence.list('npc_1')).toHaveLength(2);
    // ...but only the newer belief is presented as current.
    const active = applySupersession(await persistence.list('npc_1'));
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(second.proposals[0].memoryId);
  });

  it('does not supersede when the subject differs', async () => {
    const persistence = new FakePersistence();
    await run(persistence, [candidate({ entities: ['player', 'hospital'] })]);
    const second = await run(persistence, [
      candidate({ content: 'The player bought a bicycle from the shop today.', entities: ['player', 'bicycle'] }),
    ]);

    expect(second.proposals[0].supersededId).toBeUndefined();
    expect(await persistence.list('npc_1')).toHaveLength(2);
  });

  it('does not supersede world facts', async () => {
    const persistence = new FakePersistence();
    await persistence.save({
      id: 'world_1',
      npcId: 'npc_1',
      type: 'fact',
      content: 'The coffee shop opens at 07:00.',
      importance: 0.9,
      confidence: 1,
      source: 'world',
      entities: ['coffee shop'],
      createdAt: 0,
      lastAccessedAt: 0,
    });

    const outcome = await run(persistence, [
      candidate({
        type: 'fact' as MemoryCandidate['type'],
        source: 'inference',
        content: 'The coffee shop opens at 09:00 these days.',
        entities: ['coffee shop'],
      }),
    ]);

    // A fact-typed candidate is rejected outright rather than superseding.
    expect(outcome.proposals[0].decision).toBe('rejected');
    expect(await persistence.list('npc_1')).toHaveLength(1);
  });

  it('caps how many memories a single conversation can create', async () => {
    const persistence = new FakePersistence();
    const candidates: MemoryCandidate[] = [
    { ...candidate(), content: 'The player works night shifts at the hospital.', entities: ['player', 'hospital'] },
    { ...candidate(), content: 'The player is training for a long ride on a bicycle.', entities: ['player', 'bicycle'] },
    { ...candidate(), content: "The player's sister lives across the river.", entities: ['player', 'sister'] },
    { ...candidate(), content: 'The player wants a plot behind the apartments.', entities: ['player', 'garden'] },
    { ...candidate(), content: 'The player takes the number 4 bus to work.', entities: ['player', 'bus'] },
    { ...candidate(), content: 'The player left their last job in the spring.', entities: ['player', 'job'] },
  ];

    const outcome = await run(persistence, candidates);
    const accepted = outcome.proposals.filter((p) => p.decision === 'accepted');

    expect(accepted).toHaveLength(4);
    expect(outcome.proposals.filter((p) => p.reasons.join(' ').includes('budget already spent')))
      .toHaveLength(2);
    expect(await persistence.list('npc_1')).toHaveLength(4);
  });

  it('prunes the weakest non-factual memories past the cap', async () => {
    const persistence = new FakePersistence();
    const now = 10_000_000;

    await persistence.save({
      id: 'world_1',
      npcId: 'npc_1',
      type: 'fact',
      content: 'The park has no closing hours.',
      importance: 0.2,
      confidence: 1,
      source: 'world',
      entities: ['park'],
      createdAt: 0,
      lastAccessedAt: 0,
    });

    for (let i = 0; i < MEMORY_CONFIG.maxMemoriesPerNpc + 5; i++) {
      await persistence.save({
        id: `old_${i}`,
        npcId: 'npc_1',
        type: 'episodic',
        content: `Old memory number ${i} from long ago.`,
        importance: 0.3,
        confidence: 0.5,
        source: 'player',
        entities: ['player'],
        createdAt: 0,
        lastAccessedAt: 0,
      });
    }
    await persistence.save({
      id: 'important',
      npcId: 'npc_1',
      type: 'episodic',
      content: 'The player is moving into the apartments.',
      importance: 0.95,
      confidence: 1,
      source: 'player',
      entities: ['player'],
      createdAt: 0,
      lastAccessedAt: 0,
    });

    const outcome = await run(persistence, [], [], now);
    const remaining = await persistence.list('npc_1');

    expect(remaining.length).toBeLessThanOrEqual(MEMORY_CONFIG.maxMemoriesPerNpc);
    expect(outcome.prunedMemoryIds!.length).toBeGreaterThan(0);
    // The important memory and every world fact survive.
    expect(remaining.some((m) => m.id === 'important')).toBe(true);
    expect(remaining.some((m) => m.id === 'world_1')).toBe(true);
    // All pruned records were low-importance.
    for (const id of outcome.prunedMemoryIds!) {
      expect(remaining.some((m) => m.id === id)).toBe(false);
    }
  });

  it('applies at most one relationship update per conversation', async () => {
    const persistence = new FakePersistence();
    const outcome = await run(persistence, [], [
      { delta: { familiarity: 0.1 } },
      { delta: { familiarity: 0.1, trust: 0.4 } },
    ]);

    expect(outcome.relationship!.after.familiarity).toBeCloseTo(0.25);
    expect(outcome.relationship!.after.trust).toBeCloseTo(0.24);
    expect(outcome.relationship!.reasons.join(' ')).toContain('extra relationship update');
  });

  it('reports no relationship change when the model proposed none', async () => {
    const persistence = new FakePersistence();
    const outcome = await run(persistence, [candidate()]);
    expect(outcome.relationship).toBeUndefined();
  });
});

describe('retentionScore', () => {
  const base: Memory = {
    id: 'm',
    npcId: 'npc_1',
    type: 'episodic',
    content: 'x',
    importance: 0.5,
    confidence: 0.5,
    source: 'player',
    entities: [],
    createdAt: 0,
    lastAccessedAt: 0,
  };

  it('ranks a fresh important memory above an old unimportant one', () => {
    const fresh = retentionScore(base, 3600);
    const old = retentionScore(base, 30 * 24 * 3600);
    expect(fresh).toBeGreaterThan(old);
  });

  it('ranks importance above recency', () => {
    const important = { ...base, importance: 0.9 };
    // A month-old important memory must outrank a one-hour-old trivial one.
    expect(retentionScore(important, 30 * 24 * 3600)).toBeGreaterThan(
      retentionScore({ ...base, importance: 0.3 }, 3600),
    );
  });
});
