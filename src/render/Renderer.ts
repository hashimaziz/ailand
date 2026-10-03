import { WebGPURenderer } from 'three/webgpu';
import { Scene } from './Scene';
import { Camera } from './Camera';

export class Renderer {
  public instance: WebGPURenderer;
  public domElement: HTMLCanvasElement;
  private scene: Scene;
  private camera: Camera;

  /**
   * @param forceWebGL Render through the WebGL2 backend instead of taking a WebGPU
   *   device. Inference runs in its own worker with its own device, so on a
   *   memory-constrained GPU two devices at once can be what tips an inference
   *   session into `std::bad_alloc`.
   */
  constructor(scene: Scene, camera: Camera, forceWebGL = false) {
    this.scene = scene;
    this.camera = camera;

    this.instance = new WebGPURenderer({ antialias: true, forceWebGL });
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
