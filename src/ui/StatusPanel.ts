export class StatusPanel {
  private el: HTMLElement;
  constructor() {
    this.el = document.createElement('div');
    this.el.style.position = 'absolute';
    this.el.style.top = '10px';
    this.el.style.right = '10px';
    this.el.style.color = 'white';
    this.el.style.background = 'rgba(0,0,0,0.5)';
    this.el.style.padding = '10px';
    this.el.style.fontFamily = 'monospace';
    this.el.style.zIndex = '100';
    document.body.appendChild(this.el);
  }
  
  public updateTime(timeStr: string) {
    this.el.innerText = `Time: ${timeStr}`;
  }
}
