import { ModelConfig } from './LanguageModel';

// ─── Default Model Configurations ───
// These are starting values for benchmarking; the architecture does not
// depend on any one model.

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

export function getModelConfig(key?: string): ModelConfig {
  return MODEL_CONFIGS[key ?? DEFAULT_MODEL_KEY] ?? MODEL_CONFIGS[DEFAULT_MODEL_KEY];
}
