import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FIXTURES,
  countFlags,
  scoreResponse,
} from '../../src/ai/ModelBenchmark';
import { isKnownModelKey, getModelConfig, MODEL_CONFIGS } from '../../src/ai/ModelConfig';

describe('scoreResponse', () => {
  const greeting = DEFAULT_FIXTURES.find((f) => f.name === 'greeting_register')!;
  const midConversation = DEFAULT_FIXTURES.find((f) => f.name === 'no_reintroduction')!;
  const question = DEFAULT_FIXTURES.find((f) => f.name === 'question_not_echoed')!;

  it('passes a good neighbourly answer', () => {
    const flags = scoreResponse(greeting, "Morning! I'm Maria. You look like you need a coffee.");
    expect(flags.assistantRegister).toBe(false);
    expect(countFlags(flags)).toBe(0);
  });

  it('detects assistant register', () => {
    expect(scoreResponse(greeting, 'Hello! How can I help you today?').assistantRegister).toBe(true);
    expect(
      scoreResponse(greeting, 'Sure. Let me know if there is anything else I can do.').assistantRegister,
    ).toBe(true);
  });

  it('detects the model echoing the question back', () => {
    const flags = scoreResponse(question, "Have we met before? I'd say we're meeting now.");
    expect(flags.echoesPlayer).toBe(true);
  });

  it('detects reintroduction part-way through a conversation', () => {
    expect(scoreResponse(midConversation, "Hi, I'm Maria, a barista.").reintroduced).toBe(true);
  });

  it('does not flag a first-meeting introduction as reintroduction', () => {
    expect(scoreResponse(greeting, "Hello! I'm Maria.").reintroduced).toBe(false);
  });

  it('detects rambling past the one-to-three sentence target', () => {
    const rambling =
      'Well it depends on the day honestly. Some days it is quiet. Other days it is not. ' +
      'I try not to think about it too much. Anyway that is what I think about.';
    expect(scoreResponse(greeting, rambling).tooLong).toBe(true);
  });

  it('does not flag a short reply as too long', () => {
    expect(scoreResponse(greeting, 'Morning! You look tired.').tooLong).toBe(false);
  });
});

describe('benchmark fixtures', () => {
  it('covers the quality test set from the plan', () => {
    const names = DEFAULT_FIXTURES.map((f) => f.name);
    expect(names).toContain('identity_consistency');
    expect(names).toContain('memory_recall');
    expect(names).toContain('world_truth_grounding');
  });

  it('states an expectation for every fixture', () => {
    for (const fixture of DEFAULT_FIXTURES) {
      expect(fixture.expectation.length).toBeGreaterThan(0);
    }
  });

  it('keeps replies short to stay inside the dialogue token budget', () => {
    for (const fixture of DEFAULT_FIXTURES) {
      expect(fixture.generationConfig.maxNewTokens).toBeLessThanOrEqual(128);
    }
  });
});

describe('model configuration', () => {
  it('disables thinking for every candidate', () => {
    for (const [key, config] of Object.entries(MODEL_CONFIGS)) {
      expect(config.enableThinking, key).toBe(false);
    }
  });

  it('recognises known keys and rejects unknown ones', () => {
    expect(isKnownModelKey('qwen3-1.7b')).toBe(true);
    expect(isKnownModelKey('not-a-model')).toBe(false);
  });

  it('falls back to the default for an unknown key', () => {
    expect(getModelConfig('not-a-model').id).toBe(getModelConfig().id);
  });

  it('includes a larger candidate so the default can be chosen on evidence', () => {
    expect(MODEL_CONFIGS['qwen3-1.7b']).toBeDefined();
  });
});