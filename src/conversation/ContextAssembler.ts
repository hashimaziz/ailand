import { MemoryRetriever } from '../memory/MemoryRetriever';
import { Memory } from '../memory/types';
import { Npc } from '../npc/types';
import { memoryStore } from '../memory/MemoryStore';
import { CONTEXT_CHAR_BUDGETS, LOCATION_LABELS } from '../config/gameConfig';
import { fitItemsToBudget, truncateToBudget } from './ContextBudget';
import { extractMentionedEntities } from './entityUtils';
import {
  AssembledContext,
  PlayerRelationshipSnapshot,
} from './ConversationTypes';
import { defaultPlayerRelationship } from '../npc/Relationship';

const retriever = new MemoryRetriever();

export { defaultPlayerRelationship };

export class ContextAssembler {
  public async assemble(input: {
    npc: Npc;
    playerMessage: string;
    worldTime: number;
    formattedTime: string;
    relationship?: PlayerRelationshipSnapshot;
  }): Promise<AssembledContext> {
    const allMemories = await memoryStore.getActiveMemories(input.npc.id);
    const mentionedEntities = extractMentionedEntities(input.playerMessage);

    const ranked = retriever.retrieve(
      {
        npcId: input.npc.id,
        playerMessage: input.playerMessage,
        currentLocationId: input.npc.state.locationId,
        mentionedEntities,
        currentTime: input.worldTime,
      },
      allMemories.filter((m) => m.type !== 'fact' || m.source !== 'world'),
    );

    const worldFacts = allMemories.filter((m) => m.type === 'fact' && m.source === 'world');

    const locationLabel =
      LOCATION_LABELS[input.npc.state.locationId] ?? input.npc.state.locationId;

    const situationSummary = truncateToBudget(
      [
        `Time: ${input.formattedTime}`,
        `Location: ${locationLabel}`,
        `Activity: ${input.npc.state.currentActivity}`,
        `Mood: ${input.npc.state.mood}`,
        `Energy: ${Math.round(input.npc.state.energy * 100)}%`,
      ].join('\n'),
      CONTEXT_CHAR_BUDGETS.currentSituation,
    );

    return {
      npc: input.npc,
      worldTime: input.worldTime,
      formattedTime: input.formattedTime,
      locationLabel,
      relationship: input.relationship ?? defaultPlayerRelationship(input.npc),
      worldFacts,
      retrievedMemories: ranked,
      situationSummary,
    };
  }

  public formatWorldFacts(facts: Memory[]): string {
    const { text } = fitItemsToBudget(
      facts,
      CONTEXT_CHAR_BUDGETS.worldTruth,
      (m) => `- ${m.content}`,
    );
    return text || '(No canonical world facts on record.)';
  }

  public formatMemories(matches: AssembledContext['retrievedMemories']): string {
    const { text } = fitItemsToBudget(
      matches,
      CONTEXT_CHAR_BUDGETS.memories,
      (m) =>
        `- [${m.memory.type}/${m.memory.source}, conf ${m.memory.confidence.toFixed(1)}] ${m.memory.content}`,
    );
    return text || '(No relevant personal memories for this topic.)';
  }
}

export const contextAssembler = new ContextAssembler();
