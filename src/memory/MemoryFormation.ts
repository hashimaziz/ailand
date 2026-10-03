import { ChatMessage } from '../ai/LanguageModel';
import { MEMORY_CONFIG } from '../config/gameConfig';
import { Npc } from '../npc/types';
import { DialogueTurn } from '../conversation/ConversationTypes';
import {
  MemoryCandidate,
  RelationshipDelta,
  RelationshipUpdateProposal,
} from './MemoryTypes';
import { normalizeCandidate } from './MemoryValidator';

const EXTRACTION_SYSTEM_PROMPT = [
  'You maintain the long-term memory of a character in a small neighbourhood game.',
  'You are given a finished conversation. Decide what that character should still remember weeks from now.',
  '',
  'Reply with one JSON object and nothing else. No prose, no markdown fences, no commentary.',
  'Schema:',
  '{"memories":[{"type":"episodic|belief|rumor|relationship","content":"string",'
  + '"importance":0.0,"confidence":0.0,"source":"player|npc|observation|inference",'
  + '"entities":["lowercase names"],"locationId":"optional location id"}],'
  + '"relationship_updates":[{"delta":{"familiarity":0.0,"trust":0.0,"affection":0.0,"tension":0.0},'
  + '"labels":["optional short label"],"reason":"short"}]}',
  '',
  'Rules:',
  '- "source" must be player, npc, observation, or inference. Never "world".',
  '- You cannot create or change world facts. Business hours and locations are not yours.',
  '- importance and confidence are numbers between 0 and 1.',
  '- Record at most two memories, and fewer if the conversation was small talk.',
  '- Omit a memory entirely rather than writing a placeholder.',
  '- Return empty arrays if nothing is worth remembering.',
].join('\n');

export interface ExtractionRequest {
  npc: Npc;
  turns: DialogueTurn[];
  playerName?: string;
}

/**
 * Build the structured extraction request.
 *
 * The conversation is flattened into a transcript because the extraction model
 * only needs to know what was said, not how it was phrased as chat turns.
 */
export function buildExtractionMessages(request: ExtractionRequest): ChatMessage[] {
  const { npc, turns } = request;

  const transcript = turns
    .map((turn) => {
      const speaker = turn.role === 'player' ? (request.playerName ?? 'Player') : npc.identity.name;
      return `${speaker}: ${turn.content}`;
    })
    .join('\n');

  const character = [
    `${npc.identity.name}, ${npc.identity.age}, works as a ${npc.occupationId}.`,
    `Traits: ${npc.personality.traits.join(', ')}.`,
  ].join(' ');

  return [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `CHARACTER: ${character}`,
        '',
        'CONVERSATION:',
        transcript,
        '',
        'JSON:',
      ].join('\n'),
    },
  ];
}

export function extractionGenerationConfig(): {
  maxNewTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  doSample: boolean;
} {
  return {
    maxNewTokens: MEMORY_CONFIG.extractionMaxNewTokens,
    temperature: MEMORY_CONFIG.extractionTemperature,
    topP: 0.9,
    topK: 40,
    doSample: true,
  };
}

/**
 * Pull the first complete JSON object out of a model response.
 *
 * Small models wrap JSON in prose or code fences even when told not to, so this
 * locates the outermost braces rather than trusting the response to be clean.
 */
export function extractJsonObject(text: string): unknown | null {
  const withoutFences = text.replace(/```(?:json)?/gi, ' ');
  const start = withoutFences.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < withoutFences.length; i++) {
    const char = withoutFences[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(withoutFences.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function normalizeDelta(raw: unknown): RelationshipDelta {
  if (typeof raw !== 'object' || raw === null) return {};
  const record = raw as Record<string, unknown>;
  const delta: RelationshipDelta = {};

  for (const key of ['familiarity', 'trust', 'affection', 'tension'] as const) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      delta[key] = value;
    }
  }
  return delta;
}

export interface ParsedExtraction {
  memories: MemoryCandidate[];
  relationshipUpdates: RelationshipUpdateProposal[];
  /** Reasons individual raw entries were unusable, for the debug view. */
  warnings: string[];
  /** Raw entries that were dropped entirely. */
  rejected: string[];
}

/**
 * Parse and structurally normalize an extraction response.
 *
 * Returns `null` when the response contained no usable JSON at all, which the
 * caller reports as an extraction failure rather than silently doing nothing.
 */
export function parseExtractionResponse(text: string): ParsedExtraction | null {
  const parsed = extractJsonObject(text);
  if (parsed === null || typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const warnings: string[] = [];
  const rejected: string[] = [];
  const memories: MemoryCandidate[] = [];

  const rawMemories = Array.isArray(record.memories) ? record.memories : [];
  if (record.memories !== undefined && !Array.isArray(record.memories)) {
    warnings.push('memories field was not an array');
  }

  for (const raw of rawMemories) {
    const { candidate, reasons } = normalizeCandidate(raw);
    warnings.push(...reasons);
    if (!candidate) {
      rejected.push(typeof raw === 'object' && raw !== null ? JSON.stringify(raw).slice(0, 120) : String(raw));
      continue;
    }
    memories.push(candidate);
  }

  const relationshipUpdates: RelationshipUpdateProposal[] = [];
  const rawUpdates = Array.isArray(record.relationship_updates)
    ? record.relationship_updates
    : Array.isArray(record.relationshipUpdates)
      ? record.relationshipUpdates
      : [];
  if (
    record.relationship_updates !== undefined &&
    !Array.isArray(record.relationship_updates) &&
    record.relationshipUpdates === undefined
  ) {
    warnings.push('relationship_updates field was not an array');
  }

  for (const raw of rawUpdates) {
    if (typeof raw !== 'object' || raw === null) {
      warnings.push('relationship update was not an object');
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const delta = normalizeDelta(entry.delta ?? entry);
    if (Object.keys(delta).length === 0) {
      warnings.push('relationship update had no usable deltas');
      continue;
    }
    relationshipUpdates.push({
      delta,
      labels: Array.isArray(entry.labels)
        ? entry.labels.filter((l): l is string => typeof l === 'string')
        : undefined,
      reason: typeof entry.reason === 'string' ? entry.reason.slice(0, 120) : undefined,
    });
  }

  return { memories, relationshipUpdates, warnings, rejected };
}
