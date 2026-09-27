import { Scene } from '../render/Scene';
import { Camera } from '../render/Camera';
import { Renderer } from '../render/Renderer';

export class App {
  private scene!: Scene;
  private camera!: Camera;
  private renderer!: Renderer;

  constructor(private container: HTMLElement) {}

  public async initialize(): Promise<void> {
    this.container.innerHTML = '';
    
    this.scene = new Scene();
    this.camera = new Camera(window.innerWidth / window.innerHeight);
    this.renderer = new Renderer(this.scene, this.camera);
    
    this.container.appendChild(this.renderer.domElement);

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
    this.renderer.render();
  }

  private onWindowResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.resize(width / height);
    this.renderer.resize(width, height);
  }
}
