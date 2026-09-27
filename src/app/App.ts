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
import * as THREE from 'three';

export class App {
  private scene!: Scene;
  private camera!: Camera;
  private renderer!: Renderer;
  private playerController!: PlayerController;
  private interactionController!: InteractionController;
  private clock = new THREE.Clock();
  
  private worldClock!: WorldClock;
  private npcSimulation!: NpcSimulation;
  private statusPanel!: StatusPanel;

  constructor(private container: HTMLElement) {}

  public async initialize(): Promise<void> {
    this.container.innerHTML = '';
    
    this.scene = new Scene();
    this.camera = new Camera(window.innerWidth / window.innerHeight);
    this.renderer = new Renderer(this.scene, this.camera);
    
    this.container.appendChild(this.renderer.domElement);
    this.playerController = new PlayerController(this.camera.instance, document.body);
    
    this.worldClock = new WorldClock();
    this.statusPanel = new StatusPanel();

    for (const f of fixtures) {
      npcRegistry.register(f);
    }

    this.npcSimulation = new NpcSimulation(npcRegistry, this.worldClock, this.scene.instance);
    this.npcSimulation.initializeVisuals();

    // Map NPCs to Interactables
    const interactables: Interactable[] = npcRegistry.getAll().map(npc => ({
      id: npc.id,
      type: 'npc',
      name: npc.identity.name,
      // The interaction controller just needs an approximate position. 
      // NpcSimulation updates their meshes. We should ideally pass a reference to the mesh position.
      // For now, we'll keep a reference that updates dynamically by creating a getter property.
      get position() {
        const mesh = (this as any)._mesh; // We'd need to expose meshes from NpcSimulation or look them up
        // Simple workaround for prototype: grab from scene
        return mesh ? mesh.position : new THREE.Vector3();
      }
    }));

    this.interactionController = new InteractionController(
      this.camera.instance, 
      interactables, 
      (target) => {
        console.log('Interacted with:', target.name);
        alert(`Started conversation with ${target.name}`);
      }
    );

    window.addEventListener('resize', this.onWindowResize.bind(this));

    await this.renderer.init();
    console.log('App initialized.');
  }

  public start(): void {
    console.log('App started.');
    this.loop();
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const delta = this.clock.getDelta();
    
    this.worldClock.update(delta);
    this.statusPanel.updateTime(this.worldClock.getFormattedTime());
    
    this.npcSimulation.update(delta);
    
    // Update interactables with live mesh positions
    const interactables: Interactable[] = npcRegistry.getAll().map(npc => {
      const mesh = this.npcSimulation.getMesh(npc.id);
      return {
        id: npc.id,
        type: 'npc',
        name: npc.identity.name,
        position: mesh ? mesh.position : new THREE.Vector3()
      };
    });
    
    // Re-inject updated positions
    (this.interactionController as any).interactables = interactables;

    this.playerController.update(delta);
    this.interactionController.update();
    
    this.renderer.render();
  }

  private onWindowResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.resize(width / height);
    this.renderer.resize(width, height);
  }
}
