// ─── llama.cpp Server Launcher ───
//
// Starts and watches the `llama-server` process on behalf of the startup screen.
//
// A page cannot spawn a process, so the dev server exposes a small API for it
// (see `vite/llamaServerPlugin.ts`). When that API is absent — a static build, or
// any deployment without a Node process — the launcher reports itself unsupported
// and the app falls back to expecting an already-running server.

export type LauncherState = 'stopped' | 'starting' | 'ready' | 'error' | 'unsupported';

export interface LauncherStatus {
  state: LauncherState;
  pid?: number;
  port: number;
  message?: string;
  log: string[];
  bin?: string;
  modelsDir?: string;
  defaultModel?: string | null;
}

export interface StartOptions {
  model?: string;
  port?: number;
  contextSize?: number;
}

const ENDPOINT = '/__llama';

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export class LlamaLauncher {
  constructor(private baseUrl = '') {}

  private url(path: string): string {
    return `${this.baseUrl}${ENDPOINT}${path}`;
  }

  /** Is the dev-server API present? Cheap enough to call on every page load. */
  public async isSupported(): Promise<boolean> {
    if (typeof fetch !== 'function') return false;
    try {
      const response = await fetch(this.url('/status'), { signal: AbortSignal.timeout(1500) });
      return response.ok;
    } catch {
      return false;
    }
  }

  public async status(): Promise<LauncherStatus | null> {
    try {
      const response = await fetch(this.url('/status'), { signal: AbortSignal.timeout(3000) });
      return await readJson<LauncherStatus>(response);
    } catch {
      return null;
    }
  }

  public async start(options: StartOptions = {}): Promise<LauncherStatus | null> {
    try {
      const response = await fetch(this.url('/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      });
      return await readJson<LauncherStatus>(response);
    } catch {
      return null;
    }
  }

  public async stop(): Promise<LauncherStatus | null> {
    try {
      const response = await fetch(this.url('/stop'), { method: 'POST' });
      return await readJson<LauncherStatus>(response);
    } catch {
      return null;
    }
  }

  /**
   * Ensure a server is ready, starting one if the launcher supports it.
   *
   * `onStatus` receives every observed state so the caller can narrate progress
   * instead of showing an indefinite spinner. Returns null when nothing can be
   * started and none is running, which the caller must treat as a failure rather
   * than silently continuing.
   */
  public async ensureRunning(
    url: string,
    options: StartOptions,
    onStatus: (status: LauncherStatus) => void,
    isCancelled: () => boolean = () => false,
  ): Promise<LauncherStatus | null> {
    const supported = await this.isSupported();
    if (!supported) {
      return null;
    }

    let status = await this.status();
    if (status) onStatus({ ...status, state: status.state === 'ready' ? 'ready' : 'starting' });

    if (status?.state !== 'ready') {
      const port = options.port ?? portFromUrl(url);
      status = await this.start({ ...options, port });
      if (status) onStatus(status);
    }

    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (isCancelled()) return null;
      const current = await this.status();
      if (!current) return null;
      onStatus(current);
      if (current.state === 'ready') return current;
      if (current.state === 'error') return current;
      await delay(400);
    }

    return { state: 'error', port: options.port ?? 0, log: [], message: 'Timed out waiting for the server.' };
  }
}

export function portFromUrl(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return undefined;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}