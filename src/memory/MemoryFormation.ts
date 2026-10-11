import { ChatMessage } from '../ai/LanguageModel';
import { LOCATION_LABELS, MEMORY_CONFIG } from '../config/gameConfig';
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

/**
 * Schema the extraction response must satisfy.
 *
 * llama.cpp can constrain decoding to this, which turns memory extraction from
 * hopeful parsing into a guarantee. The in-browser runtimes ignore it and rely on
 * `parseExtractionResponse`, which is why that stays defensive.
 */
export const MEMORY_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['memories', 'relationship_updates'],
  properties: {
    memories: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'content', 'importance', 'confidence', 'source'],
        properties: {
          type: { type: 'string', enum: ['episodic', 'belief', 'rumor', 'relationship'] },
          content: { type: 'string', minLength: 8, maxLength: 400 },
          importance: { type: 'number', minimum: 0, maximum: 1 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          source: { type: 'string', enum: ['player', 'npc', 'observation', 'inference'] },
          entities: { type: 'array', items: { type: 'string' }, maxItems: 6 },
          locationId: {
            type: 'string',
            enum: Object.keys(LOCATION_LABELS),
          },
        },
      },
    },
    relationship_updates: {
      type: 'array',
      maxItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['delta'],
        properties: {
          delta: {
            type: 'object',
            additionalProperties: false,
            properties: {
              familiarity: { type: 'number', minimum: -1, maximum: 1 },
              trust: { type: 'number', minimum: -1, maximum: 1 },
              affection: { type: 'number', minimum: -1, maximum: 1 },
              tension: { type: 'number', minimum: -1, maximum: 1 },
            },
          },
          labels: { type: 'array', items: { type: 'string' }, maxItems: 5 },
          reason: { type: 'string', maxLength: 120 },
        },
      },
    },
  },
} as const;

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
  jsonSchema?: Record<string, unknown>;
} {
  return {
    maxNewTokens: MEMORY_CONFIG.extractionMaxNewTokens,
    temperature: MEMORY_CONFIG.extractionTemperature,
    topP: 0.9,
    topK: 40,
    doSample: true,
    // Honoured by llama.cpp; ignored by the in-browser runtimes.
    jsonSchema: MEMORY_EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
  };
}

interface JsonScan {
  stack: string[];
  inString: boolean;
  /** Index of the opening quote of the string being read, when inside one. */
  stringStart: number;
  /** Index just past the closing brace of the outermost object, when complete. */
  complete: number;
}

function scanJson(text: string): JsonScan {
  const stack: string[] = [];
  let inString = false;
  let stringStart = -1;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      if (inString) {
        inString = false;
      } else {
        inString = true;
        stringStart = i;
      }
      continue;
    }
    if (inString) continue;

    if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      stack.pop();
      if (stack.length === 0) {
        return { stack, inString, stringStart, complete: i + 1 };
      }
    }
  }

  return { stack, inString, stringStart, complete: -1 };
}

function closeOpen(text: string, stack: string[]): string {
  let out = text;
  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === '{' ? '}' : ']';
  }
  return out;
}

function tryParse(json: string): unknown | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Pull the first complete JSON object out of a model response.
 *
 * Small models wrap JSON in prose or code fences even when told not to, so this
 * locates the outermost braces rather than trusting the response to be clean.
 *
 * Truncated output is repaired rather than discarded. A model that hits the token
 * limit mid-object still produced usable information, and throwing all of it away
 * because the final brace is missing means an NPC silently forgets the
 * conversation. Two repairs are attempted: close what is still open, and — when
 * the cut landed inside a string, leaving an incomplete key or value — drop that
 * trailing fragment and close again. Anything still unparseable returns null.
 */
export function extractJsonObject(text: string): unknown | null {
  const withoutFences = text.replace(/```(?:json)?/gi, ' ');
  const start = withoutFences.indexOf('{');
  if (start === -1) return null;

  const body = withoutFences.slice(start);
  const scan = scanJson(body);

  if (scan.complete !== -1) return tryParse(body.slice(0, scan.complete));
  if (scan.stack.length === 0 && !scan.inString) return null;

  // Cut inside a string: drop the incomplete trailing member and close again.
  // Preferred over closing the string, because a half-written value would
  // otherwise be persisted as a garbage memory.
  if (scan.inString) {
    const fragmentStart = body.lastIndexOf(',', scan.stringStart);
    const boundary = fragmentStart > 0 ? fragmentStart : body.lastIndexOf('{', scan.stringStart);
    if (boundary > 0) {
      const trimmed = body.slice(0, boundary);
      const rescanned = scanJson(trimmed);
      const dropped = tryParse(closeOpen(trimmed, rescanned.stack));
      if (dropped !== null) return dropped;
    }
  }

  const closed = closeOpen(body, scan.stack);
  return tryParse(scan.inString ? `${body}"${closed.slice(body.length)}` : closed);
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
