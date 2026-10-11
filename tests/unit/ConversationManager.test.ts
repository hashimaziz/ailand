import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationManager } from '../../src/conversation/ConversationManager';
import { getModelConfig } from '../../src/ai/ModelConfig';
import { npcRegistry } from '../../src/npc/NpcRegistry';
import { fixtures } from '../../src/npc/fixtures';
import {
  ChatMessage,
  GenerationConfig,
  GenerationEvent,
  LanguageModel,
  ModelInfo,
} from '../../src/ai/LanguageModel';
import { ConversationPhase } from '../../src/conversation/ConversationTypes';

const REPLY = 'Morning! The usual?';

class FakeModel implements LanguageModel {
  public ready = true;
  public initCalls = 0;

  constructor(private reply: string = REPLY) {}

  async initialize(): Promise<ModelInfo> {
    this.initCalls++;
    this.ready = true;
    return { id: 'fake', device: 'cpu', dtype: 'none', loadTimeMs: 0 };
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
    onEvent({ type: 'token', requestId, text: this.reply });
    onEvent({ type: 'completed', requestId, fullText: this.reply });
  }

  async cancel(): Promise<void> {}
  async dispose(): Promise<void> {
    this.ready = false;
  }
  isReady(): boolean {
    return this.ready;
  }
}

function build(model: LanguageModel, phases: ConversationPhase[]) {
  return new ConversationManager(
    model,
    getModelConfig(),
    () => 8 * 3600,
    () => '08:00',
    {
      onPhaseChange: (phase) => phases.push(phase),
      onStreamToken: () => {},
      onNpcReplyComplete: () => {},
      onError: () => {},
    },
  );
}

describe('ConversationManager readiness', () => {
  beforeEach(() => {
    for (const npc of fixtures) npcRegistry.register(npc);
  });

  it('opens in the ready phase when the model is already loaded', () => {
    // Regression: a cached `modelReady` flag defaulted to false, so a model the
    // startup flow had already loaded still opened in 'loading_model'. The player
    // saw "Loading AI" while talking to a perfectly working model.
    const model = new FakeModel();
    expect(model.isReady()).toBe(true);

    const phases: ConversationPhase[] = [];
    const manager = build(model, phases);

    expect(manager.openConversation(fixtures[0].id)).toBe(true);
    expect(manager.getPhase()).toBe('ready');
    expect(phases).not.toContain('loading_model');
  });

  it('never reports ready for a model that has not loaded', () => {
    const model = new FakeModel();
    model.ready = false;

    const phases: ConversationPhase[] = [];
    const manager = build(model, phases);
    manager.openConversation(fixtures[0].id);

    expect(manager.getPhase()).toBe('loading_model');
  });

  it('tracks readiness after loading, without a separate flag to drift', async () => {
    const model = new FakeModel();
    model.ready = false;

    const phases: ConversationPhase[] = [];
    const manager = build(model, phases);
    manager.openConversation(fixtures[0].id);
    expect(manager.getPhase()).toBe('loading_model');

    expect(await manager.ensureModelReady()).toBe(true);
    expect(manager.getPhase()).toBe('ready');
  });

  it('returns to a truthful phase after closing', () => {
    const model = new FakeModel();
    const manager = build(model, []);
    manager.openConversation(fixtures[0].id);
    manager.closeConversation();

    // Still ready, because the model is — not 'idle' from a stale flag.
    expect(manager.getPhase()).toBe('ready');
    expect(manager.isOpen()).toBe(false);
  });

  it('swapping in a ready model recovers the phase', () => {
    const broken = new FakeModel();
    broken.ready = false;
    const phases: ConversationPhase[] = [];
    const manager = build(broken, phases);

    manager.openConversation(fixtures[0].id);
    expect(manager.getPhase()).toBe('loading_model');

    manager.setLanguageModel(new FakeModel());
    manager.openConversation(fixtures[0].id);
    expect(manager.getPhase()).toBe('ready');
  });
});