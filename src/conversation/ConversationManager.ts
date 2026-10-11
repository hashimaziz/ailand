import {
  LanguageModel,
  ModelConfig,
  GenerationConfig,
} from '../ai/LanguageModel';
import { Npc } from '../npc/types';
import { npcRegistry } from '../npc/NpcRegistry';
import { memoryStore } from '../memory/MemoryStore';
import { MemoryProcessor, MemoryFormationOutcome } from '../memory/MemoryProcessor';
import {
  buildExtractionMessages,
  extractionGenerationConfig,
  parseExtractionResponse,
} from '../memory/MemoryFormation';
import { MemoryProposalRecord } from '../memory/MemoryTypes';
import { CONVERSATION_CONFIG, MEMORY_CONFIG } from '../config/gameConfig';
import { generateId } from '../utils/ids';
import { relationshipStore } from '../npc/RelationshipStore';
import { STRANGER_RELATIONSHIP } from '../npc/Relationship';
import { contextAssembler } from './ContextAssembler';
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
  onMemoryFormation?: (record: MemoryProposalRecord) => void;
}

/** Remove labels that merely echo the NPC's own traits or speech style. */
function dropPersonalityWords(labels: string[], npc: Npc): string[] {
  const own = new Set(
    [...npc.personality.traits, ...npc.personality.speechStyle, ...npc.personality.values].map((w) =>
      w.toLowerCase(),
    ),
  );
  return labels.filter((label) => !own.has(label.toLowerCase()));
}

export class ConversationManager {
  private session: ConversationSession | null = null;
  private phase: ConversationPhase = 'idle';
  private activeRequestId: string | null = null;
  private lastPrompt: BuiltPrompt | null = null;
  private memoryProcessor = new MemoryProcessor();
  /**
   * The session being closed, kept until an in-flight cancel has delivered its
   * partial reply. Cancelling is asynchronous, so without this the partial answer
   * arrived after `this.session` was cleared and was discarded.
   */
  private closingSession: ConversationSession | null = null;
  private cancelSettled: Promise<void> = Promise.resolve();

  constructor(
    private languageModel: LanguageModel,
    private modelConfig: ModelConfig,
    private getWorldTime: () => number,
    private getFormattedTime: () => string,
    private ui: ConversationUiCallbacks,
  ) {}

  public setLanguageModel(model: LanguageModel) {
    this.languageModel = model;
  }

  /**
   * Readiness is read from the model, never cached.
   *
   * A private `modelReady` flag defaulted to false and was only set by
   * `ensureModelReady()`, so a model that startup had already loaded — the llama
   * path — still reported "not ready" and left the session parked in the loading
   * phase, showing "Loading AI" to a player who could in fact talk.
   */
  private get modelReady(): boolean {
    return this.languageModel.isReady();
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
      this.setPhase('ready');
      return true;
    }
    this.setPhase('loading_model');
    try {
      await this.languageModel.initialize();
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
      transcript: [],
    };
    this.setPhase(this.modelReady ? 'ready' : 'loading_model');
    return true;
  }

  public closeConversation(): void {
    const finished = this.session;
    this.session = null;

    if (this.activeRequestId) {
      const requestId = this.activeRequestId;
      this.activeRequestId = null;
      this.closingSession = finished;
      // Wait for the partial reply to be delivered before forming memories, so a
      // half-written line is neither lost nor omitted from what gets distilled.
      this.cancelSettled = this.languageModel
        .cancel(requestId)
        .catch(() => {})
        .then(() => {
          this.closingSession = null;
        });
    }

    this.setPhase(this.modelReady ? 'ready' : 'idle');

    if (finished) {
      // Formation runs after the panel closes so the player is never held waiting
      // on a second model round-trip.
      void this.formMemories(finished);
    }
  }

  public async sendPlayerMessage(text: string): Promise<void> {
    // Hold the session for the whole call: closing the panel mid-await used to
    // null this.session and throw on the next line.
    const session = this.session;
    if (!session || !text.trim()) return;

    const npc = npcRegistry.get(session.npcId);
    if (!npc) {
      this.ui.onError('That person is no longer available.');
      return;
    }

    // Claim the turn before any awaiting. Assembling context takes long enough for
    // a second Enter press to start a parallel generation, and two streams then
    // interleave into one reply bubble.
    if (this.phase === 'generating') return;
    this.setPhase('generating');

    try {
      if (!this.languageModel.isReady()) {
        const ok = await this.ensureModelReady();
        if (!ok) return;
      }

      const playerTurn: DialogueTurn = {
        role: 'player',
        content: text.trim(),
        at: this.getWorldTime(),
      };
      this.recordTurn(session, playerTurn);

      const relationship = await this.loadRelationship(npc.id);

      const context = await contextAssembler.assemble({
        npc,
        playerMessage: playerTurn.content,
        worldTime: this.getWorldTime(),
        formattedTime: this.getFormattedTime(),
        relationship,
      });

      const recentForPrompt = session.turns.slice(0, -1);
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

      const generation: GenerationConfig = {
        maxNewTokens: CONVERSATION_CONFIG.maxNewTokens,
        temperature: this.modelConfig.temperature,
        topP: this.modelConfig.topP,
        topK: this.modelConfig.topK,
        doSample: true,
      };

      let npcText = '';

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
      if (this.activeRequestId !== null) {
        this.activeRequestId = null;
      }
      // Only unwind a turn that is still ours: a generation error already moved
      // the phase to 'error', and overwriting that would hide the failure.
      if (this.phase === ('generating' as ConversationPhase)) {
        this.setPhase(this.modelReady ? 'ready' : 'loading_model');
      }
    }
  }

  /**
   * Append to both the prompt window and the full transcript.
   *
   * Keeping one bounded list for the prompt and one complete list for memory
   * means a long conversation is distilled from everything that was said, not just
   * the turns that happened to fit.
   */
  private recordTurn(session: ConversationSession, turn: DialogueTurn): void {
    session.transcript.push(turn);

    if (this.session === session) {
      session.turns.push(turn);
      const max = CONVERSATION_CONFIG.maxRecentTurns;
      if (session.turns.length > max) {
        session.turns = session.turns.slice(-max);
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
    // A cancelled reply arrives after the panel closed; fall back to the session
    // that was closing so a partial answer still reaches the transcript and is
    // still available to memory formation.
    const session = this.session ?? this.closingSession;
    if (!session || !fullText) return;
    this.recordTurn(session, {
      role: 'npc',
      content: fullText,
      at: this.getWorldTime(),
    });
    this.ui.onNpcReplyComplete(fullText);
    if (this.session) {
      this.setPhase(this.modelReady ? 'ready' : 'loading_model');
    }
  }

  private setPhase(phase: ConversationPhase) {
    this.phase = phase;
    this.ui.onPhaseChange(phase);
  }

  private async loadRelationship(npcId: string): Promise<PlayerRelationshipSnapshot> {
    const npc = npcRegistry.get(npcId);
    if (!npc) {
      return { ...STRANGER_RELATIONSHIP, labels: [...STRANGER_RELATIONSHIP.labels] };
    }
    return relationshipStore.load(npc);
  }

  /**
   * Distil a finished conversation into durable memories.
   *
   * Structured extraction is a second, low-temperature generation. It is skipped
   * for conversations too small to contain anything worth keeping, and any
   * failure is reported without touching existing memory: a broken extraction
   * must never corrupt what the NPC already knows.
   */
  private async formMemories(session: ConversationSession): Promise<void> {
    const npc = npcRegistry.get(session.npcId);
    if (!npc) return;

    // A cancel in flight may still be appending to the transcript.
    await this.cancelSettled;

    // Distil the whole conversation, not just the prompt-sized window.
    const transcript = session.transcript.length > 0 ? session.transcript : session.turns;
    const playerTurns = transcript.filter((t) => t.role === 'player');
    const totalChars = transcript.reduce((sum, t) => sum + t.content.length, 0);

    if (
      playerTurns.length < MEMORY_CONFIG.minPlayerTurns ||
      totalChars < MEMORY_CONFIG.minConversationChars
    ) {
      this.ui.onMemoryFormation?.({
        npcId: npc.id,
        proposals: [],
        skipped: `conversation too short to remember (${totalChars} chars, ${playerTurns.length} player turns)`,
      });
      return;
    }

    const startTime = performance.now();

    if (!this.languageModel.isReady()) {
      const ready = await this.ensureModelReady();
      if (!ready) {
        this.ui.onMemoryFormation?.({
          npcId: npc.id,
          proposals: [],
          error: 'language model unavailable, no memories formed',
        });
        return;
      }
    }

    let raw = '';
    try {
      await this.languageModel.generate(
        generateId('extract_'),
        buildExtractionMessages({ npc, turns: transcript }),
        extractionGenerationConfig(),
        (event) => {
          if (event.type === 'token') raw += event.text;
          else if (event.type === 'completed') raw = event.fullText || raw;
        },
      );
    } catch (err) {
      this.ui.onMemoryFormation?.({
        npcId: npc.id,
        proposals: [],
        error: err instanceof Error ? err.message : 'memory extraction failed',
      });
      return;
    }

    const parsed = parseExtractionResponse(raw);
    if (!parsed) {
      console.warn(
        `[MEMORY] extraction from ${npc.identity.name} was unparseable (${raw.length} chars): ${JSON.stringify(raw.slice(0, 200))}`,
      );
      this.ui.onMemoryFormation?.({
        npcId: npc.id,
        proposals: [],
        error: `could not parse structured extraction output (${raw.length} characters)`,
        durationMs: performance.now() - startTime,
      });
      return;
    }

    const currentRelationship = await relationshipStore.load(npc);
    const outcome: MemoryFormationOutcome = await this.memoryProcessor.process({
      npc,
      candidates: parsed.memories,
      // A label that just restates the NPC's own personality carries no
      // relationship information — models reach for whatever adjectives are in the
      // prompt, which produced labels like ["friendly", "observant"].
      relationshipUpdates: parsed.relationshipUpdates.map((update) => ({
        ...update,
        labels: update.labels
          ? dropPersonalityWords(update.labels, npc)
          : undefined,
      })),
      currentRelationship,
      worldTime: this.getWorldTime(),
      warnings: parsed.warnings,
    });

    if (outcome.relationship) {
      await relationshipStore.save(npc.id, outcome.relationship.after);
    }

    const record: MemoryProposalRecord = {
      npcId: npc.id,
      proposals: outcome.proposals,
      durationMs: performance.now() - startTime,
    };
    console.info(
      `[MEMORY] ${npc.identity.name}: ${outcome.proposals.filter((p) => p.decision === 'accepted').length} accepted, `
      + `${outcome.proposals.filter((p) => p.decision === 'merged').length} merged, `
      + `${outcome.proposals.filter((p) => p.decision === 'rejected').length} rejected`,
    );
    this.ui.onMemoryFormation?.(record);
  }

  private async touchMemories(npcId: string, memoryIds: string[]) {
    if (memoryIds.length === 0) return;
    const now = this.getWorldTime();
    const memories = await memoryStore.getMemories(npcId);
    for (const mem of memories) {
      if (memoryIds.includes(mem.id)) {
        mem.lastAccessedAt = now;
        await memoryStore.save(mem);
      }
    }
  }
}
