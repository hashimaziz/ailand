// ─── Deferred Language Model ───
// Wraps a model that is created/loaded lazily so that the application can boot,
// render, and accept player input while a multi-hundred-megabyte model download
// is still in flight. The app depends only on the LanguageModel contract, so a
// real model, a mock, or a cloud endpoint can all be resolved behind this.

import {
  ChatMessage,
  GenerationConfig,
  GenerationEvent,
  InitializeOptions,
  LanguageModel,
  ModelInfo,
} from './LanguageModel';

export type LanguageModelFactory = () => Promise<LanguageModel>;

export class DeferredLanguageModel implements LanguageModel {
  private inner: LanguageModel | null = null;
  private loading: Promise<LanguageModel> | null = null;
  private epoch = 0;

  constructor(private factory: LanguageModelFactory) {}

  public isReady(): boolean {
    return this.inner?.isReady() ?? false;
  }

  public getModelInfo(): ModelInfo | null {
    return this.inner?.getModelInfo?.() ?? null;
  }

  public async initialize(options?: InitializeOptions): Promise<ModelInfo> {
    const model = await this.resolve();
    if (!model.isReady()) {
      return model.initialize(options);
    }
    return model.getModelInfo?.() ?? fallbackInfo();
  }

  public async generate(
    requestId: string,
    messages: ChatMessage[],
    config: GenerationConfig,
    onEvent: (event: GenerationEvent) => void,
  ): Promise<void> {
    const model = await this.resolve();
    if (!model.isReady()) {
      await model.initialize();
    }
    return model.generate(requestId, messages, config, onEvent);
  }

  public async cancel(requestId: string): Promise<void> {
    await this.inner?.cancel(requestId);
  }

  public async dispose(): Promise<void> {
    const current = this.inner;
    this.inner = null;
    this.loading = null;
    this.epoch++;
    await current?.dispose();
  }

  private resolve(): Promise<LanguageModel> {
    if (!this.loading) {
      const epoch = this.epoch;
      this.loading = this.factory()
        .then((model) => {
          if (epoch !== this.epoch) {
            void model.dispose();
            throw new Error('Model load was superseded.');
          }
          this.inner = model;
          return model;
        })
        .catch((err) => {
          if (epoch === this.epoch) {
            this.loading = null;
          }
          throw err;
        });
    }
    return this.loading;
  }
}

function fallbackInfo(): ModelInfo {
  return {
    id: 'unknown',
    device: 'unknown',
    dtype: 'unknown',
    loadTimeMs: 0,
  };
}
