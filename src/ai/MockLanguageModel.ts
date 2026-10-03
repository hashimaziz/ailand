// ─── Mock Language Model ───
// Used for testing and development without downloading a real model.
// Returns deterministic responses based on the NPC identity in the messages.

import {
  LanguageModel,
  ModelInfo,
  ChatMessage,
  GenerationConfig,
  GenerationEvent,
  InitializeOptions,
} from './LanguageModel';

function extractNpcName(messages: ChatMessage[]): string | null {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const match = system.match(/Your name is ([^\n.]+)/i);
  return match?.[1]?.trim() ?? null;
}

function extractLastUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content;
    }
  }
  return '';
}

function buildInCharacterReply(npcName: string | null, playerMessage: string): string {
  const name = npcName ?? 'Neighbor';
  const lower = playerMessage.toLowerCase();

  if (/hello|hi|hey|howdy/.test(lower)) {
    return `Hey! I'm ${name}. Good to see you out in the neighborhood.`;
  }
  if (/name|who are you/.test(lower)) {
    return `I'm ${name}. I live and work around here like everyone else.`;
  }
  if (/coffee|shop|park|apartment/.test(lower)) {
    return `This block's pretty quiet, but the coffee shop and park keep things lively. What brings you by?`;
  }
  if (playerMessage.endsWith('?')) {
    return `Hmm, good question. I'd say it depends — what do you think?`;
  }
  return `I hear you. As ${name}, I'll remember we talked about that.`;
}

export class MockLanguageModel implements LanguageModel {
  private ready = false;
  private cancelled = new Set<string>();
  private info: ModelInfo | null = null;

  async initialize(_options?: InitializeOptions): Promise<ModelInfo> {
    if (this.info) {
      this.ready = true;
      return this.info;
    }

    // Simulate a short loading delay
    await new Promise((r) => setTimeout(r, 100));
    this.ready = true;
    this.info = {
      id: 'mock-model',
      device: 'cpu',
      dtype: 'mock',
      loadTimeMs: 100,
    };
    return this.info;
  }

  async generate(
    requestId: string,
    messages: ChatMessage[],
    _config: GenerationConfig,
    onEvent: (event: GenerationEvent) => void,
  ): Promise<void> {
    if (!this.ready) {
      onEvent({ type: 'error', requestId, message: 'Model not initialized.' });
      return;
    }

    onEvent({ type: 'started', requestId });

    const npcName = extractNpcName(messages);
    const playerMessage = extractLastUserMessage(messages);
    const response = buildInCharacterReply(npcName, playerMessage);

    // Simulate streaming: emit word by word with a small delay
    const words = response.split(' ');
    const startTime = performance.now();
    let emitted = '';

    for (let i = 0; i < words.length; i++) {
      if (this.cancelled.has(requestId)) {
        this.cancelled.delete(requestId);
        // Keep whatever was already streamed so the transcript stays coherent.
        onEvent({ type: 'completed', requestId, fullText: emitted.trim() });
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
      const text = (i === 0 ? '' : ' ') + words[i];
      emitted += text;
      onEvent({ type: 'token', requestId, text });
    }

    if (this.cancelled.has(requestId)) {
      this.cancelled.delete(requestId);
      onEvent({ type: 'completed', requestId, fullText: emitted.trim() });
      return;
    }

    const totalMs = performance.now() - startTime;

    onEvent({
      type: 'completed',
      requestId,
      fullText: response,
      usage: {
        promptTokens: 50,
        completionTokens: words.length,
        totalTokens: 50 + words.length,
        firstTokenMs: 20,
        totalMs,
        tokensPerSecond: (words.length / totalMs) * 1000,
      },
    });
  }

  async cancel(requestId: string): Promise<void> {
    this.cancelled.add(requestId);
  }

  async dispose(): Promise<void> {
    this.ready = false;
    this.cancelled.clear();
    this.info = null;
  }

  isReady(): boolean {
    return this.ready;
  }

  getModelInfo(): ModelInfo | null {
    return this.info;
  }
}
