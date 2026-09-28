// ─── AI Web Worker ───
// This file runs inside a dedicated Web Worker.
// It is the ONLY place in the codebase that imports @huggingface/transformers.
// The main thread communicates via typed postMessage (see WorkerProtocol.ts).

import type {
  WorkerInMessage,
  WorkerOutMessage,
  WorkerGenerateMessage,
} from './WorkerProtocol';
import type { ModelConfig } from './LanguageModel';

// We dynamically import @huggingface/transformers so the worker can be
// bundled by Vite as a module worker without pulling the lib into main.
let pipeline: any = null;
let generator: any = null;


// Track active generation for cancellation
let cancelledRequests = new Set<string>();

function post(msg: WorkerOutMessage) {
  self.postMessage(msg);
}

async function handleInit(config: ModelConfig) {
  const startTime = performance.now();
  try {
    post({ type: 'progress', phase: 'download', message: `Downloading ${config.id}...` });

    const transformers = await import('@huggingface/transformers');
    pipeline = transformers.pipeline;

    post({ type: 'progress', phase: 'load', progress: 0, message: 'Loading model...' });

    generator = await pipeline('text-generation', config.id, {
      device: config.device,
      dtype: config.dtype ?? undefined,
      progress_callback: (event: any) => {
        if (event.status === 'progress' && typeof event.progress === 'number') {
          post({
            type: 'progress',
            phase: 'download',
            progress: event.progress / 100,
            message: event.file ? `Downloading ${event.file}` : undefined,
          });
        }
      },
    });


    const loadTimeMs = performance.now() - startTime;

    post({
      type: 'progress',
      phase: 'initialize',
      progress: 1,
      message: 'Model ready.',
    });

    post({
      type: 'ready',
      model: {
        id: config.id,
        device: config.device,
        dtype: config.dtype ?? 'default',
        loadTimeMs,
      },
    });
  } catch (err: any) {
    post({ type: 'error', message: `Model initialization failed: ${err?.message ?? err}` });
  }
}

async function handleGenerate(msg: WorkerGenerateMessage) {
  if (!generator) {
    post({ type: 'error', requestId: msg.requestId, message: 'Model not initialized.' });
    return;
  }

  const startTime = performance.now();
  let firstTokenTime: number | null = null;
  let tokenCount = 0;
  let fullText = '';

  try {
    post({ type: 'token', requestId: msg.requestId, text: '' }); // signal started

    // Build generation kwargs
    const genKwargs: any = {
      max_new_tokens: msg.generation.maxNewTokens,
      do_sample: msg.generation.doSample,
      return_full_text: false,
    };

    if (msg.generation.doSample) {
      genKwargs.temperature = msg.generation.temperature;
      genKwargs.top_p = msg.generation.topP;
      genKwargs.top_k = msg.generation.topK;
    }

    // Use a callback streamer to emit tokens
    const transformers = await import('@huggingface/transformers');
    const streamer = new transformers.TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        if (cancelledRequests.has(msg.requestId)) return;
        if (firstTokenTime === null) {
          firstTokenTime = performance.now();
        }
        tokenCount++;
        fullText += text;
        post({ type: 'token', requestId: msg.requestId, text });
      },
    });

    genKwargs.streamer = streamer;

    // Run generation
    await generator(msg.messages, genKwargs);

    if (cancelledRequests.has(msg.requestId)) {
      cancelledRequests.delete(msg.requestId);
      return; // silently drop cancelled requests
    }

    const totalMs = performance.now() - startTime;
    const firstTokenMs = firstTokenTime ? firstTokenTime - startTime : totalMs;

    post({
      type: 'completed',
      requestId: msg.requestId,
      fullText,
      usage: {
        promptTokens: 0, // not easily available without tokenizer counting
        completionTokens: tokenCount,
        totalTokens: tokenCount,
        firstTokenMs,
        totalMs,
        tokensPerSecond: tokenCount > 0 ? (tokenCount / totalMs) * 1000 : 0,
      },
    });
  } catch (err: any) {
    if (!cancelledRequests.has(msg.requestId)) {
      post({ type: 'error', requestId: msg.requestId, message: `Generation failed: ${err?.message ?? err}` });
    }
    cancelledRequests.delete(msg.requestId);
  }
}

function handleCancel(requestId: string) {
  cancelledRequests.add(requestId);
}

async function handleDispose() {
  if (generator && typeof generator.dispose === 'function') {
    await generator.dispose();
  }
  generator = null;
  pipeline = null;

  post({ type: 'disposed' });
}

// ─── Message Handler ───

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'initialize':
      await handleInit(msg.config);
      break;
    case 'generate':
      await handleGenerate(msg);
      break;
    case 'cancel':
      handleCancel(msg.requestId);
      break;
    case 'dispose':
      await handleDispose();
      break;
  }
};
