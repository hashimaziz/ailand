import { MEMORY_CONFIG } from '../config/gameConfig';
import {
  MEMORY_SOURCES,
  MEMORY_TYPES,
  MemoryCandidate,
  MODEL_AUTHORIZED_SOURCES,
} from './MemoryTypes';
import { Memory, MemorySource, MemoryType } from './types';

const TOKEN_PATTERN = /[a-z0-9']+/g;

/** Lowercase, collapse whitespace, strip surrounding punctuation. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(value: string): string[] {
  return normalizeText(value).match(TOKEN_PATTERN) ?? [];
}

/**
 * Jaccard similarity over content tokens, used for near-duplicate detection.
 * Purely lexical: the plan deliberately defers embedding-based similarity until
 * deterministic retrieval shows a real semantic failure mode.
 */
export function contentSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * First-person subject, as produced by extraction when it slips into the NPC's
 * own voice.
 *
 * "I just moved into the apartments" records the *player's* event in the NPC's
 * voice. Stored as a memory it is actively harmful: read back as "this happened to
 * me", the NPC concludes it was the one who moved in. Third person, always.
 */
const FIRST_PERSON_SUBJECT =
  /^\s*(?:i|i'm|im|i've|ive|i'll|i'd|me|my|mine|myself|we|we're|our)\b/i;

/**
 * Coerce untrusted model JSON into a well-formed candidate, collecting every
 * problem it had to repair. Nothing here throws: a malformed proposal becomes a
 * rejected proposal, never an exception that could corrupt a conversation.
 */
export function normalizeCandidate(raw: unknown): {
  candidate: MemoryCandidate | null;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return { candidate: null, reasons: ['candidate is not an object'] };
  }
  const record = raw as Record<string, unknown>;

  const rawContent = typeof record.content === 'string' ? record.content : '';
  const content = rawContent.replace(/\s+/g, ' ').trim();
  if (!content) {
    reasons.push('empty content');
  }

  const rawType = record.type;
  const type = MEMORY_TYPES.includes(rawType as MemoryType)
    ? (rawType as MemoryType)
    : undefined;
  if (!type) {
    reasons.push(`invalid memory type: ${String(rawType)}`);
  }

  const rawSource = record.source;
  const source = MEMORY_SOURCES.includes(rawSource as MemorySource)
    ? (rawSource as MemorySource)
    : undefined;
  if (!source) {
    reasons.push(`invalid memory source: ${String(rawSource)}`);
  }

  if (!isFiniteNumber(record.importance)) {
    reasons.push('importance is not a finite number');
  } else if (record.importance! < 0 || record.importance! > 1) {
    reasons.push('importance outside 0..1, clamped');
  }

  if (!isFiniteNumber(record.confidence)) {
    reasons.push('confidence is not a finite number');
  } else if (record.confidence! < 0 || record.confidence! > 1) {
    reasons.push('confidence outside 0..1, clamped');
  }

  const entities: string[] = [];
  if (Array.isArray(record.entities)) {
    for (const entity of record.entities) {
      if (typeof entity !== 'string') continue;
      const normalized = normalizeText(entity).slice(0, 40);
      if (normalized && !entities.includes(normalized)) {
        entities.push(normalized);
      }
    }
  } else if (record.entities !== undefined) {
    reasons.push('entities is not an array, ignored');
  }

  let locationId: string | undefined;
  if (typeof record.locationId === 'string' && record.locationId.trim()) {
    locationId = record.locationId.trim();
  } else if (record.locationId !== undefined && record.locationId !== null) {
    reasons.push('locationId is not a string, ignored');
  }

  if (content.length > MEMORY_CONFIG.maxContentChars) {
    reasons.push(`content exceeds ${MEMORY_CONFIG.maxContentChars} characters, truncated`);
  }

  // An empty value is never recoverable, and truncation routinely leaves one
  // behind. Dropping it here keeps stubs out of the candidate list entirely.
  if (!content || !type || !source) {
    return { candidate: null, reasons };
  }

  return {
    candidate: {
      type,
      source,
      content: content.slice(0, MEMORY_CONFIG.maxContentChars),
      importance: clamp01(Number(record.importance)),
      confidence: clamp01(Number(record.confidence)),
      entities,
      locationId,
    },
    reasons,
  };
}

/**
 * Policy checks applied to a candidate that is already structurally valid.
 * `authoritative` marks memories copied from the simulation rather than proposed
 * by the model; those are exempt from the authority rules below.
 */
export class MemoryValidator {
  public validate(candidate: Partial<Memory>): string[] {
    const errors: string[] = [];

    if (!candidate.content || candidate.content.trim().length === 0) {
      errors.push('Content is empty');
    }
    if (candidate.content && candidate.content.length > MEMORY_CONFIG.maxContentChars) {
      errors.push('Content exceeds size limit');
    }
    if (
      candidate.importance === undefined ||
      candidate.importance < 0 ||
      candidate.importance > 1
    ) {
      errors.push('Importance must be between 0 and 1');
    }
    if (candidate.confidence === undefined || candidate.confidence < 0 || candidate.confidence > 1) {
      errors.push('Confidence must be between 0 and 1');
    }
    if (!candidate.type || !MEMORY_TYPES.includes(candidate.type)) {
      errors.push('Invalid memory type');
    }
    if (!candidate.source || !MEMORY_SOURCES.includes(candidate.source)) {
      errors.push('Invalid memory source');
    }
    if (candidate.type === 'fact' && candidate.source !== 'world') {
      errors.push('Only world source can assert a canonical fact');
    }

    return errors;
  }

  /**
   * Decide whether a model-proposed candidate may be persisted.
   * Returns an empty array when it is acceptable, otherwise the rejection reasons.
   */
  public validateProposal(candidate: MemoryCandidate): string[] {
    const reasons: string[] = [];

    const schemaErrors = this.validate(candidate);
    if (schemaErrors.length > 0) {
      reasons.push(...schemaErrors);
      return reasons;
    }

    // Authority: the model is never a source of canonical world truth.
    if ((MEMORY_CONFIG.forbiddenSources as readonly string[]).includes(candidate.source)) {
      reasons.push('Model may not claim authoritative world source');
    } else if (!MODEL_AUTHORIZED_SOURCES.includes(candidate.source)) {
      reasons.push(`Unauthorized memory source: ${candidate.source}`);
    }

    if (candidate.type === 'fact') {
      reasons.push('Model may not assert a canonical fact');
    }

    if (candidate.confidence < 0.5 && candidate.type === 'relationship') {
      reasons.push('Relationship memories require at least 0.5 confidence');
    }

    if (candidate.importance < MEMORY_CONFIG.minImportance) {
      reasons.push(
        `Importance ${candidate.importance.toFixed(2)} below threshold ${MEMORY_CONFIG.minImportance}`,
      );
    }

    // Checked against the raw text so short-circuit answers like "n/a" are
    // recognised as placeholders rather than merely as short content.
    const raw = candidate.content.trim().toLowerCase();
    if (/^(n\/?a|none|null|unknown|nothing|no comment|no memories?)\.?$/.test(raw)) {
      reasons.push('Content is a placeholder, not a memory');
    }

    const normalized = normalizeText(candidate.content);
    if (normalized.length < 8) {
      reasons.push('Content too short to be meaningful');
    }

    if (FIRST_PERSON_SUBJECT.test(candidate.content.trim())) {
      reasons.push(
        'written in the first person — describe the player and others in the third person',
      );
    }

    return reasons;
  }

  public isDuplicate(candidate: Partial<Memory>, existingMemories: Memory[]): boolean {
    return existingMemories.some(
      (mem) => mem.content === candidate.content && mem.type === candidate.type,
    );
  }

  /** Exact match first, then a lexical near-duplicate above the given threshold. */
  public findDuplicate(
    candidate: MemoryCandidate,
    existingMemories: Memory[],
    similarityThreshold = 0.8,
  ): Memory | undefined {
    const exact = existingMemories.find(
      (mem) => normalizeText(mem.content) === normalizeText(candidate.content),
    );
    if (exact) return exact;

    for (const mem of existingMemories) {
      if (contentSimilarity(candidate.content, mem.content) >= similarityThreshold) {
        return mem;
      }
    }
    return undefined;
  }
}
