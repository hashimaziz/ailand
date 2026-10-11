import { Memory } from '../memory/types';
import { MemoryMatch } from '../memory/MemoryRetriever';
import { Npc } from '../npc/types';
import { ChatMessage } from '../ai/LanguageModel';

export interface DialogueTurn {
  role: 'player' | 'npc';
  content: string;
  at: number;
}

export interface PlayerRelationshipSnapshot {
  familiarity: number;
  trust: number;
  affection: number;
  tension: number;
  labels: string[];
}

export interface ConversationSession {
  npcId: string;
  startedAt: number;
  /**
   * The bounded window replayed into the prompt.
   *
   * Trimmed to `maxRecentTurns` so the prompt stays small, which is not the same
   * thing as what happened.
   */
  turns: DialogueTurn[];
  /**
   * Every turn of this conversation, never trimmed.
   *
   * Memory formation reads this. Trimming to the prompt window first meant a long
   * conversation was distilled from only its last few exchanges, so whatever the
   * player said at the start was never remembered.
   */
  transcript: DialogueTurn[];
}

export interface AssembledContext {
  npc: Npc;
  worldTime: number;
  formattedTime: string;
  locationLabel: string;
  relationship: PlayerRelationshipSnapshot;
  worldFacts: Memory[];
  retrievedMemories: MemoryMatch[];
  situationSummary: string;
}

export interface BuiltPrompt {
  messages: ChatMessage[];
  estimatedChars: number;
  selectedMemoryIds: string[];
  sections: Record<string, number>;
}

export type ConversationPhase =
  | 'idle'
  | 'loading_model'
  | 'ready'
  | 'generating'
  | 'error';
