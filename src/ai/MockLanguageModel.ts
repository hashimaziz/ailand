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

const MOCK_RESPONSES: Record<string, string[]> = {
  default: [
    "Hey there! Nice to see someone around the neighborhood.",
    "Oh, hello. Can I help you with something?",
    "Good to see you. How's your day going?",
  ],
};

export class MockLanguageModel implements LanguageModel {
  private ready = false;
  private responseIndex = 0;

  async initialize(_options?: InitializeOptions): Promise<ModelInfo> {
    // Simulate a short loading delay
    await new Promise((r) => setTimeout(r, 100));
    this.ready = true;
    return {
      id: 'mock-model',
      device: 'cpu',
      dtype: 'mock',
      loadTimeMs: 100,
    };
  }

  async generate(
    requestId: string,
    _messages: ChatMessage[],
    _config: GenerationConfig,
    onEvent: (event: GenerationEvent) => void,
  ): Promise<void> {
    if (!this.ready) {
      onEvent({ type: 'error', requestId, message: 'Model not initialized.' });
      return;
    }

    onEvent({ type: 'started', requestId });

    const responses = MOCK_RESPONSES.default;
    const response = responses[this.responseIndex % responses.length];
    this.responseIndex++;

    // Simulate streaming: emit word by word with a small delay
    const words = response.split(' ');
    const startTime = performance.now();

    for (let i = 0; i < words.length; i++) {
      await new Promise((r) => setTimeout(r, 20));
      const text = (i === 0 ? '' : ' ') + words[i];
      onEvent({ type: 'token', requestId, text });
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

  async cancel(_requestId: string): Promise<void> {
    // Mock: nothing to cancel
  }

  async dispose(): Promise<void> {
    this.ready = false;
  }

  isReady(): boolean {
    return this.ready;
  }
}
