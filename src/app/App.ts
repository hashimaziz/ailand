import { Scene } from '../render/Scene';
import { Camera } from '../render/Camera';
import { Renderer } from '../render/Renderer';
import { PlayerController } from '../player/PlayerController';
import { InteractionController, Interactable } from '../player/InteractionController';
import * as THREE from 'three';

export class App {
  private scene!: Scene;
  private camera!: Camera;
  private renderer!: Renderer;
  private playerController!: PlayerController;
  private interactionController!: InteractionController;
  
  private clock = new THREE.Clock();

  constructor(private container: HTMLElement) {}

  public async initialize(): Promise<void> {
    this.container.innerHTML = '';
    
    this.scene = new Scene();
    this.camera = new Camera(window.innerWidth / window.innerHeight);
    this.renderer = new Renderer(this.scene, this.camera);
    
    this.container.appendChild(this.renderer.domElement);
    
    this.playerController = new PlayerController(this.camera.instance, document.body);
    
    const mockInteractables: Interactable[] = [
      { id: 'npc1', type: 'npc', name: 'Maria', position: new THREE.Vector3(0, 0.8, -10) }
    ];
    
    const npcMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 1.6),
      new THREE.MeshStandardMaterial({ color: 0xffaa00 })
    );
    npcMesh.position.set(0, 0.8, -10);
    this.scene.instance.add(npcMesh);

    this.interactionController = new InteractionController(
      this.camera.instance, 
      mockInteractables,
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
