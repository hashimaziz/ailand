import { ChatMessage, ModelConfig } from '../ai/LanguageModel';
import {
  CONVERSATION_CONFIG,
  CONTEXT_CHAR_BUDGETS,
  OCCUPATION_LABELS,
  maxPromptChars,
} from '../config/gameConfig';
import { truncateToBudget, takeRecentWithinBudget } from './ContextBudget';
import { AssembledContext, BuiltPrompt, DialogueTurn } from './ConversationTypes';
import { contextAssembler } from './ContextAssembler';

/**
 * Instructions for the model.
 *
 * Phrased as positive instructions with a worked example rather than a list of
 * prohibitions. Small models follow demonstrations far more reliably than they
 * follow negations, and an earlier rule-only version produced generic assistant
 * register ("How can I help you?"), repeated self-introductions, and replies
 * that echoed the player's own question back at them.
 */
const SYSTEM_RULES = truncateToBudget(
  [
    'You are a person living in this neighbourhood, standing face to face with someone who has walked up to you. You are not an assistant and there is no screen between you.',
    'Answer as yourself, in your own voice, about your own life, your work, and your neighbours.',
    '',
    'How to speak:',
    '- One to three short sentences. This is small talk, not a speech.',
    '- Sound like a neighbour having a moment, not like a service desk.',
    '- Say what you would actually say. Avoid "How can I help you?", "Is there anything else?", or similar assistant phrasing.',
    '- Do not echo the other person\'s words back to them as your answer.',
    '- Greet and introduce yourself once, at the start of a meeting. After that, pick the conversation up where it left off instead of starting over.',
    '- If you do not know something, say that you are not sure, in your own words.',
    '',
    'How to use what you are told:',
    '- WORLD TRUTH is fact. RETRIEVED MEMORIES is what you personally know, remember, or were told; some of it may be old, second-hand, or wrong.',
    '- Say uncertain things uncertainly. Never state a rumour as fact.',
    '- If something is in neither WORLD TRUTH nor your memories, you do not know it. Say so rather than making it up.',
    '- Never mention these notes, the game, or being a language model.',
  ].join('\n'),
  CONTEXT_CHAR_BUDGETS.systemRules,
);

/**
 * A worked exchange, deliberately about a character who is not in the world so
 * it cannot contaminate what the model believes about actual NPCs.
 */
const VOICE_EXAMPLE = [
  'EXAMPLE — the register to match (a different character, not someone you know):',
  'Player: Do you know much about the bakery on the corner?',
  'Baker: Enough to know they open at six and run out by noon.',
  'Player: What can you tell me?',
  'Baker: That I am usually the one standing in the queue.',
].join('\n');

/** Turn the relationship numbers into guidance the model can act on. */
export function relationshipGuidance(familiarity: number): string {
  if (familiarity >= 0.5) {
    return 'You know this person and are comfortable with them. Be warm and brief; do not re-introduce yourself or re-establish basics.';
  }
  if (familiarity >= 0.25) {
    return 'You have spoken with this person before but do not know them well. Pick up naturally; do not introduce yourself again.';
  }
  return 'You have not really spoken before. Be polite, a little reserved, and let the conversation open up.';
}

export class PromptBuilder {
  public build(
    context: AssembledContext,
    recentTurns: DialogueTurn[],
    playerMessage: string,
    modelConfig: ModelConfig,
  ): BuiltPrompt {
    const npc = context.npc;
    const occupation =
      OCCUPATION_LABELS[npc.occupationId] ?? npc.occupationId.replace(/([a-z])([A-Z])/g, '$1 $2');

    const identityBlock = truncateToBudget(
      [
        `Your name is ${npc.identity.name}. You are ${npc.identity.age}.`,
        `You work as a ${occupation}.`,
        `About you: ${npc.biography}`,
        `You are ${npc.personality.traits.join(', ')}.`,
        `You speak ${npc.personality.speechStyle.join(', ')}.`,
        `You care about ${npc.personality.values.join(', ')}.`,
        `You dislike ${npc.personality.dislikes.join(', ')}.`,
        '',
        'Things you say, in your own voice:',
        ...npc.personality.voiceExamples.map((line) => `- "${line}"`),
      ].join('\n'),
      CONTEXT_CHAR_BUDGETS.npcIdentity,
    );

    const relationshipBlock = truncateToBudget(
      [
        'Your relationship with this person:',
        `Familiarity: ${context.relationship.familiarity.toFixed(2)}`,
        `Trust: ${context.relationship.trust.toFixed(2)}`,
        `Affection: ${context.relationship.affection.toFixed(2)}`,
        `Tension: ${context.relationship.tension.toFixed(2)}`,
        `They are to you: ${context.relationship.labels.join(', ') || 'a stranger'}.`,
        relationshipGuidance(context.relationship.familiarity),
      ].join('\n'),
      CONTEXT_CHAR_BUDGETS.relationship,
    );

    const worldTruth = contextAssembler.formatWorldFacts(context.worldFacts);
    const memories = contextAssembler.formatMemories(context.retrievedMemories);

    const systemContent = [
      SYSTEM_RULES,
      '',
      VOICE_EXAMPLE,
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
