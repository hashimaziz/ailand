// ─── Local llama.cpp Server Backend ───
//
// A second implementation of the LanguageModel contract, talking to a
// `llama-server` running on the user's own machine.
//
// Why this exists: browser WebGPU inference is capped by GPU memory, and the
// capable small models do not fit on the machines that struggle. A local server
// has no such ceiling — it runs on CPU via mmap, holds a 3B-class model, and does
// not contend with the browser's own GPU device. It also supports
// schema-constrained decoding, which makes structured memory extraction reliable
// instead of hopeful.
//
// The app treats this as optional. If no server is listening, the browser runtime
// is used instead, so the project keeps working with zero setup.

import {
  ChatMessage,
  GenerationConfig,
  GenerationEvent,
  InitializeOptions,
  LanguageModel,
  ModelInfo,
} from './LanguageModel';
import { ThinkingFilter } from './ThinkingFilter';

export const DEFAULT_LLAMA_SERVER_URL = 'http://127.0.0.1:8080';

export interface LlamaServerOptions {
  url?: string;
  requestTimeoutMs?: number;
}

/**
 * An abort signal that fires after `ms`.
 *
 * `AbortSignal.timeout` is not available everywhere — notably older Safari — so
 * fall back to a controller rather than throwing on a missing global.
 */
export function timeoutSignal(ms: number): { signal: AbortSignal; done: () => void } {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(ms), done: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

// ─── Streaming decode ──────────────────────────────────────────────

export type SseEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; usage?: { promptTokens?: number; completionTokens?: number; predictedMs?: number; promptMs?: number } }
  | { type: 'error'; message: string };

/**
 * Incremental decoder for llama.cpp's OpenAI-compatible SSE stream.
 *
 * Separated from the transport so it can be tested without a server: chunk
 * boundaries fall anywhere, including mid-JSON and mid-`data:` prefix.
 */
export class LlamaStreamDecoder {
  private buffer = '';
  private finished = false;

  /** Feed a raw chunk, returning whatever complete events it completed. */
  public push(chunk: string): SseEvent[] {
    if (this.finished) return [];
    this.buffer += chunk;
    const events: SseEvent[] = [];

    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          this.finished = true;
          events.push({ type: 'done' });
          return events;
        }
        if (payload) {
          const parsed = this.parsePayload(payload);
          if (parsed) events.push(...parsed);
        }
      }
      // Comment lines (`: keep-alive`) and unknown fields are ignored.

      newlineIndex = this.buffer.indexOf('\n');
    }

    return events;
  }

  /** Flush any trailing event that arrived without a newline. */
  public flush(): SseEvent[] {
    if (this.finished) return [];
    const rest = this.buffer.trim();
    this.buffer = '';
    this.finished = true;
    if (!rest.startsWith('data:')) return [];
    const payload = rest.slice(5).trim();
    if (payload === '[DONE]') return [{ type: 'done' }];
    const parsed = this.parsePayload(payload);
    return parsed ?? [{ type: 'done' }];
  }

  public get isFinished(): boolean {
    return this.finished;
  }

  private parsePayload(payload: string): SseEvent[] | null {
    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      // A truncated or malformed frame is not worth failing the whole turn over;
      // the stream either recovers or the stall timeout reports the problem.
      return null;
    }

    if (json?.error) {
      const message =
        typeof json.error === 'string' ? json.error : (json.error?.message ?? 'Unknown error');
      return [{ type: 'error', message }];
    }

    const events: SseEvent[] = [];
    const delta = json?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) {
      events.push({ type: 'delta', text: delta });
    }

    const timings = json?.timings;
    if (timings) {
      const completionTokens = timings.predicted_n;
      const predictedMs = timings.predicted_ms;
      events.push({
        type: 'done',
        usage: {
          promptTokens: timings.prompt_n,
          completionTokens,
          predictedMs,
          promptMs: timings.prompt_ms,
        },
      });
    }

    return events;
  }
}

// ─── Transport ─────────────────────────────────────────────────────

export class LlamaServerLanguageModel implements LanguageModel {
  private info: ModelInfo | null = null;
  private ready = false;
  private readonly url: string;

  constructor(options: LlamaServerOptions = {}) {
    this.url = (options.url ?? DEFAULT_LLAMA_SERVER_URL).replace(/\/+$/, '');
  }

  public get serverUrl(): string {
    return this.url;
  }

  /** True when a llama-server is listening. Never throws. */
  public static async isAvailable(url = DEFAULT_LLAMA_SERVER_URL): Promise<boolean> {
    const timeout = timeoutSignal(1500);
    try {
      const response = await fetch(`${url.replace(/\/+$/, '')}/health`, {
        signal: timeout.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      timeout.done();
    }
  }

  async initialize(_options?: InitializeOptions): Promise<ModelInfo> {
    const base = this.url.replace(/\/+$/, '');
    const health = timeoutSignal(5000);
    const response = await fetch(`${base}/health`, { signal: health.signal });
    health.done();
    if (!response.ok) {
      throw new Error(`No llama.cpp server responded at ${base} (HTTP ${response.status}).`);
    }

    let id = 'local-llama';
    try {
      const listTimeout = timeoutSignal(5000);
      const models = await fetch(`${base}/v1/models`, { signal: listTimeout.signal });
      listTimeout.done();
      const body = await models.json();
      // llama-server returns {"models":[{"name":...}]}; the OpenAI-compatible
      // shape would be {"data":[{"id":...}]}. Accept either.
      const first = body?.models?.[0] ?? body?.data?.[0];
      id = first?.name ?? first?.id ?? first?.model ?? id;
    } catch {
      // The server is up; not being able to list models is not fatal.
    }

    // "cpu" would be a lie: llama.cpp offloads to Metal by default and decides
    // for itself. The runtime is local either way.
    this.info = { id, device: 'local', dtype: 'gguf', loadTimeMs: 0 };
    this.ready = true;
    return this.info;
  }

  async generate(
    requestId: string,
    messages: ChatMessage[],
    config: GenerationConfig,
    onEvent: (event: GenerationEvent) => void,
  ): Promise<void> {
    if (!this.ready) {
      onEvent({ type: 'error', requestId, message: 'llama.cpp server not initialized.' });
      return;
    }

    const controller = new AbortController();
    this.abortControllers.set(requestId, controller);
    const thinking = new ThinkingFilter();
    const started = performance.now();
    let firstTokenMs = 0;
    let full = '';
    const decoder = new LlamaStreamDecoder();

    onEvent({ type: 'started', requestId });

    const body: Record<string, unknown> = {
      messages,
      stream: true,
      n_predict: config.maxNewTokens,
      temperature: config.temperature,
      top_p: config.topP,
      top_k: config.topK,
      // Qwen-family templates emit reasoning unless told otherwise; it costs
      // latency and the filter would only be discarding it afterwards.
      chat_template_kwargs: { enable_thinking: false },
    };

    if (config.jsonSchema) {
      body.response_format = { type: 'json_object', schema: config.jsonSchema };
    }

    const emit = (text: string) => {
      if (!text) return;
      if (firstTokenMs === 0) firstTokenMs = performance.now() - started;
      full += text;
      onEvent({ type: 'token', requestId, text });
    };

    try {
      const response = await fetch(`${this.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => '');
        onEvent({
          type: 'error',
          requestId,
          message: `llama.cpp server returned HTTP ${response.status}. ${detail.slice(0, 200)}`,
        });
        return;
      }

      const reader = response.body.getReader();
      const decoderUtf8 = new TextDecoder();
      let usage: { completionTokens?: number; promptTokens?: number; predictedMs?: number } = {};

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        for (const event of decoder.push(decoderUtf8.decode(value, { stream: true }))) {
          if (event.type === 'delta') emit(thinking.push(event.text));
          else if (event.type === 'error') {
            onEvent({ type: 'error', requestId, message: event.message });
            return;
          } else if (event.usage) {
            usage = event.usage;
          }
        }
      }

      for (const event of decoder.flush()) {
        if (event.type === 'delta') emit(thinking.push(event.text));
        else if (event.type === 'done' && event.usage) usage = event.usage;
      }
      emit(thinking.flush());

      if (!full.trim()) {
        onEvent({
          type: 'error',
          requestId,
          message: 'The llama.cpp server returned no text for this request.',
        });
        return;
      }

      const totalMs = performance.now() - started;
      onEvent({
        type: 'completed',
        requestId,
        fullText: full,
        usage: {
          promptTokens: usage.promptTokens ?? 0,
          completionTokens: usage.completionTokens ?? 0,
          totalTokens: (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
          firstTokenMs: firstTokenMs || totalMs,
          totalMs,
          tokensPerSecond:
            usage.completionTokens && usage.predictedMs
              ? (usage.completionTokens / usage.predictedMs) * 1000
              : 0,
        },
      });
    } catch (err) {
      if (controller.signal.aborted) return; // cancelled; the caller settled it
      onEvent({
        type: 'error',
        requestId,
        message: err instanceof Error ? err.message : 'llama.cpp request failed',
      });
    } finally {
      this.abortControllers.delete(requestId);
    }
  }

  private abortControllers = new Map<string, AbortController>();

  async cancel(requestId: string): Promise<void> {
    this.abortControllers.get(requestId)?.abort();
  }

  async dispose(): Promise<void> {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
    this.ready = false;
    this.info = null;
  }

  isReady(): boolean {
    return this.ready;
  }

  getModelInfo(): ModelInfo | null {
    return this.info;
  }
}