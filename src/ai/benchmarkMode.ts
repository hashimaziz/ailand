// ─── Benchmark Mode ───
// Runs the candidate models from `MODEL_CONFIGS` against the quality test set and
// reports latency, throughput, and mechanically-detectable quality failures.
//
// Developer tooling, gated behind `?bench=1`, and deliberately not part of the
// game loop. It builds its own worker per candidate rather than going through
// `createLanguageModel`, because that function reads the URL for mock/real
// overrides and falls back to the mock — neither is what a benchmark wants.

import { detectCapabilities } from './ModelCapabilities';
import { MODEL_CONFIGS, getModelConfig } from './ModelConfig';
import { DEFAULT_FIXTURES, ModelBenchmark, countFlags } from './ModelBenchmark';
import { ModelInfo } from './LanguageModel';

export interface BenchmarkSummary {
  key: string;
  modelId: string;
  loaded: boolean;
  loadMs: number;
  meanFirstTokenMs: number;
  meanTokensPerSecond: number;
  flagCounts: Record<string, number>;
  totalFlags: number;
}

export async function runCandidateBenchmark(
  key: string,
  onProgress?: (message: string) => void,
): Promise<{ results: Awaited<ReturnType<ModelBenchmark['run']>>; summary: BenchmarkSummary } | null> {
  const config = getModelConfig(key);
  const { AiWorkerClient } = await import('./AiWorkerClient');

  onProgress?.(`loading ${key} (${config.id})…`);
  const client = new AiWorkerClient(config);
  let info: ModelInfo;
  try {
    info = await client.initialize({
      onProgress: (event) => onProgress?.(`${key}: ${event.message ?? event.phase}`),
    });
  } catch (err) {
    onProgress?.(`${key} failed to load: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  try {
    const results = await new ModelBenchmark().run(
      client,
      info.id,
      info.device,
      info.dtype,
      info.loadTimeMs,
      DEFAULT_FIXTURES,
    );

    const flagCounts: Record<string, number> = {};
    for (const result of results) {
      for (const [flag, on] of Object.entries(result.flags)) {
        if (on) flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
      }
    }

    const totalFlags = results.reduce((sum, r) => sum + countFlags(r.flags), 0);

    return {
      results,
      summary: {
        key,
        modelId: info.id,
        loaded: true,
        loadMs: info.loadTimeMs,
        meanFirstTokenMs: mean(results.map((r) => r.firstTokenMs)),
        meanTokensPerSecond: mean(results.map((r) => r.tokensPerSecond)),
        flagCounts,
        totalFlags,
      },
    };
  } finally {
    await client.dispose();
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Benchmark every configured candidate and print a comparison table.
 * Requires WebGPU; a real comparison is not possible without it.
 */
export async function runBenchmark(): Promise<BenchmarkSummary[]> {
  const caps = await detectCapabilities();
  if (!caps.webgpu) {
    console.warn(
      '[BENCH] WebGPU is unavailable, so candidates cannot be compared. ' +
        'Open this in a desktop Chromium browser with WebGPU enabled.',
    );
    return [];
  }

  const summaries: BenchmarkSummary[] = [];

  for (const key of Object.keys(MODEL_CONFIGS)) {
    console.log(`\n[BENCH] ─── ${key} ───`);
    const outcome = await runCandidateBenchmark(key, (m) => console.log(`[BENCH] ${m}`));
    if (!outcome) {
      summaries.push({
        key,
        modelId: getModelConfig(key).id,
        loaded: false,
        loadMs: 0,
        meanFirstTokenMs: 0,
        meanTokensPerSecond: 0,
        flagCounts: {},
        totalFlags: 0,
      });
      continue;
    }

    console.log(new ModelBenchmark().formatResults(outcome.results));
    summaries.push(outcome.summary);
  }

  console.log('[BENCH] ═══ comparison ═══');
  for (const s of summaries) {
    const flags = Object.entries(s.flagCounts)
      .map(([name, count]) => `${name}×${count}`)
      .join(' ') || 'none';
    console.log(
      `[BENCH] ${s.key.padEnd(16)} ${
        s.loaded ? 'ok' : 'FAILED'
      }  load ${s.loadMs.toFixed(0)}ms  ttft ${s.meanFirstTokenMs.toFixed(0)}ms  ` +
        `${s.meanTokensPerSecond.toFixed(1)} tok/s  flags: ${flags}`,
    );
  }
  console.log(
    '[BENCH] Fewer flags is better. A model that answers in character but slowly is a better trade than a fast one that says "How can I help you?".',
  );

  return summaries;
}