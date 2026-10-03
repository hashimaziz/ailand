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
import { ConversationManager } from '../conversation/ConversationManager';
import { createLanguageModel } from '../ai/createLanguageModel';
import { DeferredLanguageModel } from '../ai/DeferredLanguageModel';
import { getModelConfig } from '../ai/ModelConfig';
import { LanguageModel } from '../ai/LanguageModel';
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
  private conversationManager!: ConversationManager;
  private languageModel!: LanguageModel;
  private modelStatusNote = '';
  private lastFrameMs = 0;

  constructor(private container: HTMLElement) {}

  public async initialize(): Promise<void> {
    this.container.innerHTML = '';
    
    this.scene = new Scene();
    this.camera = new Camera(window.innerWidth / window.innerHeight);
    this.renderer = new Renderer(this.scene, this.camera);
    
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
    }

    this.npcSimulation = new NpcSimulation(npcRegistry, this.worldClock, this.scene.instance);
    this.npcSimulation.initializeVisuals();

    const modelConfig = getModelConfig();
    this.languageModel = new DeferredLanguageModel(() => this.createModel());
    this.modelStatusNote = 'Language model loading in background…';

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
      },
    );

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

    // Start loading the language model after the first frame so the world is
    // interactive while the model downloads.
    void this.warmUpLanguageModel();
  }

  private async createModel(): Promise<LanguageModel> {
    const { model, kind, fallbackReason } = await createLanguageModel({
      onProgress: (event) => {
        this.modelStatusNote = event.message ?? 'Loading model…';
        this.refreshStatus();
      },
    });
    this.modelStatusNote =
      kind === 'mock'
        ? fallbackReason ?? 'Mock dialogue model (add ?realAi=1 for WebGPU model)'
        : `Model ready (${model.getModelInfo?.()?.id ?? getModelConfig().id})`;
    this.refreshStatus();
    return model;
  }

  private async warmUpLanguageModel(): Promise<void> {
    try {
      await this.languageModel.initialize();
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
      void this.conversationManager.ensureModelReady();
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
    const phase = this.conversationManager?.getPhase?.() ?? 'idle';
    const phaseLabel =
      phase === 'generating'
        ? ' | Talking…'
        : phase === 'loading_model'
          ? ' | Loading AI…'
          : '';
    this.statusPanel.updateTime(
      `${this.worldClock.getFormattedTime()}${phaseLabel}\n${this.modelStatusNote}`,
    );
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const delta = this.lastFrameMs === 0 ? 0 : (now - this.lastFrameMs) / 1000;
    this.lastFrameMs = now;
    
    this.worldClock.update(delta);
    if (!this.conversationManager?.isOpen()) {
      this.statusPanel.updateTime(
        `${this.worldClock.getFormattedTime()}\n${this.modelStatusNote}`,
      );
    }
    
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
