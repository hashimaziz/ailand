// ─── Browser Capability Detection ───
//
// Reports what this browser can actually do, and — just as importantly — why it
// cannot. "Local AI failed" is not actionable; "this adapter allows 256 MB buffers
// and the model graph is 1360 MB" is.

export interface AdapterReport {
  /** Best-effort adapter description; often unavailable or generic. */
  description?: string;
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
  maxComputeInvocationsPerWorkgroup?: number;
}

export interface CapabilityReport {
  webgpu: boolean;
  webgl2: boolean;
  workers: boolean;
  indexeddb: boolean;
  level: 'supported' | 'partial' | 'unsupported';
  reason?: string;
  adapter?: AdapterReport;
  /** Non-fatal concerns worth showing before a large download. */
  warnings: string[];
}

export interface GpuBudgetInput {
  /** Size of the weight file in megabytes. */
  weightMb: number;
  /** True when the app also holds a WebGPU device for rendering. */
  rendererUsesWebGpu: boolean;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function isSafariLike(userAgent: string): boolean {
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|Edg/i.test(userAgent);
}

export async function detectCapabilities(): Promise<CapabilityReport> {
  const workers = typeof Worker !== 'undefined';
  const indexeddb = typeof indexedDB !== 'undefined';
  const webgl2 = (() => {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch {
      return false;
    }
  })();

  let webgpu = false;
  let adapter: AdapterReport | undefined;
  const warnings: string[] = [];

  if ('gpu' in navigator) {
    try {
      const gpu = (navigator as any).gpu;
      const found = await gpu.requestAdapter();
      webgpu = !!found;
      if (found) {
        const info = await found.requestAdapterInfo?.().catch(() => undefined);
        adapter = {
          description:
            info?.description ?? info?.device ?? info?.vendor ?? undefined,
          maxBufferSize: found.limits?.maxBufferSize,
          maxStorageBufferBindingSize: found.limits?.maxStorageBufferBindingSize,
          maxComputeInvocationsPerWorkgroup:
            found.limits?.maxComputeInvocationsPerWorkgroup,
        };
      }
    } catch {
      webgpu = false;
    }
  }

  let level: CapabilityReport['level'];
  let reason: string | undefined;

  if (webgpu && workers && indexeddb) {
    level = 'supported';
  } else if (webgl2 && workers && indexeddb) {
    level = 'partial';
    reason = webgpu
      ? 'Web Workers or storage are unavailable.'
      : 'WebGPU is unavailable. Rendering may work via WebGL2 fallback, but local AI inference requires WebGPU.';
  } else {
    level = 'unsupported';
    const missing: string[] = [];
    if (!webgl2 && !webgpu) missing.push('WebGPU/WebGL2');
    if (!workers) missing.push('Web Workers');
    if (!indexeddb) missing.push('IndexedDB');
    reason = `Missing required browser capabilities: ${missing.join(', ')}.`;
  }

  if (webgpu && isSafariLike(navigator.userAgent)) {
    warnings.push(
      'This looks like Safari. Its WebGPU implementation is newer and less tested than Chromium, and large models often fail there with an out-of-memory error. If that happens, try a smaller model or the CPU (WASM) backend.',
    );
  }

  return { webgpu, webgl2, workers, indexeddb, level, reason, adapter, warnings };
}

/**
 * Heuristic warning for a model that is likely to exhaust GPU memory.
 *
 * Not a guarantee — the real test is loading it — but it catches the obvious case
 * cheaply, before a multi-gigabyte download.
 */
export function gpuBudgetWarnings(
  capabilities: CapabilityReport,
  input: GpuBudgetInput,
): string[] {
  const warnings: string[] = [];
  const { adapter, webgpu } = capabilities;
  if (!webgpu || !adapter) return warnings;

  const weightBytes = input.weightMb * 1048576;

  if (adapter.maxBufferSize && weightBytes > adapter.maxBufferSize * 2) {
    warnings.push(
      `This adapter caps buffers at ${formatBytes(adapter.maxBufferSize)} and the model's weight file is ${input.weightMb} MB, so it may fail to allocate. A smaller model is more likely to load.`,
    );
  }

  if (adapter.maxStorageBufferBindingSize && weightBytes > adapter.maxStorageBufferBindingSize * 4) {
    warnings.push(
      `This adapter caps storage buffer bindings at ${formatBytes(adapter.maxStorageBufferBindingSize)}, which is small relative to a ${input.weightMb} MB model.`,
    );
  }

  if (input.rendererUsesWebGpu && input.weightMb > 512) {
    warnings.push(
      'The renderer holds its own WebGPU device while the model loads. If loading fails with an out-of-memory error, switching rendering to WebGL2 frees that memory.',
    );
  }

  return warnings;
}