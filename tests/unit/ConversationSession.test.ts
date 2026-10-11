import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationManager } from '../../src/conversation/ConversationManager';
import { getModelConfig } from '../../src/ai/ModelConfig';
import { npcRegistry } from '../../src/npc/NpcRegistry';
import { fixtures } from '../../src/npc/fixtures';
import {
  ChatMessage,
  GenerationConfig,
  GenerationEvent,
  InitializeOptions,
  LanguageModel,
  ModelInfo,
} from '../../src/ai/LanguageModel';
import { ConversationPhase } from '../../src/conversation/ConversationTypes';

// jsdom has no IndexedDB. These boundaries are stubbed so this exercises session
// and turn logic rather than persistence.
vi.mock('../../src/memory/MemoryStore', () => ({
  memoryStore: {
    getMemories: async () => [],
    getActiveMemories: async () => [],
    save: async () => {},
  },
  applySupersession: (m: unknown[]) => m,
}));

vi.mock('../../src/npc/RelationshipStore', () => ({
  relationshipStore: {
    load: async () => ({
      familiarity: 0.15,
      trust: 0.24,
      affection: 0.2,
      tension: 0.05,
      labels: ['stranger'],
    }),
    save: async () => {},
  },
}));

vi.mock('../../src/memory/MemoryProcessor', () => ({
  MemoryProcessor: class {
    async process() {
      return { npcId: 'npc_1', proposals: [] };
    }
  },
}));

const NPC = fixtures[0];

/** A model whose generation completes only when the test says so. */
class ControllableModel implements LanguageModel {
  public emit: ((event: GenerationEvent) => void) | null = null;
  public currentRequestId = '';
  public release: (() => void) | null = null;
  /** Incremented each time generation starts; lets a test await the *next* call. */
  public generationCount = 0;
  public cancelled = false;
  public failNext = false;

  async initialize(_options?: InitializeOptions): Promise<ModelInfo> {
    return { id: 'fake', device: 'cpu', dtype: 'none', loadTimeMs: 0 };
  }

  async generate(
    requestId: string,
    _messages: ChatMessage[],
    _config: GenerationConfig,
    onEvent: (event: GenerationEvent) => void,
  ): Promise<void> {
    this.currentRequestId = requestId;
    this.emit = onEvent;
    this.release = null;
    this.generationCount++;
    onEvent({ type: 'started', requestId });

    if (this.failNext) {
      onEvent({ type: 'error', requestId, message: 'boom' });
      return;
    }
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  public complete(fullText: string): void {
    this.emit?.({ type: 'completed', requestId: this.currentRequestId, fullText });
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    // A real client delivers whatever it had streamed before settling.
    this.complete('partial answer');
  }

  async dispose(): Promise<void> {}
  isReady(): boolean {
    return true;
  }
}

describe('ConversationManager session handling', () => {
  let model: ControllableModel;
  let manager: ConversationManager;
  let phases: ConversationPhase[];
  let replies: string[];

  beforeEach(() => {
    for (const npc of fixtures) npcRegistry.register(npc);
    model = new ControllableModel();
    phases = [];
    replies = [];
    manager = new ConversationManager(
      model,
      getModelConfig(),
      () => 8 * 3600,
      () => '08:00',
      {
        onPhaseChange: (phase) => phases.push(phase),
        onStreamToken: () => {},
        onNpcReplyComplete: (text) => replies.push(text),
        onError: () => {},
      },
    );
    manager.openConversation(NPC.id);
  });

  function session(): any {
    return (manager as any).session;
  }

  /** Wait for the *next* model call to reach its await, deterministically. */
  async function waitForGeneration(): Promise<void> {
    const target = model.generationCount + 1;
    for (let i = 0; i < 500 && model.generationCount < target; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(model.generationCount).toBeGreaterThanOrEqual(target);
    expect(model.release).not.toBeNull();
  }

  it('keeps a bounded prompt window but a complete transcript', async () => {
    for (let i = 0; i < 7; i++) {
      const pending = manager.sendPlayerMessage(`Player turn ${i}`);
      await waitForGeneration();
      model.complete(`Reply ${i}`);
      model.release!();
      await pending;
    }

    // The prompt window stays small...
    expect(session().turns.length).toBeLessThanOrEqual(6);
    // ...but memory formation sees everything that was said.
    expect(session().transcript.length).toBe(14);
    expect(session().transcript[0].content).toBe('Player turn 0');
    expect(session().transcript[13].content).toBe('Reply 6');
  });

  it('refuses a second message while a reply is still generating', async () => {
    const first = manager.sendPlayerMessage('first');
    await waitForGeneration();

    // A second Enter press must not start a parallel generation.
    void manager.sendPlayerMessage('second');
    await Promise.resolve();
    expect(phases.filter((p) => p === 'generating')).toHaveLength(1);

    model.complete('done');
    model.release!();
    await first;
  });

  it('does not throw when the panel closes while context is being assembled', async () => {
    const pending = manager.sendPlayerMessage('hello');
    await waitForGeneration();

    manager.closeConversation();
    model.complete('never mind');
    model.release!();

    // Previously this threw on `this.session.turns` after the session was nulled.
    await expect(pending).resolves.toBeUndefined();
    expect(manager.isOpen()).toBe(false);
  });

  it('keeps a cancelled partial reply in the transcript', async () => {
    const pending = manager.sendPlayerMessage('start talking');
    await waitForGeneration();

    manager.closeConversation();
    model.release!();
    await pending;

    expect(model.cancelled).toBe(true);
    // The partial answer still reaches the transcript rather than vanishing.
    expect(replies).toContain('partial answer');
  });

  it('records the NPC reply in the transcript', async () => {
    const pending = manager.sendPlayerMessage('hello there');
    await waitForGeneration();
    model.complete('Morning! The usual?');
    model.release!();
    await pending;

    expect(session().transcript.map((t: any) => t.role)).toEqual(['player', 'npc']);
  });

  it('recovers a truthful phase after a generation error', async () => {
    model.failNext = true;
    await manager.sendPlayerMessage('this will fail');

    // The error must survive, not be overwritten by the finally block.
    expect(manager.getPhase()).toBe('error');
  });
});