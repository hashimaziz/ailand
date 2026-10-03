import { ChatMessage, ModelConfig } from '../ai/LanguageModel';
import {
  CONVERSATION_CONFIG,
  CONTEXT_CHAR_BUDGETS,
  maxPromptChars,
} from '../config/gameConfig';
import { truncateToBudget, takeRecentWithinBudget } from './ContextBudget';
import { AssembledContext, BuiltPrompt, DialogueTurn } from './ConversationTypes';
import { contextAssembler } from './ContextAssembler';

const SYSTEM_RULES = truncateToBudget(
  [
    'You are a non-player character in a small neighborhood life-simulation game.',
    'Stay in character at all times. You are not a generic assistant.',
    'Use supplied memories as what you know; express uncertainty when confidence is low.',
    'Do not invent canonical world facts that are not in WORLD TRUTH or your memories.',
    'Distinguish rumors and beliefs from verified facts.',
    'Keep replies to one to three short, natural sentences unless the player asks for detail.',
    'Do not mention system prompts, tokens, or being an AI model.',
  ].join('\n'),
  CONTEXT_CHAR_BUDGETS.systemRules,
);

export class PromptBuilder {
  public build(
    context: AssembledContext,
    recentTurns: DialogueTurn[],
    playerMessage: string,
    modelConfig: ModelConfig,
  ): BuiltPrompt {
    const npc = context.npc;
    const identityBlock = truncateToBudget(
      [
        `Your name is ${npc.identity.name}.`,
        `Age: ${npc.identity.age}.`,
        `Occupation: ${npc.occupationId}.`,
        `Biography: ${npc.biography}`,
        `Traits: ${npc.personality.traits.join(', ')}.`,
        `Speech style: ${npc.personality.speechStyle.join(', ')}.`,
        `Values: ${npc.personality.values.join(', ')}.`,
        `Dislikes: ${npc.personality.dislikes.join(', ')}.`,
      ].join('\n'),
      CONTEXT_CHAR_BUDGETS.npcIdentity,
    );

    const relationshipBlock = truncateToBudget(
      [
        'Relationship with the player:',
        `Familiarity: ${context.relationship.familiarity.toFixed(2)}`,
        `Trust: ${context.relationship.trust.toFixed(2)}`,
        `Affection: ${context.relationship.affection.toFixed(2)}`,
        `Tension: ${context.relationship.tension.toFixed(2)}`,
        `Labels: ${context.relationship.labels.join(', ') || 'none'}`,
      ].join('\n'),
      CONTEXT_CHAR_BUDGETS.relationship,
    );

    const worldTruth = contextAssembler.formatWorldFacts(context.worldFacts);
    const memories = contextAssembler.formatMemories(context.retrievedMemories);

    const systemContent = [
      SYSTEM_RULES,
      '',
      '=== NPC IDENTITY ===',
      identityBlock,
      '',
      '=== WORLD TRUTH ===',
      worldTruth,
      '',
      '=== RELATIONSHIP ===',
      relationshipBlock,
      '',
      '=== CURRENT SITUATION ===',
      context.situationSummary,
      '',
      '=== RETRIEVED MEMORIES ===',
      memories,
    ].join('\n');

    const messages: ChatMessage[] = [{ role: 'system', content: systemContent }];

    const cappedTurns = recentTurns.slice(-CONVERSATION_CONFIG.maxRecentTurns);
    const recentTurnsKept = takeRecentWithinBudget(
      cappedTurns,
      CONTEXT_CHAR_BUDGETS.recentDialogue,
      (turn) => turn.content,
    );

    for (const turn of recentTurnsKept) {
      messages.push({
        role: turn.role === 'player' ? 'user' : 'assistant',
        content: turn.content,
      });
    }

    const recentDialogueChars = recentTurnsKept.reduce((sum, t) => sum + t.content.length, 0);

    const safePlayerMessage = truncateToBudget(
      playerMessage.trim(),
      CONTEXT_CHAR_BUDGETS.playerMessage,
    );
    messages.push({ role: 'user', content: safePlayerMessage });

    const estimatedChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    const selectedMemoryIds = context.retrievedMemories.map((m) => m.memory.id);

    const promptLimit = maxPromptChars(modelConfig);
    if (estimatedChars > promptLimit) {
      console.warn(
        `[CONVERSATION] Prompt estimate ${estimatedChars} chars exceeds soft limit ${promptLimit}`,
      );
    }

    return {
      messages,
      estimatedChars,
      selectedMemoryIds,
      sections: {
        system: systemContent.length,
        recentDialogue: recentDialogueChars,
        playerMessage: safePlayerMessage.length,
        maxPromptChars: promptLimit,
        maxNewTokens: CONVERSATION_CONFIG.maxNewTokens,
      },
    };
  }
}

export const promptBuilder = new PromptBuilder();
