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

    this.worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      this.handleWorkerMessage(event.data);
    };

    this.worker.onerror = (err) => {
      console.error('[AiWorkerClient] Worker error:', err);
      this.initPromise = null;
      if (this.initReject) {
        this.initReject(new Error(`Worker error: ${err.message}`));
        this.initReject = null;
        this.initResolve = null;
      }
    };

    this.initPromise = new Promise<ModelInfo>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
      this.send({ type: 'initialize', config: this.config });
    });

    try {
      return await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      throw err;
    }
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
          this.worker?.terminate();
          this.worker = null;
          resolve();
        }, 3000);

        const originalHandler = this.worker!.onmessage;
        this.worker!.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
          if (event.data.type === 'disposed') {
            clearTimeout(timeout);
            this.worker?.terminate();
            this.worker = null;
            resolve();
          } else if (originalHandler) {
            (originalHandler as any)(event);
          }
        };
      });
    }
    this.ready = false;
    this.modelInfo = null;
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
        this.progressCallback?.({
          phase: msg.phase,
          progress: msg.progress,
          message: msg.message,
        });
        break;

      case 'ready':
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
