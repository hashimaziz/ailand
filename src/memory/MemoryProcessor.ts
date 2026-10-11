import { db } from '../persistence/Database';
import { generateId } from '../utils/ids';
import { LOCATION_LABELS, MEMORY_CONFIG } from '../config/gameConfig';
import { PlayerRelationshipSnapshot } from '../conversation/ConversationTypes';
import { Npc } from '../npc/types';
import { RelationshipChange, applyRelationshipDeltas } from '../npc/Relationship';
import { memoryStore } from './MemoryStore';
import {
  MemoryCandidate,
  MemoryProposal,
  MemoryProposalRecord,
  RelationshipUpdateProposal,
} from './MemoryTypes';
import { MemoryValidator, normalizeText } from './MemoryValidator';
import { Memory } from './types';

const PRONOUNS = new Set(['i', 'im', 'me', 'my', 'mine', 'myself', 'we', 'our', 'us']);

/**
 * Is this "memory" just the NPC describing themselves?
 *
 * Observed in practice: the extraction produced
 * "Maria is friendly and observant", which restates the personality already in
 * every prompt. It is not a memory of anything, and storing it wastes retrieval
 * budget and can crowd out a real one.
 */
export function isSelfDescription(candidate: MemoryCandidate, npc: Npc): boolean {
  const words = normalizeText(candidate.content).split(' ').filter(Boolean);
  if (words.length === 0) return false;

  const own = new Set(
    [
      npc.identity.name,
      ...npc.personality.traits,
      ...npc.personality.speechStyle,
      ...npc.personality.values,
      ...npc.personality.dislikes,
    ].map((w) => normalizeText(w)),
  );

  const contentWords = words.filter((w) => !PRONOUNS.has(w));
  if (contentWords.length === 0) return false;

  const overlap = contentWords.filter((w) => own.has(w)).length;
  return overlap / contentWords.length >= 0.6;
}

/**
 * Keep only location ids the world actually knows about.
 *
 * The extraction schema lets the model name a location, and it will happily
 * invent one — "West Coffee Shop" is a label, not a location id. Storing that
 * makes the memory's `locationId` match nothing forever, silently costing it the
 * location-relevance signal on every future retrieval.
 */
export function resolveLocationId(
  proposed: string | undefined,
  fallback: string,
): string {
  if (!proposed) return fallback;
  const key = proposed.trim().toLowerCase();
  const match = Object.keys(LOCATION_LABELS).find(
    (id) => id.toLowerCase() === key || LOCATION_LABELS[id].toLowerCase() === key,
  );
  return match ?? fallback;
}

/** Types whose currency a newer memory of the same subject can supersede. */
const SUPERSEDABLE_TYPES = new Set(['episodic', 'belief', 'relationship']);

/** Hard ceiling on how many memories one conversation may create. */
const MAX_ACCEPTED_PER_CONVERSATION = 4;

/**
 * The slice of persistence this processor needs.
 *
 * Keeping it narrow means the policy can be tested against an in-memory store,
 * and keeps IndexedDB out of the decision-making code.
 */
export interface MemoryPersistence {
  list(npcId: string): Promise<Memory[]>;
  save(memory: Memory): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createMemoryPersistence(): MemoryPersistence {
  return {
    list: (npcId) => memoryStore.getMemories(npcId),
    save: (memory) => memoryStore.save(memory),
    remove: (id) => db.deleteMemory(id),
  };
}

export interface MemoryFormationOutcome extends MemoryProposalRecord {
  relationship?: RelationshipChange;
  prunedMemoryIds?: string[];
}

/**
 * Decides what to do with model-proposed memories.
 *
 * The model may only *propose*. Every candidate is validated against schema and
 * provenance rules, checked against what the NPC already knows, and only then
 * persisted. Nothing the model says can create or alter authoritative world truth.
 */
export class MemoryProcessor {
  constructor(
    private persistence: MemoryPersistence = createMemoryPersistence(),
    private validator: MemoryValidator = new MemoryValidator(),
  ) {}

  public async process(input: {
    npc: Npc;
    candidates: MemoryCandidate[];
    relationshipUpdates: RelationshipUpdateProposal[];
    currentRelationship: PlayerRelationshipSnapshot;
    worldTime: number;
    warnings?: string[];
  }): Promise<MemoryFormationOutcome> {
    const { npc, worldTime } = input;
    const proposals: MemoryProposal[] = [];
    let existing = await this.persistence.list(npc.id);

    let accepted = 0;

    for (const candidate of input.candidates) {
      const proposal: MemoryProposal = { candidate, decision: 'rejected', reasons: [] };

      proposal.reasons.push(...this.validator.validateProposal(candidate));
      if (proposal.reasons.length === 0 && isSelfDescription(candidate, npc)) {
        proposal.reasons.push('restates the NPC\'s own personality rather than remembering something');
      }
      if (proposal.reasons.length > 0) {
        proposals.push(proposal);
        continue;
      }

      if (accepted >= MAX_ACCEPTED_PER_CONVERSATION) {
        proposal.reasons.push('conversation memory budget already spent');
        proposals.push(proposal);
        continue;
      }

      const duplicate = this.validator.findDuplicate(candidate, existing);
      if (duplicate) {
        await this.mergeInto(duplicate, candidate);
        proposal.decision = 'merged';
        proposal.memoryId = duplicate.id;
        proposal.reasons.push(`merged into existing memory (similar content, id ${duplicate.id})`);
        proposals.push(proposal);
        continue;
      }

      const superseded = this.findSuperseded(candidate, existing);
      const memory: Memory = {
        id: generateId('mem_'),
        npcId: npc.id,
        type: candidate.type,
        content: candidate.content,
        importance: candidate.importance,
        confidence: candidate.confidence,
        source: candidate.source,
        entities: candidate.entities,
        locationId: resolveLocationId(candidate.locationId, npc.state.locationId),
        createdAt: worldTime,
        lastAccessedAt: worldTime,
        supersedesId: superseded?.id,
      };

      await this.persistence.save(memory);
      existing = [...existing, memory];
      accepted++;

      proposal.decision = 'accepted';
      proposal.memoryId = memory.id;
      if (superseded) {
        proposal.supersededId = superseded.id;
        proposal.reasons.push(`supersedes earlier memory ${superseded.id} on the same subject`);
      }
      proposals.push(proposal);
    }

    const prunedMemoryIds = await this.prune(existing, worldTime);
    const relationship = this.applyRelationshipUpdates(
      input.currentRelationship,
      input.relationshipUpdates,
    );

    return {
      npcId: npc.id,
      proposals,
      relationship,
      prunedMemoryIds,
    };
  }

  /**
   * Find an existing memory this candidate makes obsolete.
   *
   * Deliberately conservative: the new memory must be the same type, cover
   * exactly the same entities, and be reasonably confident. Anything less
   * specific risks discarding a memory that is still true. Superseded memories
   * are retained so their provenance survives.
   */
  private findSuperseded(
    candidate: MemoryCandidate,
    existing: Memory[],
  ): Memory | undefined {
    if (!SUPERSEDABLE_TYPES.has(candidate.type)) return undefined;
    if (candidate.confidence < 0.6) return undefined;
    if (candidate.entities.length === 0) return undefined;

    const supersededIds = new Set(
      existing.map((m) => m.supersedesId).filter((id): id is string => Boolean(id)),
    );

    const matches = existing.filter((mem) => {
      if (supersededIds.has(mem.id)) return false;
      if (mem.type !== candidate.type) return false;
      if (mem.source !== candidate.source) return false;
      return sameEntitySet(mem.entities, candidate.entities);
    });

    if (matches.length === 0) return undefined;
    return matches.reduce((oldest, mem) => (mem.createdAt <= oldest.createdAt ? mem : oldest));
  }

  /** Fold a near-duplicate into the stronger existing memory instead of storing it twice. */
  private async mergeInto(existing: Memory, candidate: MemoryCandidate): Promise<void> {
    const merged: Memory = {
      ...existing,
      importance: Math.max(existing.importance, candidate.importance),
      confidence: Math.max(existing.confidence, candidate.confidence),
      entities: Array.from(new Set([...existing.entities, ...candidate.entities])),
      lastAccessedAt: existing.lastAccessedAt,
    };
    await this.persistence.save(merged);
    Object.assign(existing, merged);
  }

  /**
   * Keep memory growth bounded without running the model for maintenance.
   * World facts are never pruned; the weakest non-factual memories go first.
   */
  private async prune(memories: Memory[], worldTime: number): Promise<string[]> {
    if (memories.length <= MEMORY_CONFIG.maxMemoriesPerNpc) return [];

    const prunable = memories
      .filter((m) => m.type !== 'fact')
      .map((m) => ({ memory: m, retention: retentionScore(m, worldTime) }))
      .sort((a, b) => a.retention - b.retention);

    const excess = memories.length - MEMORY_CONFIG.maxMemoriesPerNpc;
    const doomed = prunable.slice(0, Math.min(excess, prunable.length));

    for (const { memory } of doomed) {
      await this.persistence.remove(memory.id);
    }
    return doomed.map(({ memory }) => memory.id);
  }

  private applyRelationshipUpdates(
    current: PlayerRelationshipSnapshot,
    updates: RelationshipUpdateProposal[],
  ): RelationshipChange | undefined {
    if (updates.length === 0) return undefined;

    const combined: RelationshipChange = {
      before: { ...current, labels: [...current.labels] },
      after: { ...current, labels: [...current.labels] },
      reasons: [],
    };

    // One conversation may adjust the relationship once, however many
    // update objects the model emitted.
    const update = updates[0];
    const applied = applyRelationshipDeltas(current, update.delta, update.labels);
    combined.after = applied.after;
    combined.reasons.push(...applied.reasons);
    if (update.reason) {
      combined.reasons.push(`model reason: ${update.reason}`);
    }
    if (updates.length > 1) {
      combined.reasons.push(`${updates.length - 1} extra relationship update(s) ignored`);
    }
    return combined;
  }
}

/**
 * How strongly a memory should be kept.
 *
 * Importance dominates and recency only modulates it, so a genuinely important
 * memory is never pruned in favour of a fresher trivial one. Recency breaks ties
 * between memories of equal importance, and fades over a simulated week.
 */
export function retentionScore(memory: Memory, worldTime: number): number {
  const ageHours = Math.max(0, (worldTime - memory.createdAt) / 3600);
  const recency = 1 - Math.min(1, ageHours / (7 * 24));
  return memory.importance * (0.7 + 0.3 * recency);
}

function sameEntitySet(a: string[], b: string[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  const setA = new Set(a.map(normalizeText));
  const setB = new Set(b.map(normalizeText));
  if (setA.size !== a.length || setB.size !== b.length) return false;
  for (const value of setA) {
    if (!setB.has(value)) return false;
  }
  return true;
}
