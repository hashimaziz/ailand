import { spawn, ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Manages a `llama-server` process on behalf of the browser.
 *
 * A page cannot spawn a process, so launching the local runtime has to happen in
 * the Node process that serves the app. This exposes it over a small HTTP API the
 * startup screen drives, and owns the lifecycle so the server dies with the dev
 * server instead of being orphaned.
 *
 * Endpoints (dev and preview only; never present in a static build):
 *   GET  /__llama/status  → current state
 *   POST /__llama/start   → { model?, port?, contextSize?, extraArgs? }
 *   POST /__llama/stop
 */

const API_PREFIX = '/__llama';
const DEFAULT_PORT = 8080;
const DEFAULT_CONTEXT = 4096;
const MAX_LOG_LINES = 12;

type State = 'stopped' | 'starting' | 'ready' | 'error';

interface ServerState {
  state: State;
  pid?: number;
  port: number;
  message?: string;
  log: string[];
}

export interface LlamaPluginOptions {
  /** Binary name or path. Defaults to `llama-server` on PATH. */
  bin?: string;
  /** Directory scanned for .gguf files when no model is configured. */
  modelsDir?: string;
}

export function llamaServerPlugin(options: LlamaPluginOptions = {}): Plugin {
  const bin = options.bin ?? process.env.AILAND_LLAMA_BIN ?? 'llama-server';
  const modelsDir = resolve(options.modelsDir ?? process.env.AILAND_LLAMA_MODELS_DIR ?? 'models');

  let child: ChildProcess | null = null;
  let state: ServerState = { state: 'stopped', port: DEFAULT_PORT, log: [] };
  let healthTimer: ReturnType<typeof setInterval> | null = null;

  const pushLog = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    state.log = [...state.log, trimmed].slice(-MAX_LOG_LINES);
  };

  const stopHealthPolling = () => {
    if (healthTimer !== null) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
  };

  const stop = () => {
    stopHealthPolling();
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      // Escalate if it ignores the polite request.
      setTimeout(() => {
        if (child && child.exitCode === null) child.kill('SIGKILL');
      }, 3000).unref?.();
    }
    child = null;
    state = { state: 'stopped', port: state.port, log: state.log };
  };

  /** Poll /health until the server answers or we give up. */
  const pollHealth = (port: number) => {
    stopHealthPolling();
    let attempts = 0;
    healthTimer = setInterval(async () => {
      attempts++;
      if (attempts > 120) {
        stopHealthPolling();
        state = { ...state, state: 'error', message: 'Server did not become ready in time.' };
        return;
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          stopHealthPolling();
          state = { ...state, state: 'ready', message: 'Server is ready.' };
        }
      } catch {
        // Not listening yet.
      }
    }, 500);
  };

  const start = (payload: {
    model?: string;
    port?: number;
    contextSize?: number;
    extraArgs?: string[];
  }) => {
    if (child && child.exitCode === null) {
      return { ...state, message: 'Already running.' };
    }

    const port = payload.port ?? state.port ?? DEFAULT_PORT;
    const model = resolveModel(payload.model as string | undefined);
    const contextSize = payload.contextSize ?? DEFAULT_CONTEXT;

    if (!model) {
      state = {
        state: 'error',
        port,
        log: state.log,
        message:
          `No GGUF model found. Put an instruct .gguf file in ${modelsDir}/, or set AILAND_LLAMA_MODEL.`,
      };
      return state;
    }
    if (!existsSync(model)) {
      state = { state: 'error', port, log: state.log, message: `Model not found: ${model}` };
      return state;
    }

    const args = [
      '-m', model,
      '--port', String(port),
      '--host', '127.0.0.1',
      '-c', String(contextSize),
      // -ngl is deliberately omitted: llama.cpp defaults it to `auto`, which
      // offloads as much as fits (Metal on macOS) and falls back to CPU when it
      // cannot. Hard-coding it to 0 forced CPU and roughly halved generation
      // speed. Set AILAND_LLAMA_NGL to override.
      ...(process.env.AILAND_LLAMA_NGL
        ? ['-ngl', process.env.AILAND_LLAMA_NGL]
        : []),
      ...(payload.extraArgs ?? []),
    ];

    pushLog(`$ ${bin} ${args.join(' ')}`);

    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      state = {
        state: 'error',
        port,
        log: state.log,
        message: `Could not launch ${bin}: ${err instanceof Error ? err.message : String(err)}`,
      };
      return state;
    }

    state = { state: 'starting', pid: child.pid, port, log: state.log };

    child.stdout?.on('data', (data) => {
      for (const line of String(data).split('\n')) pushLog(line);
    });
    child.stderr?.on('data', (data) => {
      for (const line of String(data).split('\n')) pushLog(line);
    });

    child.on('error', (err) => {
      stopHealthPolling();
      state = {
        ...state,
        state: 'error',
        message: `Could not launch ${bin}. Is llama.cpp installed and on PATH? (${err.message})`,
      };
    });

    child.on('exit', (code, signal) => {
      stopHealthPolling();
      child = null;
      state = {
        ...state,
        state: code === 0 ? 'stopped' : 'error',
        message: signal ? `Server stopped (${signal}).` : `Server exited with code ${code}.`,
      };
    });

    pollHealth(port);
    return state;
  };

  /**
   * Every GGUF file available, sorted.
   *
   * `readdirSync` order is filesystem-dependent, so taking the first entry made
   * the choice of model arbitrary once more than one was present. Sorting makes it
   * predictable and keeps the default from changing between machines.
   */
  const findModels = (): string[] => {
    if (!existsSync(modelsDir)) return [];
    return readdirSync(modelsDir)
      .filter((f) => f.toLowerCase().endsWith('.gguf'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((f) => join(modelsDir, f));
  };

  /** Accept a basename or an absolute path. */
  const resolveModel = (requested?: string): string | undefined => {
    if (!requested) {
      const fromEnv = process.env.AILAND_LLAMA_MODEL;
      if (fromEnv) return resolve(fromEnv);
      return findModels()[0];
    }
    if (existsSync(requested) && !requested.endsWith('/')) return resolve(requested);
    const match = findModels().find(
      (path) => path === requested || path.endsWith(`/${requested}`),
    );
    return match;
  };

  const handler = async (
    request: { url?: string; method?: string },
    response: {
      statusCode: number;
      setHeader: (k: string, v: string) => void;
      end: (body?: string) => void;
    },
    body: () => Promise<string>,
  ) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');

    if (request.method === 'GET') {
      const models = findModels();
      response.end(
        JSON.stringify({
          ...state,
          bin,
          modelsDir,
          availableModels: models.map((path) => path.slice(path.lastIndexOf('/') + 1)),
          defaultModel: resolveModel() ?? null,
        }),
      );
      return;
    }

    if (request.method === 'POST') {
      const raw = await body();
      let payload: Record<string, unknown> = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: 'invalid JSON body' }));
        return;
      }

      if (request.url?.endsWith('/stop')) {
        stop();
      } else {
        start({
          model: payload.model as string | undefined,
          port: payload.port as number | undefined,
          contextSize: payload.contextSize as number | undefined,
          extraArgs: payload.extraArgs as string[] | undefined,
        });
      }
      response.end(JSON.stringify(state));
      return;
    }

    response.statusCode = 405;
    response.end(JSON.stringify({ error: 'method not allowed' }));
  };

  return {
    name: 'ailand-llama-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(API_PREFIX)) return next();

        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));

        request.on('end', () => {
          void handler(
            request,
            response as never,
            async () => Buffer.concat(chunks).toString('utf8'),
          );
        });
      });

      const cleanup = () => stop();
      server.httpServer?.on('close', cleanup);
      process.once('exit', cleanup);
      process.once('SIGINT', cleanup);
      process.once('SIGTERM', cleanup);
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(API_PREFIX)) return next();
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          void handler(request, response as never, async () =>
            Buffer.concat(chunks).toString('utf8'),
          );
        });
      });
      server.httpServer?.on('close', () => stop());
    },
  };
}