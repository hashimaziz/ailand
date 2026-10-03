import { describe, it, expect } from 'vitest';
import { explainModelLoadError, describeModelLoadError } from '../../src/ai/ModelErrors';
import { resolveModelConfig, dtypeNote, getModelConfig } from '../../src/ai/ModelConfig';
import { gpuBudgetWarnings, formatBytes, CapabilityReport } from '../../src/ai/ModelCapabilities';

describe('explainModelLoadError', () => {
  it('recognises the out-of-memory session failure and suggests fixes', () => {
    const advice = explainModelLoadError(
      "Can't create a session. ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc",
    );
    expect(advice.summary).toContain('out of memory');
    expect(advice.steps.join(' ')).toContain('smaller model');
    expect(advice.steps.join(' ')).toContain('CPU (WASM)');
    expect(advice.steps.join(' ')).toContain('WebGL2');
  });

  it('recognises a missing GPU backend and points at the browser', () => {
    const advice = explainModelLoadError(
      'no available backend found. ERR: [webgpu] Failed to get GPU adapter',
    );
    expect(advice.summary).toContain('GPU backend');
    expect(advice.steps.join(' ')).toContain('Chromium');
  });

  it('recognises a failed download', () => {
    expect(explainModelLoadError('Failed to fetch').steps.join(' ')).toContain('connection');
  });

  it('recognises a storage failure', () => {
    expect(explainModelLoadError('QuotaExceededError: cache is full').steps.join(' ')).toContain(
      'storage',
    );
  });

  it('always returns something actionable for an unknown error', () => {
    const advice = explainModelLoadError('something entirely unexpected');
    expect(advice.summary.length).toBeGreaterThan(0);
    expect(advice.steps.length).toBeGreaterThan(0);
  });

  it('formats a readable multi-line message', () => {
    const text = describeModelLoadError('std::bad_alloc');
    expect(text).toContain('•');
    expect(text.split('\n').length).toBeGreaterThan(2);
  });
});

describe('resolveModelConfig', () => {
  it('keeps the GPU config unchanged for webgpu', () => {
    expect(resolveModelConfig('qwen3-0.6b', 'webgpu')).toEqual(getModelConfig('qwen3-0.6b'));
  });

  it('switches to the wasm backend and drops float16 for the CPU', () => {
    const config = resolveModelConfig('qwen3-1.7b', 'wasm');
    expect(config.device).toBe('wasm');
    // q4f16 needs fp16 kernels the CPU backend does not have.
    expect(config.dtype).toBe('q4');
    expect(config.id).toBe(getModelConfig('qwen3-1.7b').id);
  });

  it('keeps thinking disabled on the CPU path', () => {
    expect(resolveModelConfig('qwen3-0.6b', 'wasm').enableThinking).toBe(false);
  });

  it('explains the dtype change', () => {
    expect(dtypeNote('qwen3-0.6b', 'wasm')).toContain('float16');
    expect(dtypeNote('qwen3-0.6b', 'webgpu')).toBeNull();
  });
});

describe('gpuBudgetWarnings', () => {
  const caps = (over: Partial<CapabilityReport>): CapabilityReport => ({
    webgpu: true,
    webgl2: true,
    workers: true,
    indexeddb: true,
    level: 'supported',
    warnings: [],
    ...over,
  });

  it('warns when the model dwarfs the adapter buffer limit', () => {
    const warnings = gpuBudgetWarnings(
      caps({ adapter: { maxBufferSize: 268435456 } }),
      { weightMb: 1360, rendererUsesWebGpu: false },
    );
    expect(warnings.join(' ')).toContain('caps buffers');
  });

  it('stays quiet for a small model on a generous adapter', () => {
    const warnings = gpuBudgetWarnings(
      caps({ adapter: { maxBufferSize: 2147483644 } }),
      { weightMb: 280, rendererUsesWebGpu: false },
    );
    expect(warnings).toEqual([]);
  });

  it('warns that the renderer holds a second device for a big model', () => {
    const warnings = gpuBudgetWarnings(caps({ adapter: {} }), {
      weightMb: 1360,
      rendererUsesWebGpu: true,
    });
    expect(warnings.join(' ')).toContain('WebGL2');
  });

  it('does not warn about the renderer when it is already on WebGL2', () => {
    const warnings = gpuBudgetWarnings(caps({ adapter: {} }), {
      weightMb: 1360,
      rendererUsesWebGpu: false,
    });
    expect(warnings).toEqual([]);
  });

  it('says nothing when there is no WebGPU at all', () => {
    expect(
      gpuBudgetWarnings(caps({ webgpu: false }), { weightMb: 1360, rendererUsesWebGpu: true }),
    ).toEqual([]);
  });
});

describe('formatBytes', () => {
  it('formats megabytes and kilobytes', () => {
    expect(formatBytes(268435456)).toBe('256 MB');
    expect(formatBytes(2048)).toBe('2 KB');
  });
});