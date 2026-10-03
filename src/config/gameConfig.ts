import { ModelConfig } from '../ai/LanguageModel';

export const LOCATION_LABELS: Record<string, string> = {
  apartments: 'North Apartments',
  park: 'South Park',
  'coffee-shop': 'West Coffee Shop',
  shop: 'East Shop',
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

export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / CONVERSATION_CONFIG.charsPerToken);
}

export function maxPromptChars(modelConfig: ModelConfig): number {
  return modelConfig.maxContextTokens * CONVERSATION_CONFIG.charsPerToken;
}
