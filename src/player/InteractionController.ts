import * as THREE from 'three';

export interface Interactable {
  id: string;
  type: 'npc' | 'object';
  position: THREE.Vector3;
  name: string;
}

export class InteractionController {
  public currentTarget: Interactable | null = null;
  private interactDistance = 4.0;
  private interactables: Interactable[];
  private enabled = true;

  constructor(
    private camera: THREE.Camera, 
    interactables: Interactable[],
    private onInteract: (target: Interactable) => void
  ) {
    this.interactables = interactables;
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE' && this.enabled && this.currentTarget) {
        this.onInteract(this.currentTarget);
      }
    });
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.currentTarget = null;
      this.updateIndicator();
    }
  }

  public setInteractables(interactables: Interactable[]) {
    this.interactables = interactables;
  }

  public update() {
    // In a real app we'd cast against physics bodies or a BVH. 
    // Here we do a simple distance and angle check against known interactables for simplicity of prototype.
    
    let bestTarget: Interactable | null = null;
    let minDistance = this.interactDistance;

    const cameraPos = new THREE.Vector3();
    const cameraDir = new THREE.Vector3();
    this.camera.getWorldPosition(cameraPos);
    this.camera.getWorldDirection(cameraDir);

    for (const target of this.interactables) {
      const dist = cameraPos.distanceTo(target.position);
      if (dist < minDistance) {
        const dirToTarget = new THREE.Vector3().subVectors(target.position, cameraPos).normalize();
        const angle = cameraDir.angleTo(dirToTarget);
        // within ~15 degrees
        if (angle < 0.25) {
          minDistance = dist;
          bestTarget = target;
        }
      }
    }

    this.currentTarget = bestTarget;
    this.updateIndicator();
  }

  private updateIndicator() {
    const el = document.getElementById('interaction-indicator');
    if (!el) return;
    
    if (this.currentTarget) {
      el.style.display = 'block';
      el.innerText = `[E] Talk to ${this.currentTarget.name}`;
    } else {
      el.style.display = 'none';
    }
  }
}
