import { detectCapabilities } from './ModelCapabilities';
import { MockLanguageModel } from './MockLanguageModel';
import { getModelConfig } from './ModelConfig';
import { LanguageModel, ProgressEvent } from './LanguageModel';

export type LanguageModelKind = 'worker' | 'mock';

export interface CreateLanguageModelResult {
  model: LanguageModel;
  kind: LanguageModelKind;
  fallbackReason?: string;
}

export async function createLanguageModel(options?: {
  onProgress?: (event: ProgressEvent) => void;
}): Promise<CreateLanguageModelResult> {
  const params = new URLSearchParams(window.location.search);
  const forceMock = params.get('mockAi') === '1';
  const forceReal = params.get('realAi') === '1';

  if (forceMock) {
    const mock = new MockLanguageModel();
    await mock.initialize({ onProgress: options?.onProgress });
    return { model: mock, kind: 'mock' };
  }

  if (!forceReal) {
    const caps = await detectCapabilities();
    if (!caps.webgpu) {
      const mock = new MockLanguageModel();
      await mock.initialize({ onProgress: options?.onProgress });
      return {
        model: mock,
        kind: 'mock',
        fallbackReason:
          caps.reason ??
          'WebGPU is unavailable in this browser. Using the mock dialogue model (?realAi=1 to force download).',
      };
    }
  }

  const config = getModelConfig();
  const { AiWorkerClient } = await import('./AiWorkerClient');
  const client = new AiWorkerClient(config);
  try {
    await client.initialize({ onProgress: options?.onProgress });
    return { model: client, kind: 'worker' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[AI] Worker model failed, using mock:', message);
    const mock = new MockLanguageModel();
    await mock.initialize({ onProgress: options?.onProgress });
    return {
      model: mock,
      kind: 'mock',
      fallbackReason: `Local model failed to load: ${message}`,
    };
  }
}
