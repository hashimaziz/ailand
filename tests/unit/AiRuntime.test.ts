import { describe, it, expect } from 'vitest';
import { MockLanguageModel } from '../../src/ai/MockLanguageModel';
import type { GenerationEvent } from '../../src/ai/LanguageModel';

describe('MockLanguageModel', () => {
  it('initializes and returns model info', async () => {
    const model = new MockLanguageModel();
    expect(model.isReady()).toBe(false);

    const info = await model.initialize();
    expect(model.isReady()).toBe(true);
    expect(info.id).toBe('mock-model');
    expect(info.loadTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('generates streaming tokens then completes', async () => {
    const model = new MockLanguageModel();
    await model.initialize();

    const events: GenerationEvent[] = [];
    await model.generate(
      'test-req-1',
      [{ role: 'user', content: 'Hello' }],
      { maxNewTokens: 64, temperature: 0.7, topP: 0.9, topK: 40, doSample: true },
      (event) => events.push(event),
    );

    // Should have: started, N tokens, completed
    expect(events[0].type).toBe('started');
    expect(events[events.length - 1].type).toBe('completed');

    const tokenEvents = events.filter((e) => e.type === 'token');
    expect(tokenEvents.length).toBeGreaterThan(0);

    const completed = events[events.length - 1];
    if (completed.type === 'completed') {
      expect(completed.fullText.length).toBeGreaterThan(0);
      expect(completed.usage).toBeDefined();
      expect(completed.usage!.tokensPerSecond).toBeGreaterThan(0);
    }
  });

  it('returns error if not initialized', async () => {
    const model = new MockLanguageModel();
    const events: GenerationEvent[] = [];

    await model.generate(
      'test-req-2',
      [{ role: 'user', content: 'Hello' }],
      { maxNewTokens: 64, temperature: 0.7, topP: 0.9, topK: 40, doSample: true },
      (event) => events.push(event),
    );

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('error');
  });

  it('disposes correctly', async () => {
    const model = new MockLanguageModel();
    await model.initialize();
    expect(model.isReady()).toBe(true);

    await model.dispose();
    expect(model.isReady()).toBe(false);
  });
});

describe('ModelBenchmark', () => {
  it('runs fixtures against mock model and produces results', async () => {
    const { ModelBenchmark, DEFAULT_FIXTURES } = await import('../../src/ai/ModelBenchmark');

    const model = new MockLanguageModel();
    const info = await model.initialize();

    const bench = new ModelBenchmark();
    const results = await bench.run(
      model,
      info.id,
      info.device,
      info.dtype,
      info.loadTimeMs,
      DEFAULT_FIXTURES,
    );

    expect(results.length).toBe(DEFAULT_FIXTURES.length);
    for (const r of results) {
      expect(r.response.length).toBeGreaterThan(0);
      expect(r.tokensPerSecond).toBeGreaterThan(0);
    }

    const formatted = bench.formatResults(results);
    expect(formatted).toContain('Model Benchmark Results');
    expect(formatted).toContain('mock-model');
  });
});
