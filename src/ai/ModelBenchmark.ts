// ─── Model Benchmark Harness ───
// Developer tool for measuring model performance.
// Not a gameplay feature — used to compare candidate models.

import { LanguageModel, ChatMessage, GenerationConfig, GenerationUsage } from './LanguageModel';

export interface BenchmarkFixture {
  name: string;
  messages: ChatMessage[];
  generationConfig: GenerationConfig;
}

export interface BenchmarkResult {
  fixture: string;
  modelId: string;
  dtype: string;
  device: string;
  loadMs: number;
  firstTokenMs: number;
  generationMs: number;
  outputTokens: number;
  tokensPerSecond: number;
  promptTokens: number;
  response: string;
}

// Default benchmark fixtures for NPC dialogue testing
export const DEFAULT_FIXTURES: BenchmarkFixture[] = [
  {
    name: 'identity_consistency',
    messages: [
      {
        role: 'system',
        content: 'You are Maria, a 28-year-old barista at the local coffee shop. You are friendly and observant. Keep responses to 1-3 short sentences.',
      },
      { role: 'user', content: 'What do you do around here?' },
    ],
    generationConfig: {
      maxNewTokens: 64,
      temperature: 0.7,
      topP: 0.8,
      topK: 20,
      doSample: true,
    },
  },
  {
    name: 'memory_recall',
    messages: [
      {
        role: 'system',
        content: 'You are David, a 45-year-old shopkeeper. You are grumpy and practical. You remember: the player helped fix the shop sign last week. Keep responses to 1-3 short sentences.',
      },
      { role: 'user', content: 'Hey David, remember me?' },
    ],
    generationConfig: {
      maxNewTokens: 64,
      temperature: 0.7,
      topP: 0.8,
      topK: 20,
      doSample: true,
    },
  },
  {
    name: 'conciseness',
    messages: [
      {
        role: 'system',
        content: 'You are a friendly neighborhood barista named Maria. Keep responses to 1-3 short sentences. Do not write long paragraphs.',
      },
      { role: 'user', content: 'How is the weather today?' },
    ],
    generationConfig: {
      maxNewTokens: 128,
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      doSample: true,
    },
  },
];

export class ModelBenchmark {
  async run(
    model: LanguageModel,
    modelId: string,
    device: string,
    dtype: string,
    loadMs: number,
    fixtures: BenchmarkFixture[] = DEFAULT_FIXTURES,
  ): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];

    for (const fixture of fixtures) {
      let usage: GenerationUsage | undefined;
      let response = '';

      await model.generate(
        `bench_${fixture.name}_${Date.now()}`,
        fixture.messages,
        fixture.generationConfig,
        (event) => {
          if (event.type === 'completed') {
            response = event.fullText;
            usage = event.usage;
          }
        },
      );

      results.push({
        fixture: fixture.name,
        modelId,
        dtype,
        device,
        loadMs,
        firstTokenMs: usage?.firstTokenMs ?? 0,
        generationMs: usage?.totalMs ?? 0,
        outputTokens: usage?.completionTokens ?? 0,
        tokensPerSecond: usage?.tokensPerSecond ?? 0,
        promptTokens: usage?.promptTokens ?? 0,
        response,
      });
    }

    return results;
  }

  formatResults(results: BenchmarkResult[]): string {
    const lines: string[] = [
      `\n═══ Model Benchmark Results ═══`,
      `Model: ${results[0]?.modelId ?? 'unknown'}`,
      `Device: ${results[0]?.device ?? 'unknown'}`,
      `Dtype: ${results[0]?.dtype ?? 'unknown'}`,
      `Load time: ${results[0]?.loadMs?.toFixed(0) ?? '?'}ms`,
      `───────────────────────────────`,
    ];

    for (const r of results) {
      lines.push(`\n[${r.fixture}]`);
      lines.push(`  First token: ${r.firstTokenMs.toFixed(0)}ms`);
      lines.push(`  Total: ${r.generationMs.toFixed(0)}ms`);
      lines.push(`  Tokens: ${r.outputTokens}`);
      lines.push(`  Speed: ${r.tokensPerSecond.toFixed(1)} tok/s`);
      lines.push(`  Response: "${r.response.slice(0, 120)}${r.response.length > 120 ? '...' : ''}"`);
    }

    lines.push(`\n═══════════════════════════════\n`);
    return lines.join('\n');
  }
}
