import { detectCapabilities } from './ModelCapabilities';
import { MockLanguageModel } from './MockLanguageModel';
import { getModelConfig } from './ModelConfig';
import { getConfig } from '../config/appConfig';
import { LanguageModel, ProgressEvent } from './LanguageModel';

export type LanguageModelKind = 'worker' | 'mock';

export interface CreateLanguageModelResult {
  model: LanguageModel;
  kind: LanguageModelKind;
  fallbackReason?: string;
}

export function isBenchmarkRequested(): boolean {
  return getConfig().runBenchmark;
}

/**
 * Choose and construct a language model.
 *
 * Returns an **uninitialised** model on purpose. Initialising here would mean the
 * download finished before the caller's progress callback could ever be
 * registered, which made download progress impossible to observe and left the
 * startup screen looking frozen. The caller initialises, passing its own
 * `onProgress`.
 *
 * The configuration comes from the startup menu, not the URL, so "which model am
 * I testing?" has one answer.
 */
export async function createLanguageModel(options?: {
  /** Override the configured candidate. */
  modelKey?: string;
  /** Ignored; accepted so callers can pass options through unchanged. */
  onProgress?: (event: ProgressEvent) => void;
}): Promise<CreateLanguageModelResult> {
  const config = getConfig();
  const modelKey = options?.modelKey ?? config.modelKey;

  if (config.aiSource === 'mock') {
    return { model: new MockLanguageModel(), kind: 'mock' };
  }

  if (config.aiSource === 'auto') {
    const caps = await detectCapabilities();
    if (!caps.webgpu) {
      return {
        model: new MockLanguageModel(),
        kind: 'mock',
        fallbackReason:
          caps.reason ?? 'WebGPU is unavailable in this browser. Using the mock dialogue model.',
      };
    }
  }

  const modelConfig = getModelConfig(modelKey);
  const { AiWorkerClient } = await import('./AiWorkerClient');
  return { model: new AiWorkerClient(modelConfig), kind: 'worker' };
}

/**
 * Construct a model and initialise it, falling back to the mock when the browser
 * cannot run the real one.
 *
 * Only used by paths that have no startup screen to recover on. When the user
 * explicitly asked for the local model, a failure is reported instead of being
 * quietly swapped for a mock — silently changing what is being tested is worse
 * than an error message.
 */
export async function createReadyLanguageModel(options?: {
  modelKey?: string;
  onProgress?: (event: ProgressEvent) => void;
}): Promise<CreateLanguageModelResult> {
  const config = getConfig();
  const result = await createLanguageModel(options);

  try {
    await result.model.initialize({ onProgress: options?.onProgress });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (config.aiSource === 'local') {
      throw err;
    }
    console.warn('[AI] Local model failed to load, using mock:', message);
    const mock = new MockLanguageModel();
    await mock.initialize();
    return {
      model: mock,
      kind: 'mock',
      fallbackReason: `Local model failed to load: ${message}`,
    };
  }
}