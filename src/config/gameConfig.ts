import { ModelConfig } from '../ai/LanguageModel';

export const LOCATION_LABELS: Record<string, string> = {
  apartments: 'North Apartments',
  park: 'South Park',
  'coffee-shop': 'West Coffee Shop',
  shop: 'East Shop',
};

/** Human-readable occupations. Slugs like `barista` read as debug data in a prompt. */
export const OCCUPATION_LABELS: Record<string, string> = {
  barista: 'barista at the West Coffee Shop',
  shopkeeper: 'owner of the East Shop',
  mechanic: 'mechanic',
  student: 'student',
  retired: 'retired neighbour',
  driver: 'delivery driver',
  musician: 'musician',
  officeworker: 'office worker',
  dogwalker: 'dog walker',
};

export const CONVERSATION_CONFIG = {
  maxRecentTurns: 6,
  maxNewTokens: 128,
  /** Approximate characters per token for budget estimation */
  charsPerToken: 4,
};

export const CONTEXT_CHAR_BUDGETS = {
  systemRules: 1400,
  npcIdentity: 1000,
  worldTruth: 1000,
  relationship: 600,
  currentSituation: 600,
  memories: 2000,
  recentDialogue: 1200,
  playerMessage: 600,
} as const;

export const MEMORY_CONFIG = {
  /** A conversation shorter than this is not worth an extraction round-trip. */
  minConversationChars: 80,
  minPlayerTurns: 1,
  /** Structured extraction budget. Generous enough for a small JSON envelope. */
  extractionMaxNewTokens: 224,
  extractionTemperature: 0.3,
  /** Candidates below this importance are treated as chatter and dropped. */
  minImportance: 0.25,
  maxContentChars: 500,
  /** Per-NPC ceiling. Oldest low-value memories are pruned past this point. */
  maxMemoriesPerNpc: 120,
  /** Candidates claiming this source are always rejected: the model has no authority. */
  forbiddenSources: ['world'] as const,
  /** Largest absolute change a single conversation may make to a relationship value. */
  maxRelationshipDelta: 0.15,
  maxRelationshipLabels: 5,
} as const;

export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / CONVERSATION_CONFIG.charsPerToken);
}

export function maxPromptChars(modelConfig: ModelConfig): number {
  return modelConfig.maxContextTokens * CONVERSATION_CONFIG.charsPerToken;
}
