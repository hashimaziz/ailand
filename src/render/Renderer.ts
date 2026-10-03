import { WebGPURenderer } from 'three/webgpu';
import { Scene } from './Scene';
import { Camera } from './Camera';

export class Renderer {
  public instance: WebGPURenderer;
  public domElement: HTMLCanvasElement;
  private scene: Scene;
  private camera: Camera;

  constructor(scene: Scene, camera: Camera) {
    this.scene = scene;
    this.camera = camera;
    
    this.instance = new WebGPURenderer({ antialias: true });
    this.instance.setPixelRatio(window.devicePixelRatio);
    this.instance.setSize(window.innerWidth, window.innerHeight);
    this.instance.shadowMap.enabled = true;

    this.domElement = this.instance.domElement;
  }

  public resize(width: number, height: number): void {
    this.instance.setSize(width, height);
  }

  public async init(): Promise<void> {
    await this.instance.init();
  }

  public render(): void {
    this.instance.render(this.scene.instance, this.camera.instance);
  }
}
