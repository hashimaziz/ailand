import { Memory, MemorySource, MemoryType } from './types';

export const MEMORY_TYPES: readonly MemoryType[] = [
  'fact',
  'episodic',
  'belief',
  'rumor',
  'relationship',
];

export const MEMORY_SOURCES: readonly MemorySource[] = [
  'world',
  'player',
  'npc',
  'observation',
  'inference',
];

/** Sources a model is permitted to attribute a memory to. */
export const MODEL_AUTHORIZED_SOURCES: readonly MemorySource[] = [
  'player',
  'npc',
  'observation',
  'inference',
];

/** A memory candidate as proposed by the language model, before any policy decision. */
export interface MemoryCandidate {
  type: MemoryType;
  content: string;
  importance: number;
  confidence: number;
  source: MemorySource;
  entities: string[];
  locationId?: string;
}

export type MemoryDecision = 'accepted' | 'rejected' | 'merged' | 'superseded';

export interface MemoryProposal {
  candidate: MemoryCandidate;
  decision: MemoryDecision;
  reasons: string[];
  /** Set when the proposal resulted in a persisted memory. */
  memoryId?: string;
  /** Set when an existing memory was superseded rather than duplicated. */
  supersededId?: string;
}

export interface RelationshipDelta {
  familiarity?: number;
  trust?: number;
  affection?: number;
  tension?: number;
}

export interface RelationshipUpdateProposal {
  delta: RelationshipDelta;
  labels?: string[];
  reason?: string;
}

/** Coarse relevance floor applied before a memory is allowed into a prompt. */
export interface MemoryProposalRecord {
  npcId: string;
  proposals: MemoryProposal[];
  skipped?: string;
  error?: string;
  durationMs?: number;
}

export type { Memory, MemorySource, MemoryType };
