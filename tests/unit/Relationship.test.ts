import { describe, it, expect } from 'vitest';
import {
  applyRelationshipDeltas,
  clampRelationship,
  defaultPlayerRelationship,
  sanitizeLabels,
  STRANGER_RELATIONSHIP,
} from '../../src/npc/Relationship';
import { MEMORY_CONFIG } from '../../src/config/gameConfig';
import { Npc } from '../../src/npc/types';

const npc = {
  id: 'npc_1',
  identity: { name: 'Maria', age: 28 },
  personality: {
    traits: [],
    speechStyle: [],
    values: [],
    dislikes: [],
    voiceExamples: [],
    socialDisposition: 0.8,
    trustBaseline: 0.6,
  },
  biography: '',
  occupationId: 'barista',
  homeLocationId: 'apartments',
  schedule: [],
  state: {
    locationId: 'apartments',
    mood: 'neutral',
    energy: 1,
    stress: 0,
    hunger: 0,
    currentActivity: 'idle',
    lastSimulatedAt: 0,
  },
} as Npc;

describe('defaultPlayerRelationship', () => {
  it('derives trust from the NPC baseline', () => {
    expect(defaultPlayerRelationship(npc).trust).toBeCloseTo(0.24);
  });

  it('starts every player as a stranger', () => {
    expect(defaultPlayerRelationship(npc).labels).toEqual(['stranger']);
  });

  it('does not alias the shared labels array', () => {
    const first = defaultPlayerRelationship(npc);
    first.labels.push('mutated');
    expect(STRANGER_RELATIONSHIP.labels).toEqual(['stranger']);
  });
});

describe('clampRelationship', () => {
  it('clamps every value into 0..1 and bounds the label list', () => {
    const result = clampRelationship({
      familiarity: 1.8,
      trust: -0.4,
      affection: 0.5,
      tension: 9,
      labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    });

    expect(result.familiarity).toBe(1);
    expect(result.trust).toBe(0);
    expect(result.tension).toBe(1);
    expect(result.labels).toHaveLength(MEMORY_CONFIG.maxRelationshipLabels);
  });
});

describe('sanitizeLabels', () => {
  it('keeps short word-like labels', () => {
    expect(sanitizeLabels(['Regular', 'good neighbour'])).toEqual(['regular', 'good neighbour']);
  });

  it('drops non-strings, long strings and duplicates', () => {
    expect(sanitizeLabels(['friend', 42, null, 'friend'.repeat(6)])).toEqual(['friend']);
  });

  it('returns an empty list for non-arrays', () => {
    expect(sanitizeLabels('friend')).toEqual([]);
    expect(sanitizeLabels(undefined)).toEqual([]);
  });
});

describe('applyRelationshipDeltas', () => {
  it('applies a small positive change', () => {
    const { before, after } = applyRelationshipDeltas(
      STRANGER_RELATIONSHIP,
      { familiarity: 0.05, trust: 0.03 },
      ['acquaintance'],
    );

    expect(before.familiarity).toBeCloseTo(0.15);
    expect(after.familiarity).toBeCloseTo(0.2);
    expect(after.trust).toBeCloseTo(0.27);
    expect(after.labels).toEqual(['acquaintance']);
  });

  it('refuses to let one conversation swing a value arbitrarily', () => {
    const { after, reasons } = applyRelationshipDeltas(
      STRANGER_RELATIONSHIP,
      { familiarity: 5 },
      undefined,
    );

    // 0.15 familiarity plus the maximum permitted 0.15 nudge: a single
    // conversation can make someone a familiar face, not a best friend.
    expect(after.familiarity).toBeCloseTo(0.3);
    expect(reasons.join(' ')).toContain('clamped');
  });

  it('cannot push a value below zero, only down to the per-conversation limit', () => {
    const { after } = applyRelationshipDeltas(STRANGER_RELATIONSHIP, { trust: -10 }, undefined);
    expect(after.trust).toBeCloseTo(0.24 - MEMORY_CONFIG.maxRelationshipDelta);
    expect(after.trust).toBeGreaterThanOrEqual(0);
  });

  it('keeps existing labels when none are proposed', () => {
    const { after } = applyRelationshipDeltas(STRANGER_RELATIONSHIP, { trust: 0.1 }, []);
    expect(after.labels).toEqual(['stranger']);
  });

  it('ignores non-numeric deltas entirely', () => {
    const { after } = applyRelationshipDeltas(
      STRANGER_RELATIONSHIP,
      { familiarity: Number.NaN, trust: 0.02 },
      undefined,
    );
    expect(after.familiarity).toBeCloseTo(0.15);
    expect(after.trust).toBeCloseTo(0.26);
  });
});
