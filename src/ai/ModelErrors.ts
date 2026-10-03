// ─── Model Load Error Translation ───
//
// ORT surfaces allocation failures as opaque runtime errors. `std::bad_alloc` and
// "Can't create a session. ERROR_CODE: 6" mean the GPU could not allocate memory
// for the inference session, which is almost always fixable by changing something
// the player can see. Echoing the raw string back is not that.

export interface ModelLoadAdvice {
  /** Short statement of what went wrong. */
  summary: string;
  /** Concrete next steps, most likely to help first. */
  steps: string[];
}

const OUT_OF_MEMORY_PATTERNS = [
  'std::bad_alloc',
  "can't create a session",
  'error_code: 6',
  'out of memory',
  'failed to allocate',
  'create session',
];

const BACKEND_PATTERNS = [
  'no available backend',
  'failed to get gpu adapter',
  'webgpu is not available',
  'no available adapter',
];

const NETWORK_PATTERNS = ['failed to fetch', 'network', 'econnrefused', 'timed out', 'timeout'];

const STORAGE_PATTERNS = ['quota', 'cache', 'insufficient'];

export function explainModelLoadError(raw: string): ModelLoadAdvice {
  const text = raw.toLowerCase();

  const matches = (patterns: string[]) => patterns.some((p) => text.includes(p));

  if (matches(OUT_OF_MEMORY_PATTERNS)) {
    return {
      summary: 'The GPU ran out of memory creating the inference session.',
      steps: [
        'Try a smaller model — Qwen3 0.6B instead of 1.7B.',
        'Or switch Inference to CPU (WASM): slower, but it does not use GPU memory.',
        'Or switch Rendering to WebGL2, which frees the GPU device the renderer holds.',
        'Close other GPU-heavy tabs and apps, then try again.',
      ],
    };
  }

  if (matches(BACKEND_PATTERNS)) {
    return {
      summary: 'This browser could not give the runtime a GPU backend.',
      steps: [
        'Use a recent Chromium-based browser (Chrome or Edge) for local inference.',
        'In Safari, WebGPU support is newer and large models often cannot load.',
        'Or switch Inference to CPU (WASM).',
      ],
    };
  }

  if (matches(NETWORK_PATTERNS)) {
    return {
      summary: 'The model download did not complete.',
      steps: [
        'Check your connection and try again; the browser caches partial progress.',
        'A corporate proxy or content blocker may be blocking the model host.',
      ],
    };
  }

  if (matches(STORAGE_PATTERNS)) {
    return {
      summary: 'The browser could not store the downloaded model.',
      steps: [
        'Free up disk space or browser storage, then try again.',
        'Private browsing modes often block the model cache.',
      ],
    };
  }

  return {
    summary: 'The language model failed to load.',
    steps: ['Try again, or switch to the mock model to keep playing.'],
  };
}

/** Convenience for callers that just want a single readable string. */
export function describeModelLoadError(raw: string): string {
  const advice = explainModelLoadError(raw);
  return `${advice.summary}\n\n${advice.steps.map((s) => `• ${s}`).join('\n')}`;
}