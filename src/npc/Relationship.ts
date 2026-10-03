import { MEMORY_CONFIG } from '../config/gameConfig';
import { PlayerRelationshipSnapshot } from '../conversation/ConversationTypes';
import { Npc } from './types';
import { RelationshipDelta } from '../memory/MemoryTypes';
import { clamp01 } from '../memory/MemoryValidator';

export const STRANGER_RELATIONSHIP: PlayerRelationshipSnapshot = {
  familiarity: 0.15,
  trust: 0.24,
  affection: 0.2,
  tension: 0.05,
  labels: ['stranger'],
};

export function defaultPlayerRelationship(npc: Npc): PlayerRelationshipSnapshot {
  return {
    familiarity: STRANGER_RELATIONSHIP.familiarity,
    trust: clamp01(npc.personality.trustBaseline * 0.4),
    affection: STRANGER_RELATIONSHIP.affection,
    tension: STRANGER_RELATIONSHIP.tension,
    labels: [...STRANGER_RELATIONSHIP.labels],
  };
}

export function clampRelationship(
  relationship: PlayerRelationshipSnapshot,
): PlayerRelationshipSnapshot {
  return {
    familiarity: clamp01(relationship.familiarity),
    trust: clamp01(relationship.trust),
    affection: clamp01(relationship.affection),
    tension: clamp01(relationship.tension),
    labels: relationship.labels.slice(0, MEMORY_CONFIG.maxRelationshipLabels),
  };
}

/** Labels are model-authored free text, so keep them short and word-like. */
export function sanitizeLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];

  const cleaned: string[] = [];
  for (const label of labels) {
    if (typeof label !== 'string') continue;
    const normalized = label
      .toLowerCase()
      .replace(/[^a-z\s'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized || normalized.length > 24) continue;
    if (!cleaned.includes(normalized)) {
      cleaned.push(normalized);
    }
  }
  return cleaned.slice(0, MEMORY_CONFIG.maxRelationshipLabels);
}

export interface RelationshipChange {
  before: PlayerRelationshipSnapshot;
  after: PlayerRelationshipSnapshot;
  reasons: string[];
}

/**
 * Apply model-proposed relationship deltas.
 *
 * A single conversation can only nudge a relationship so far, and no value may
 * leave 0..1. The model can therefore express a change in tone without being able
 * to declare someone a best friend on first contact.
 */
export function applyRelationshipDeltas(
  current: PlayerRelationshipSnapshot,
  delta: RelationshipDelta,
  proposedLabels: unknown,
): RelationshipChange {
  const reasons: string[] = [];
  const limit = MEMORY_CONFIG.maxRelationshipDelta;
  const bounded: RelationshipDelta = {};

  for (const key of ['familiarity', 'trust', 'affection', 'tension'] as const) {
    const raw = delta[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const clamped = Math.max(-limit, Math.min(limit, raw));
    if (clamped !== raw) {
      reasons.push(`${key} delta clamped to ${clamped.toFixed(2)}`);
    }
    bounded[key] = clamped;
  }

  const labels = sanitizeLabels(proposedLabels);
  if (labels.length > 0) {
    reasons.push(`labels: ${labels.join(', ')}`);
  }

  const after = clampRelationship({
    familiarity: current.familiarity + (bounded.familiarity ?? 0),
    trust: current.trust + (bounded.trust ?? 0),
    affection: current.affection + (bounded.affection ?? 0),
    tension: current.tension + (bounded.tension ?? 0),
    labels: labels.length > 0 ? labels : current.labels,
  });

  return { before: { ...current, labels: [...current.labels] }, after, reasons };
}
