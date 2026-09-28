// ─── Worker Protocol ───
// Typed messages between the main thread and the AI Web Worker.
// Only the worker should import Transformers.js.

import { ModelConfig, ChatMessage, GenerationConfig, ModelInfo, GenerationUsage } from './LanguageModel';

// ─── Main → Worker messages ───

export interface WorkerInitMessage {
  type: 'initialize';
  config: ModelConfig;
}

export interface WorkerGenerateMessage {
  type: 'generate';
  requestId: string;
  messages: ChatMessage[];
  generation: GenerationConfig;
}

export interface WorkerCancelMessage {
  type: 'cancel';
  requestId: string;
}

export interface WorkerDisposeMessage {
  type: 'dispose';
}

export type WorkerInMessage =
  | WorkerInitMessage
  | WorkerGenerateMessage
  | WorkerCancelMessage
  | WorkerDisposeMessage;

// ─── Worker → Main messages ───

export interface WorkerReadyEvent {
  type: 'ready';
  model: ModelInfo;
}

export interface WorkerProgressEvent {
  type: 'progress';
  phase: 'download' | 'load' | 'initialize';
  progress?: number;
  message?: string;
}

export interface WorkerTokenEvent {
  type: 'token';
  requestId: string;
  text: string;
}

export interface WorkerCompletedEvent {
  type: 'completed';
  requestId: string;
  fullText: string;
  usage?: GenerationUsage;
}

export interface WorkerErrorEvent {
  type: 'error';
  requestId?: string;
  message: string;
}

export interface WorkerDisposedEvent {
  type: 'disposed';
}

export type WorkerOutMessage =
  | WorkerReadyEvent
  | WorkerProgressEvent
  | WorkerTokenEvent
  | WorkerCompletedEvent
  | WorkerErrorEvent
  | WorkerDisposedEvent;
