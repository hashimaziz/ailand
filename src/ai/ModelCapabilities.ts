// ─── Browser Capability Detection ───

export interface CapabilityReport {
  webgpu: boolean;
  webgl2: boolean;
  workers: boolean;
  indexeddb: boolean;
  level: 'supported' | 'partial' | 'unsupported';
  reason?: string;
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
  if ('gpu' in navigator) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      webgpu = !!adapter;
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
    reason = 'WebGPU is unavailable. Rendering may work via WebGL2 fallback, but local AI inference requires WebGPU.';
  } else {
    level = 'unsupported';
    const missing: string[] = [];
    if (!webgl2 && !webgpu) missing.push('WebGPU/WebGL2');
    if (!workers) missing.push('Web Workers');
    if (!indexeddb) missing.push('IndexedDB');
    reason = `Missing required browser capabilities: ${missing.join(', ')}.`;
  }

  return { webgpu, webgl2, workers, indexeddb, level, reason };
}
