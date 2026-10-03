import { ModelConfig } from './LanguageModel';

// ─── Default Model Configurations ───
// Starting values for benchmarking; the architecture does not depend on any one
// model. Artifact sizes verified against the Hugging Face API on 2026-10-03:
// Qwen3-0.6B q4f16 ≈ 543 MB, Qwen3-1.7B q4f16 ≈ 1360 MB.
//
// DEFAULT_MODEL_KEY is a judgement, not a measurement. Run the benchmark
// (`npm run dev` then open `?bench=1`) before trusting it — a sub-billion model
// has visibly more trouble holding an in-character voice.

export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'qwen3-0.6b': {
    id: 'onnx-community/Qwen3-0.6B-ONNX',
    task: 'text-generation',
    device: 'webgpu',
    dtype: 'q4f16',
    enableThinking: false,
    maxContextTokens: 2048,
    defaultMaxNewTokens: 128,
    temperature: 0.7,
    topP: 0.8,
    topK: 20,
  },
  'qwen3-1.7b': {
    id: 'onnx-community/Qwen3-1.7B-ONNX',
    task: 'text-generation',
    device: 'webgpu',
    dtype: 'q4f16',
    enableThinking: false,
    maxContextTokens: 2048,
    defaultMaxNewTokens: 128,
    temperature: 0.7,
    topP: 0.8,
    topK: 20,
  },
  'smollm2-360m': {
    id: 'onnx-community/SmolLM2-360M-Instruct-ONNX',
    task: 'text-generation',
    device: 'webgpu',
    dtype: 'q4f16',
    enableThinking: false,
    maxContextTokens: 2048,
    defaultMaxNewTokens: 128,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
  },
};

export const DEFAULT_MODEL_KEY = 'qwen3-0.6b';

export function isKnownModelKey(key: string): boolean {
  return key in MODEL_CONFIGS;
}

export function getModelConfig(key?: string): ModelConfig {
  return MODEL_CONFIGS[key ?? DEFAULT_MODEL_KEY] ?? MODEL_CONFIGS[DEFAULT_MODEL_KEY];
}
