import { describe, it, expect } from 'vitest';
import { MockLanguageModel } from '../../src/ai/MockLanguageModel';
import { DeferredLanguageModel } from '../../src/ai/DeferredLanguageModel';
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

  it('completes with partial text when cancelled mid-stream', async () => {
    const model = new MockLanguageModel();
    await model.initialize();

    const events: GenerationEvent[] = [];
    const generation = model.generate(
      'test-req-cancel',
      [{ role: 'user', content: 'Tell me a long story about the neighbourhood' }],
      { maxNewTokens: 64, temperature: 0.7, topP: 0.9, topK: 40, doSample: true },
      (event) => {
        events.push(event);
        if (event.type === 'token') {
          void model.cancel('test-req-cancel');
        }
      },
    );

    await generation;

    const last = events.at(-1)!;
    expect(last.type).toBe('completed');
    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens.length).toBeGreaterThan(0);
    // Cancelling must settle the request rather than leaving it hanging.
    expect(events.length).toBeLessThan(20);
  });

  it('is idempotent across repeated initialize calls', async () => {
    const model = new MockLanguageModel();
    const first = await model.initialize();
    const second = await model.initialize();

    expect(second).toEqual(first);
    expect(model.getModelInfo()?.id).toBe('mock-model');
  });
});

describe('DeferredLanguageModel', () => {
  const messages = [{ role: 'user' as const, content: 'Hello' }];
  const generation = { maxNewTokens: 8, temperature: 0.7, topP: 0.9, topK: 40, doSample: true };

  it('does not create the underlying model until it is needed', async () => {
    let created = 0;
    const model = new DeferredLanguageModel(async () => {
      created++;
      const inner = new MockLanguageModel();
      await inner.initialize();
      return inner;
    });

    expect(model.isReady()).toBe(false);
    expect(created).toBe(0);

    await model.initialize();
    expect(created).toBe(1);
    expect(model.isReady()).toBe(true);
  });

  it('creates the underlying model only once across concurrent callers', async () => {
    let created = 0;
    const model = new DeferredLanguageModel(async () => {
      created++;
      const inner = new MockLanguageModel();
      await inner.initialize();
      return inner;
    });

    await Promise.all([model.initialize(), model.initialize()]);
    await model.generate('req-1', messages, generation, () => {});

    expect(created).toBe(1);
  });

  it('propagates factory failures and allows a later retry', async () => {
    let attempts = 0;
    const model = new DeferredLanguageModel(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('download failed');
      }
      const inner = new MockLanguageModel();
      await inner.initialize();
      return inner;
    });

    await expect(model.initialize()).rejects.toThrow('download failed');
    await expect(model.initialize()).resolves.toBeDefined();
    expect(attempts).toBe(2);
  });

  it('loads the model on first generate when it was never initialized', async () => {
    const model = new DeferredLanguageModel(async () => new MockLanguageModel());
    const events: GenerationEvent[] = [];

    await model.generate('req-2', messages, generation, (e) => events.push(e));

    expect(events[0].type).toBe('started');
    expect(events.at(-1)!.type).toBe('completed');
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
