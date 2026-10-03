import {
  LanguageModel,
  ModelConfig,
  GenerationConfig,
} from '../ai/LanguageModel';
import { Npc } from '../npc/types';
import { npcRegistry } from '../npc/NpcRegistry';
import { memoryStore } from '../memory/MemoryStore';
import { db } from '../persistence/Database';
import { generateId } from '../utils/ids';
import { CONVERSATION_CONFIG } from '../config/gameConfig';
import { contextAssembler, defaultPlayerRelationship } from './ContextAssembler';
import { promptBuilder } from './PromptBuilder';
import {
  BuiltPrompt,
  ConversationPhase,
  ConversationSession,
  DialogueTurn,
  PlayerRelationshipSnapshot,
} from './ConversationTypes';

export interface ConversationUiCallbacks {
  onPhaseChange: (phase: ConversationPhase) => void;
  onStreamToken: (text: string) => void;
  onNpcReplyComplete: (fullText: string) => void;
  onError: (message: string) => void;
  onPromptBuilt?: (prompt: BuiltPrompt) => void;
}

export class ConversationManager {
  private session: ConversationSession | null = null;
  private phase: ConversationPhase = 'idle';
  private activeRequestId: string | null = null;
  private modelReady = false;
  private lastPrompt: BuiltPrompt | null = null;

  constructor(
    private languageModel: LanguageModel,
    private modelConfig: ModelConfig,
    private getWorldTime: () => number,
    private getFormattedTime: () => string,
    private ui: ConversationUiCallbacks,
  ) {}

  public setLanguageModel(model: LanguageModel) {
    this.languageModel = model;
    this.modelReady = model.isReady();
  }

  public getPhase(): ConversationPhase {
    return this.phase;
  }

  public getLastPrompt(): BuiltPrompt | null {
    return this.lastPrompt;
  }

  public getActiveNpc(): Npc | null {
    if (!this.session) return null;
    return npcRegistry.get(this.session.npcId) ?? null;
  }

  public isOpen(): boolean {
    return this.session !== null;
  }

  public async ensureModelReady(): Promise<boolean> {
    if (this.languageModel.isReady()) {
      this.modelReady = true;
      this.setPhase('ready');
      return true;
    }
    this.setPhase('loading_model');
    try {
      await this.languageModel.initialize();
      this.modelReady = true;
      this.setPhase('ready');
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'The language model failed to load.';
      this.setPhase('error');
      this.ui.onError(message);
      return false;
    }
  }

  public openConversation(npcId: string): boolean {
    const npc = npcRegistry.get(npcId);
    if (!npc) return false;

    this.session = {
      npcId,
      startedAt: this.getWorldTime(),
      turns: [],
    };
    this.setPhase(this.modelReady ? 'ready' : 'loading_model');
    return true;
  }

  public closeConversation(): void {
    if (this.activeRequestId) {
      void this.languageModel.cancel(this.activeRequestId);
      this.activeRequestId = null;
    }
    this.session = null;
    this.setPhase(this.modelReady ? 'ready' : 'idle');
  }

  public async sendPlayerMessage(text: string): Promise<void> {
    if (!this.session || !text.trim()) return;

    const npc = npcRegistry.get(this.session.npcId);
    if (!npc) {
      this.ui.onError('That person is no longer available.');
      return;
    }

    if (!this.languageModel.isReady()) {
      const ok = await this.ensureModelReady();
      if (!ok) return;
    }

    const playerTurn: DialogueTurn = {
      role: 'player',
      content: text.trim(),
      at: this.getWorldTime(),
    };
    this.session.turns.push(playerTurn);
    this.trimRecentTurns();

    const relationship = await this.loadRelationship(npc.id);

    const context = await contextAssembler.assemble({
      npc,
      playerMessage: playerTurn.content,
      worldTime: this.getWorldTime(),
      formattedTime: this.getFormattedTime(),
      relationship,
    });

    const recentForPrompt = this.session.turns.slice(0, -1);
    const built = promptBuilder.build(
      context,
      recentForPrompt,
      playerTurn.content,
      this.modelConfig,
    );
    this.lastPrompt = built;
    this.ui.onPromptBuilt?.(built);

    await this.touchMemories(npc.id, built.selectedMemoryIds);

    const requestId = generateId('req_');
    this.activeRequestId = requestId;
    this.setPhase('generating');

    const generation: GenerationConfig = {
      maxNewTokens: CONVERSATION_CONFIG.maxNewTokens,
      temperature: this.modelConfig.temperature,
      topP: this.modelConfig.topP,
      topK: this.modelConfig.topK,
      doSample: true,
    };

    let npcText = '';

    try {
      await this.languageModel.generate(
        requestId,
        built.messages,
        generation,
        (event) => {
          if (event.requestId !== requestId) return;
          switch (event.type) {
            case 'token':
              npcText += event.text;
              this.ui.onStreamToken(event.text);
              break;
            case 'completed':
              npcText = event.fullText || npcText;
              this.finishNpcTurn(npcText.trim());
              break;
            case 'error':
              this.setPhase('error');
              this.ui.onError(event.message);
              break;
            default:
              break;
          }
        },
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong while generating a reply.';
      this.setPhase('error');
      this.ui.onError(message);
    } finally {
      if (this.activeRequestId === requestId) {
        this.activeRequestId = null;
      }
      if (this.phase === 'generating') {
        this.setPhase('ready');
      }
    }
  }

  public cancelGeneration(): void {
    if (!this.activeRequestId) return;
    void this.languageModel.cancel(this.activeRequestId);
    this.activeRequestId = null;
    this.setPhase('ready');
  }

  private finishNpcTurn(fullText: string) {
    if (!this.session || !fullText) return;
    const turn: DialogueTurn = {
      role: 'npc',
      content: fullText,
      at: this.getWorldTime(),
    };
    this.session.turns.push(turn);
    this.trimRecentTurns();
    this.ui.onNpcReplyComplete(fullText);
    this.setPhase('ready');
  }

  private trimRecentTurns() {
    if (!this.session) return;
    const max = CONVERSATION_CONFIG.maxRecentTurns;
    if (this.session.turns.length > max) {
      this.session.turns = this.session.turns.slice(-max);
    }
  }

  private setPhase(phase: ConversationPhase) {
    this.phase = phase;
    this.ui.onPhaseChange(phase);
  }

  private async loadRelationship(npcId: string): Promise<PlayerRelationshipSnapshot> {
    const npc = npcRegistry.get(npcId);
    const key = `relationship_${npcId}_player`;
    const saved = await db.loadMeta(key);
    if (saved && typeof saved === 'object') {
      return saved as PlayerRelationshipSnapshot;
    }
    if (!npc) {
      return {
        familiarity: 0.1,
        trust: 0.3,
        affection: 0.1,
        tension: 0.05,
        labels: ['stranger'],
      };
    }
    return defaultPlayerRelationship(npc);
  }

  private async touchMemories(npcId: string, memoryIds: string[]) {
    if (memoryIds.length === 0) return;
    const now = this.getWorldTime();
    const memories = await memoryStore.getMemories(npcId);
    for (const mem of memories) {
      if (memoryIds.includes(mem.id)) {
        mem.lastAccessedAt = now;
        await db.saveMemory(mem);
      }
    }
  }
}
