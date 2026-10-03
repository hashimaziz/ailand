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
  turns: DialogueTurn[];
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
