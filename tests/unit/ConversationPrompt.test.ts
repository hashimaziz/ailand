import { describe, it, expect } from 'vitest';
import { promptBuilder, relationshipGuidance } from '../../src/conversation/PromptBuilder';
import { getModelConfig } from '../../src/ai/ModelConfig';
import { maxPromptChars, CONTEXT_CHAR_BUDGETS } from '../../src/config/gameConfig';
import { AssembledContext } from '../../src/conversation/ConversationTypes';
import { Npc } from '../../src/npc/types';

const sampleNpc: Npc = {
  id: 'npc_1',
  identity: { name: 'Maria', age: 28 },
  personality: {
    traits: ['friendly'],
    speechStyle: ['warm'],
    values: ['community'],
    dislikes: ['rudeness'],
    voiceExamples: ['Morning! The usual?'],
    socialDisposition: 0.8,
    trustBaseline: 0.6,
  },
  biography: 'Barista who knows the neighborhood.',
  occupationId: 'barista',
  homeLocationId: 'apartments',
  schedule: [],
  state: {
    locationId: 'coffee-shop',
    mood: 'cheerful',
    energy: 0.9,
    stress: 0.1,
    hunger: 0.2,
    currentActivity: 'Working',
    lastSimulatedAt: 0,
  },
};

function sampleContext(): AssembledContext {
  return {
    npc: sampleNpc,
    worldTime: 1000,
    formattedTime: 'Day 1, 10:00',
    locationLabel: 'West Coffee Shop',
    relationship: {
      familiarity: 0.2,
      trust: 0.3,
      affection: 0.25,
      tension: 0.05,
      labels: ['acquaintance'],
    },
    worldFacts: [],
    retrievedMemories: [],
    situationSummary: 'Time: Day 1\nLocation: coffee shop',
  };
}

describe('PromptBuilder', () => {
  it('includes NPC identity and stays within soft prompt budget', () => {
    const modelConfig = getModelConfig();
    const built = promptBuilder.build(sampleContext(), [], 'Hello Maria!', modelConfig);

    expect(built.messages[0].role).toBe('system');
    expect(built.messages[0].content).toContain('Your name is Maria');
    expect(built.messages[built.messages.length - 1].content).toBe('Hello Maria!');
    expect(built.estimatedChars).toBeLessThanOrEqual(maxPromptChars(modelConfig) + 200);
  });

  it('bounds recent dialogue to configured window', () => {
    const modelConfig = getModelConfig();
    const longHistory = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'player' : 'npc') as 'player' | 'npc',
      content: `Message number ${i} with some extra words to consume space.`,
      at: i,
    }));

    const built = promptBuilder.build(
      sampleContext(),
      longHistory,
      'Latest question?',
      modelConfig,
    );

    // Recent turns are replayed as real chat turns, not a prose recap block.
    const history = built.messages.slice(1, -1);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].role).toBe('user');
    expect(history.at(-1)!.content).toContain('Message number 19');
    expect(history.some((m) => m.content.includes('Message number 0'))).toBe(false);

    // The whole replayed history stays inside its character budget.
    const historyChars = history.reduce((sum, m) => sum + m.content.length, 0);
    expect(historyChars).toBeLessThanOrEqual(CONTEXT_CHAR_BUDGETS.recentDialogue);
    expect(built.sections.recentDialogue).toBe(historyChars);

    // Only the newest turns that fit are replayed, and alternation is preserved.
    expect(history.every((m, i) => m.role === (i % 2 === 0 ? 'user' : 'assistant'))).toBe(true);

    // The current player message is always the final turn.
    const last = built.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content).toBe('Latest question?');
  });

  it('does not invent an assistant turn when there is no history', () => {
    const modelConfig = getModelConfig();
    const built = promptBuilder.build(sampleContext(), [], 'Hello there', modelConfig);

    expect(built.messages).toHaveLength(2);
    expect(built.messages[1].role).toBe('user');
    expect(built.sections.recentDialogue).toBe(0);
  });

  it('demonstrates the target voice instead of only prohibiting bad behaviour', () => {
    const system = promptBuilder
      .build(sampleContext(), [], 'Hello', getModelConfig())
      .messages[0].content;

    // Concrete instructions, not just negations.
    expect(system).toContain('One to three short sentences');
    expect(system).toContain('EXAMPLE');
    // Guards against the assistant register and self-restarting behaviour.
    expect(system).toContain('How can I help you?');
    expect(system).toContain('introduce yourself once');
  });

  it('includes the NPC voice examples verbatim', () => {
    const system = promptBuilder
      .build(sampleContext(), [], 'Hello', getModelConfig())
      .messages[0].content;

    expect(system).toContain('Morning! The usual?');
  });

  it('renders occupations as prose rather than debug slugs', () => {
    const system = promptBuilder
      .build(sampleContext(), [], 'Hello', getModelConfig())
      .messages[0].content;

    expect(system).toContain('barista at the West Coffee Shop');
    expect(system).not.toContain('Occupation: barista');
  });
});

describe('relationshipGuidance', () => {
  it('tells a stranger not to be over-familiar', () => {
    expect(relationshipGuidance(0.15)).toContain('have not really spoken before');
  });

  it('tells an acquaintance not to re-introduce', () => {
    expect(relationshipGuidance(0.3)).toContain('do not introduce yourself again');
  });

  it('tells a friend to skip the small talk', () => {
    expect(relationshipGuidance(0.6)).toContain('do not re-introduce yourself');
  });

  it('varies the guidance with familiarity', () => {
    const seen = new Set(
      [0.1, 0.3, 0.6].map((f) => relationshipGuidance(f)),
    );
    expect(seen.size).toBe(3);
  });
});
