// ─── AiWorkerClient ───
// Main-thread client that communicates with the AI Web Worker via postMessage.
// Implements the LanguageModel interface.

import {
  LanguageModel,
  ModelInfo,
  ChatMessage,
  GenerationConfig,
  GenerationEvent,
  InitializeOptions,
  ModelConfig,
} from './LanguageModel';
import type { WorkerInMessage, WorkerOutMessage } from './WorkerProtocol';

/**
 * How long the worker may report nothing before the load is considered failed.
 * Long enough to tolerate a slow connection or a silent WebGPU graph compile.
 */
const STALL_TIMEOUT_MS = 120_000;

export class AiWorkerClient implements LanguageModel {
  private worker: Worker | null = null;
  private modelInfo: ModelInfo | null = null;
  private ready = false;

  // Pending event handlers keyed by requestId
  private pendingCallbacks = new Map<string, (event: GenerationEvent) => void>();
  private pendingResolves = new Map<string, () => void>();
  private pendingRejects = new Map<string, (err: Error) => void>();
  private partialTexts = new Map<string, string>();

  // For initialize promise
  private initResolve: ((info: ModelInfo) => void) | null = null;
  private initReject: ((err: Error) => void) | null = null;
  private initPromise: Promise<ModelInfo> | null = null;
  private progressCallback: ((event: any) => void) | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivityAt = 0;
  private downloadComplete = false;

  constructor(private config: ModelConfig) {}

  async initialize(options?: InitializeOptions): Promise<ModelInfo> {
    if (options?.onProgress) {
      this.progressCallback = options.onProgress;
    }

    if (this.ready && this.modelInfo) {
      return this.modelInfo;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    // Create the worker using Vite's worker import pattern
    this.worker = new Worker(
      new URL('./worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.downloadComplete = false;
    this.lastActivityAt = performance.now();

    this.worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      this.lastActivityAt = performance.now();
      this.handleWorkerMessage(event.data);
    };

    this.worker.onerror = (err) => {
      console.error('[AiWorkerClient] Worker error:', err);
      this.clearStallTimer();
      this.initPromise = null;
      if (this.initReject) {
        this.initReject(new Error(`Worker error: ${err.message}`));
        this.initReject = null;
        this.initResolve = null;
      }
    };

    this.armStallTimer();

    this.initPromise = new Promise<ModelInfo>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
      this.send({ type: 'initialize', config: this.config });
    });

    try {
      return await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      this.clearStallTimer();
      throw err;
    }
  }

  /**
   * Fail loudly instead of waiting forever.
   *
   * A download that stalls, or a WebGPU initialisation that never completes,
   * used to leave the UI showing "Loading AI" indefinitely with no way out. The
   * allowance is generous once the weights have arrived, because graph
   * compilation is genuinely slow and silent.
   */
  private armStallTimer(): void {
    this.clearStallTimer();
    this.stallTimer = setTimeout(() => {
      if (this.ready) return;
      const seconds = Math.round((performance.now() - this.lastActivityAt) / 1000);
      const message = this.downloadComplete
        ? `Model initialisation stalled after ${seconds}s. The browser may have run out of GPU memory.`
        : `Model download stalled after ${seconds}s. Check your connection and try again.`;
      console.error('[AiWorkerClient]', message);
      this.terminate();
      this.initPromise = null;
      this.initReject?.(new Error(message));
      this.initReject = null;
      this.initResolve = null;
    }, STALL_TIMEOUT_MS);
  }

  private clearStallTimer(): void {
    if (this.stallTimer !== null) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  /** Kill the worker and reset state so a later initialize() starts clean. */
  private terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.modelInfo = null;
    this.clearStallTimer();
  }

  async generate(
    requestId: string,
    messages: ChatMessage[],
    config: GenerationConfig,
    onEvent: (event: GenerationEvent) => void,
  ): Promise<void> {
    if (!this.ready || !this.worker) {
      onEvent({ type: 'error', requestId, message: 'Model not initialized.' });
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.pendingCallbacks.set(requestId, onEvent);
      this.pendingResolves.set(requestId, resolve);
      this.pendingRejects.set(requestId, reject);

      onEvent({ type: 'started', requestId });

      this.send({
        type: 'generate',
        requestId,
        messages,
        generation: config,
      });
    });
  }

  async cancel(requestId: string): Promise<void> {
    this.send({ type: 'cancel', requestId });

    // The worker drops cancelled generations without emitting a terminal event,
    // so settle the pending request here and commit whatever was streamed so far.
    const partial = this.partialTexts.get(requestId);
    if (partial !== undefined) {
      const cb = this.pendingCallbacks.get(requestId);
      const resolve = this.pendingResolves.get(requestId);
      this.cleanupRequest(requestId);
      cb?.({ type: 'completed', requestId, fullText: partial });
      resolve?.();
      return;
    }

    const resolve = this.pendingResolves.get(requestId);
    this.cleanupRequest(requestId);
    resolve?.();
  }

  async dispose(): Promise<void> {
    for (const requestId of Array.from(this.pendingResolves.keys())) {
      this.pendingRejects.get(requestId)?.(new Error('Model was disposed.'));
      this.cleanupRequest(requestId);
    }

    if (this.worker) {
      this.send({ type: 'dispose' });
      // Give the worker a moment, then terminate
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.terminate();
          resolve();
        }, 3000);

        const originalHandler = this.worker!.onmessage;
        this.worker!.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
          if (event.data.type === 'disposed') {
            clearTimeout(timeout);
            this.terminate();
            resolve();
          } else if (originalHandler) {
            (originalHandler as any)(event);
          }
        };
      });
    }
    this.terminate();
    this.initPromise = null;
    this.initResolve = null;
    this.initReject = null;
  }

  isReady(): boolean {
    return this.ready;
  }

  getModelInfo(): ModelInfo | null {
    return this.modelInfo;
  }

  // ─── Private ───

  private send(msg: WorkerInMessage) {
    this.worker?.postMessage(msg);
  }

  private handleWorkerMessage(msg: WorkerOutMessage) {
    switch (msg.type) {
      case 'progress':
        if (msg.phase === 'initialize') {
          this.downloadComplete = true;
        }
        this.progressCallback?.({
          phase: msg.phase,
          progress: msg.progress,
          message: msg.message,
          loadedBytes: msg.loadedBytes,
          totalBytes: msg.totalBytes,
          file: msg.file,
        });
        break;

      case 'ready':
        this.clearStallTimer();
        this.modelInfo = msg.model;
        this.ready = true;
        if (this.initResolve) {
          this.initResolve(msg.model);
          this.initResolve = null;
          this.initReject = null;
        }
        break;

      case 'token': {
        if (msg.text) {
          this.partialTexts.set(msg.requestId, (this.partialTexts.get(msg.requestId) ?? '') + msg.text);
        }
        const cb = this.pendingCallbacks.get(msg.requestId);
        cb?.({ type: 'token', requestId: msg.requestId, text: msg.text });
        break;
      }

      case 'completed': {
        const cb = this.pendingCallbacks.get(msg.requestId);
        cb?.({
          type: 'completed',
          requestId: msg.requestId,
          fullText: msg.fullText,
          usage: msg.usage,
        });
        const resolve = this.pendingResolves.get(msg.requestId);
        resolve?.();
        this.cleanupRequest(msg.requestId);
        break;
      }

      case 'error': {
        if (msg.requestId) {
          const cb = this.pendingCallbacks.get(msg.requestId);
          cb?.({ type: 'error', requestId: msg.requestId, message: msg.message });
          const reject = this.pendingRejects.get(msg.requestId);
          reject?.(new Error(msg.message));
          this.cleanupRequest(msg.requestId);
        } else {
          // Initialization error
          console.error('[AiWorkerClient] Worker error:', msg.message);
          if (this.initReject) {
            this.initReject(new Error(msg.message));
            this.initReject = null;
            this.initResolve = null;
          }
        }
        break;
      }
    }
  }

  private cleanupRequest(requestId: string) {
    this.pendingCallbacks.delete(requestId);
    this.pendingResolves.delete(requestId);
    this.pendingRejects.delete(requestId);
    this.partialTexts.delete(requestId);
  }
}
