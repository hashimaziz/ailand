import { Memory } from './types';
import { fixtures } from '../npc/fixtures';

/**
 * Initial memories written on first run.
 *
 * Two things matter here. First, canonical world facts must exist so the prompt's
 * WORLD TRUTH section is populated and the NPC/rumor distinction is observable.
 * Second, NPCs need beliefs and rumors that are *not* world facts, so a player
 * can see an NPC hold a wrong or outdated opinion that the simulation ignores.
 *
 * Timestamps are fixed rather than relative to page load, so the same save is
 * reproducible across runs. 8:00 on day one matches the world's start time.
 */
const SEED_TIME = 8 * 3600;

type SeedMemory = Omit<Memory, 'id' | 'npcId' | 'createdAt' | 'lastAccessedAt'>;

const WORLD_FACTS = {
  maria: [
    'The coffee shop on the west side opens at 07:00 and closes at 18:00.',
    'David owns the shop on the east side of the street.',
    'The park is the only open space on the block and has no closing hours.',
  ],
  david: [
    'The coffee shop on the west side opens at 07:00 and closes at 18:00.',
    'Maria works at the coffee shop on the west side of the street.',
    'The park is the only open space on the block and has no closing hours.',
  ],
} as const;

/**
 * `world` is the only authoritative source. Everything else is the NPC's own
 * understanding and may be stale, wrong, or second-hand.
 */
export const SEED_MEMORIES: Record<string, SeedMemory[]> = {
  npc_1: [
    ...WORLD_FACTS.maria.map((content) => ({
      type: 'fact' as const,
      content,
      importance: 0.7,
      confidence: 1,
      source: 'world' as const,
      entities: ['coffee shop', 'shop', 'park'],
    })),
    {
      type: 'belief',
      content: 'The shop on the east side is losing money and might close this winter.',
      importance: 0.6,
      confidence: 0.55,
      source: 'inference',
      entities: ['shop', 'david'],
      locationId: 'shop',
    },
    {
      type: 'rumor',
      content: 'Someone saw a fox in the park just after dawn last week.',
      importance: 0.35,
      confidence: 0.4,
      source: 'npc',
      entities: ['park', 'fox'],
      locationId: 'park',
    },
  ],
  npc_2: [
    ...WORLD_FACTS.david.map((content) => ({
      type: 'fact' as const,
      content,
      importance: 0.7,
      confidence: 1,
      source: 'world' as const,
      entities: ['coffee shop', 'park', 'maria'],
    })),
    {
      type: 'belief',
      content: 'The coffee shop keeps better hours than the sign outside advertises.',
      importance: 0.5,
      confidence: 0.6,
      source: 'inference',
      entities: ['coffee shop', 'maria'],
      locationId: 'coffee-shop',
    },
  ],
};

export function buildSeedMemories(): Memory[] {
  const memories: Memory[] = [];

  for (const npc of fixtures) {
    const seeds = SEED_MEMORIES[npc.id] ?? [];
    for (const seed of seeds) {
      memories.push({
        ...seed,
        id: `seed_${npc.id}_${memories.length}`,
        npcId: npc.id,
        createdAt: SEED_TIME,
        lastAccessedAt: SEED_TIME,
      });
    }
  }

  return memories;
}
