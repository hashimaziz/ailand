export class App {
  constructor(private container: HTMLElement) {}

  public async initialize(): Promise<void> {
    this.container.innerHTML = '<h1>AI NPC City Prototype</h1><p>Initialization in progress...</p>';
    console.log('App initialized.');
  }

  public start(): void {
    console.log('App started.');
  }
}
