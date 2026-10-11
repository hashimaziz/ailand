import { Scene } from '../render/Scene';
import { Camera } from '../render/Camera';
import { Renderer } from '../render/Renderer';
import { PlayerController } from '../player/PlayerController';
import { InteractionController, Interactable } from '../player/InteractionController';
import { WorldClock } from '../world/WorldClock';
import { npcRegistry } from '../npc/NpcRegistry';
import { NpcSimulation } from '../npc/NpcSimulation';
import { fixtures } from '../npc/fixtures';
import { StatusPanel } from '../ui/StatusPanel';
import { DialoguePanel } from '../ui/DialoguePanel';
import { MemoryProposalPanel } from '../ui/MemoryProposalPanel';
import { buildSeedMemories } from '../memory/seedMemories';
import { memoryStore } from '../memory/MemoryStore';
import { ConversationManager } from '../conversation/ConversationManager';
import { isBenchmarkRequested } from '../ai/createLanguageModel';
import { runBenchmark } from '../ai/benchmarkMode';
import { getModelConfig } from '../ai/ModelConfig';
import { LanguageModel } from '../ai/LanguageModel';
import { AppConfig } from '../config/appConfig';
import * as THREE from 'three';

export class App {
  private scene!: Scene;
  private camera!: Camera;
  private renderer!: Renderer;
  private playerController!: PlayerController;
  private interactionController!: InteractionController;
  private worldClock!: WorldClock;
  private npcSimulation!: NpcSimulation;
  private statusPanel!: StatusPanel;
  private dialoguePanel!: DialoguePanel;
  private memoryPanel!: MemoryProposalPanel;
  private conversationManager!: ConversationManager;
  private modelStatusNote = '';
  private lastFrameMs = 0;

  /**
   * @param languageModel Already resolved and initialised by the startup flow, so
   *   the world never appears while a model is still downloading.
   */
  constructor(
    private container: HTMLElement,
    private languageModel: LanguageModel,
    private appConfig: AppConfig,
  ) {}

  public async initialize(): Promise<void> {
    this.container.innerHTML = '';
    
    this.scene = new Scene();
    this.camera = new Camera(window.innerWidth / window.innerHeight);
    this.renderer = new Renderer(this.scene, this.camera, this.appConfig.renderBackend === 'webgl2');
    
    this.container.appendChild(this.renderer.domElement);
    this.playerController = new PlayerController(this.camera.instance, document.body);
    
    const { db } = await import('../persistence/Database');
    await db.init();
    
    this.worldClock = new WorldClock();
    this.statusPanel = new StatusPanel();

    const savedTime = await db.loadMeta('clock_time');
    if (typeof savedTime === 'number') {
      this.worldClock.time = savedTime;
    }

    const savedNpcs = await db.loadAllNpcs();
    if (savedNpcs.length > 0) {
      for (const npc of savedNpcs) {
        npcRegistry.register(npc);
      }
    } else {
      for (const f of fixtures) {
        npcRegistry.register(f);
        await db.saveNpc(f);
      }
      for (const memory of buildSeedMemories()) {
        await memoryStore.save(memory);
      }
    }

    this.npcSimulation = new NpcSimulation(npcRegistry, this.worldClock, this.scene.instance);
    this.npcSimulation.initializeVisuals();

    const modelConfig = getModelConfig(this.appConfig.modelKey);
    // Report what is actually loaded, not what was requested: the configured
    // model may have been swapped for the mock by capability fallback.
    const info = this.languageModel.getModelInfo?.();
    this.modelStatusNote =
      info && info.id !== 'mock-model'
        ? `Model: ${info.id} (${info.dtype}/${info.device})`
        : 'Mock dialogue model — no local model loaded';

    this.conversationManager = new ConversationManager(
      this.languageModel,
      modelConfig,
      () => this.worldClock.time,
      () => this.worldClock.getFormattedTime(),
      {
        onPhaseChange: (phase) => {
          this.dialoguePanel?.setPhase(phase);
          this.refreshStatus();
        },
        onStreamToken: (text) => this.dialoguePanel?.appendStreamToken(text),
        onNpcReplyComplete: (fullText) => this.dialoguePanel?.appendNpcLine(fullText),
        onError: (message) => {
          this.dialoguePanel?.showError(message, {
            showRetry: !this.languageModel.isReady(),
          });
        },
        onMemoryFormation: (record) => this.memoryPanel.append(record),
      },
    );

    this.memoryPanel = new MemoryProposalPanel();

    this.dialoguePanel = new DialoguePanel({
      onSend: (message) => {
        void this.conversationManager.sendPlayerMessage(message);
      },
      onClose: () => this.closeConversation(),
      onCancelGeneration: () => this.conversationManager.cancelGeneration(),
      onRetryModel: () => {
        void this.retryLanguageModel();
      },
    });

    const interactables = this.buildInteractables();
    this.interactionController = new InteractionController(
      this.camera.instance,
      interactables,
      (target) => this.openConversation(target),
    );

    setInterval(() => {
      import('../persistence/Database').then(({ db }) => {
        db.saveMeta('clock_time', this.worldClock.time);
        for (const npc of npcRegistry.getAll()) {
          db.saveNpc(npc);
        }
      });
    }, 5000);

    window.addEventListener('resize', this.onWindowResize.bind(this));

    await this.renderer.init();
    this.refreshStatus();
    console.log('App initialized.');
  }

  public start(): void {
    console.log('App started.');
    this.loop();

    // The model is already loaded by the startup flow; this is a cheap no-op
    // that also recovers if the player hit "retry".
    void this.warmUpLanguageModel();

    if (isBenchmarkRequested()) {
      // Benchmarks build their own workers per candidate, so skip the normal
      // warm-up: running both at once doubles the downloads and contends for
      // the same GPU.
      void runBenchmark();
    }
  }

  /**
   * Recover from a failed load without reloading the page.
   *
   * Disposing drops the underlying worker, so the next `initialize()` builds a
   * fresh one — a cached download makes this quick.
   */
  private async warmUpLanguageModel(): Promise<void> {
    try {
      await this.languageModel.initialize();
      this.refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.modelStatusNote = `Language model unavailable: ${message}`;
      this.refreshStatus();
    }
  }

  private buildInteractables(): Interactable[] {
    return npcRegistry.getAll().map((npc) => {
      const mesh = this.npcSimulation.getMesh(npc.id);
      return {
        id: npc.id,
        type: 'npc' as const,
        name: npc.identity.name,
        position: mesh ? mesh.position : new THREE.Vector3(),
      };
    });
  }

  private openConversation(target: Interactable) {
    if (target.type !== 'npc' || this.conversationManager.isOpen()) return;
    const opened = this.conversationManager.openConversation(target.id);
    if (!opened) return;

    this.playerController.setInputEnabled(false);
    this.interactionController.setEnabled(false);
    this.dialoguePanel.open(target.name);

    if (!this.languageModel.isReady()) {
      // Say why the composer is disabled, and offer a way out. A disabled input
      // with no explanation is indistinguishable from a hung game.
      this.dialoguePanel.showNotice(
        'The language model is still loading. This can take a while on the first run.',
      );
      void this.conversationManager.ensureModelReady().then((ready) => {
        if (ready) {
          this.dialoguePanel.clearNotice();
          return;
        }
        this.dialoguePanel.showError(
          `${this.modelStatusNote || 'The language model is unavailable.'} ` +
            'NPCs cannot reply until it loads. Close this panel to keep exploring.',
          { showRetry: true },
        );
      });
    }
  }

  private closeConversation() {
    this.conversationManager.closeConversation();
    this.dialoguePanel.hide();
    this.playerController.setInputEnabled(true);
    this.interactionController.setEnabled(true);
  }

  private async retryLanguageModel() {
    this.dialoguePanel.clearError();
    this.dialoguePanel.setPhase('loading_model');
    await this.languageModel.dispose();
    this.modelStatusNote = 'Retrying language model load…';
    this.refreshStatus();
    const ok = await this.conversationManager.ensureModelReady();
    if (!ok) return;
    this.refreshStatus();
  }

  private refreshStatus() {
    this.statusPanel.updateTime(
      `${this.worldClock.getFormattedTime()}${this.phaseLabel()}\n${this.modelStatusNote}`,
    );
  }

  private phaseLabel(): string {
    const phase = this.conversationManager?.getPhase?.() ?? 'idle';
    if (phase === 'generating') return ' | Talking…';
    if (phase === 'loading_model') return ' | Loading AI…';
    if (phase === 'error') return ' | AI error';
    return '';
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const delta = this.lastFrameMs === 0 ? 0 : (now - this.lastFrameMs) / 1000;
    this.lastFrameMs = now;
    
    this.worldClock.update(delta);
    // Always refresh: skipping this while a panel is open let the phase label
    // freeze at whatever it said when the panel opened, which is how a working
    // conversation ended up labelled "Loading AI".
    this.statusPanel.updateTime(
      `${this.worldClock.getFormattedTime()}${this.phaseLabel()}\n${this.modelStatusNote}`,
    );
    
    this.npcSimulation.update(delta);
    
    this.interactionController.setInteractables(this.buildInteractables());

    this.playerController.update(delta);
    if (!this.conversationManager.isOpen()) {
      this.interactionController.update();
    }
    
    this.renderer.render();
  }

  private onWindowResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.resize(width / height);
    this.renderer.resize(width, height);
  }
}
