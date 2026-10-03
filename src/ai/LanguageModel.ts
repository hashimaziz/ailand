// ─── AI Runtime Types ───
// These types define the application-facing contract for the language model.
// The main thread must never import Transformers.js directly.
// Only the worker implementation depends on it.

export interface ModelConfig {
  id: string;
  task: 'text-generation';
  device: 'webgpu' | 'wasm';
  dtype?: string;
  enableThinking: boolean;
  maxContextTokens: number;
  defaultMaxNewTokens: number;
  temperature: number;
  topP: number;
  topK: number;
}

export interface ModelInfo {
  id: string;
  device: string;
  dtype: string;
  loadTimeMs: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerationConfig {
  maxNewTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  doSample: boolean;
}

export interface GenerationUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  firstTokenMs: number;
  totalMs: number;
  tokensPerSecond: number;
}

export type GenerationEvent =
  | { type: 'started'; requestId: string }
  | { type: 'token'; requestId: string; text: string }
  | { type: 'completed'; requestId: string; fullText: string; usage?: GenerationUsage }
  | { type: 'error'; requestId: string; message: string };

// ─── LanguageModel Interface ───
// Application-facing contract. Implementations may be:
//   - LocalTransformersModel (Web Worker + Transformers.js)
//   - MockLanguageModel (for testing)
//   - CloudLanguageModel (future)

export interface InitializeOptions {
  onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  phase: 'download' | 'load' | 'initialize';
  progress?: number;  // 0..1
  message?: string;
}

export interface LanguageModel {
  initialize(options?: InitializeOptions): Promise<ModelInfo>;
  generate(
    requestId: string,
    messages: ChatMessage[],
    config: GenerationConfig,
    onEvent: (event: GenerationEvent) => void
  ): Promise<void>;
  cancel(requestId: string): Promise<void>;
  dispose(): Promise<void>;
  isReady(): boolean;
  getModelInfo?(): ModelInfo | null;
}
