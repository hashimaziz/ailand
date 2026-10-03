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

const EXTRACTION_MARKER = 'Reply with one JSON object';

function extractCharacterName(messages: ChatMessage[]): string {
  const user = messages.find((m) => m.role === 'user')?.content ?? '';
  const match = user.match(/^CHARACTER:\s*([^,\n]+)/);
  return match?.[1]?.trim() ?? 'the neighbour';
}

function isExtractionRequest(messages: ChatMessage[]): boolean {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  return system.includes(EXTRACTION_MARKER);
}

/**
 * Deterministic stand-in for structured memory extraction.
 *
 * The prototype's whole point is that an NPC remembers you across visits, so the
 * offline mock has to produce a usable extraction envelope rather than nothing.
 * It proposes the player's own statements, which are the safest thing to persist.
 */
function buildExtractionReply(messages: ChatMessage[]): string {
  const user = messages.find((m) => m.role === 'user')?.content ?? '';
  const npcName = extractCharacterName(messages);

  const transcript = user.split('CONVERSATION:')[1]?.split('JSON:')[0] ?? '';
  const playerLines = transcript
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(`${npcName}:`))
    .map((line) => line.replace(/^[^:]+:\s*/, ''));

  const memories: unknown[] = [];

  const nameStatement = playerLines.find((line) => /my name is/i.test(line));
  if (nameStatement) {
    const name = nameStatement.match(/my name is\s+([^\s,.!?]+)/i)?.[1];
    memories.push({
      type: 'episodic',
      content: name
        ? `The player introduced themselves as ${name}.`
        : 'The player said their name.',
      importance: 0.8,
      confidence: 0.95,
      source: 'player',
      entities: ['player', ...(name ? [name.toLowerCase()] : [])],
    });
  }

  const substantive = [...playerLines]
    .filter((line) => line.length >= 24 && !/my name is/i.test(line))
    .sort((a, b) => b.length - a.length)[0];
  if (substantive) {
    memories.push({
      type: 'episodic',
      content: `The player told ${npcName}: "${substantive}"`,
      importance: 0.55,
      confidence: 0.9,
      source: 'player',
      entities: ['player', npcName.toLowerCase()],
    });
  }

  return JSON.stringify({
    memories,
    relationship_updates: memories.length
      ? [
          {
            delta: { familiarity: 0.05, trust: 0.03, affection: 0.02, tension: 0 },
            labels: ['acquaintance'],
            reason: 'met and had a real exchange',
          },
        ]
      : [],
  });
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

    const response = isExtractionRequest(messages)
      ? buildExtractionReply(messages)
      : buildInCharacterReply(extractNpcName(messages), extractLastUserMessage(messages));

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
