import * as THREE from 'three';

export interface Interactable {
  id: string;
  type: 'npc' | 'object';
  position: THREE.Vector3;
  name: string;
}

export interface PickOptions {
  maxDistance: number;
  /** Half-angle of the facing cone, in radians. */
  maxAngle: number;
}

export interface PickInput {
  cameraPosition: { x: number; y: number; z: number };
  cameraDirection: { x: number; y: number; z: number };
  targets: Interactable[];
}

/**
 * Choose the interactable the player is facing.
 *
 * Distance and angle are both measured **horizontally**. The previous version
 * compared against the target's full position, which sits at knee height on an NPC
 * mesh: walking right up to someone put them below the eyeline and outside the
 * facing cone, so the prompt refused to appear when you were closest. That made
 * interaction depend on stopping at exactly the right distance.
 *
 * Pure and side-effect free so the geometry can be tested without a scene.
 */
export function pickInteractionTarget(
  input: PickInput,
  options: PickOptions,
): Interactable | null {
  const { cameraPosition: cam, cameraDirection: dir, targets } = input;

  // Flatten the look direction; looking up or down should not change whether an
  // NPC is interactable.
  const forwardLength = Math.hypot(dir.x, dir.z);
  if (forwardLength === 0) return null;
  const fx = dir.x / forwardLength;
  const fz = dir.z / forwardLength;
  const minDot = Math.cos(options.maxAngle);

  let best: Interactable | null = null;
  let bestDistance = options.maxDistance;

  for (const target of targets) {
    const dx = target.position.x - cam.x;
    const dz = target.position.z - cam.z;
    const distance = Math.hypot(dx, dz);
    if (distance > bestDistance) continue;

    if (distance > 0.001) {
      const dot = (dx * fx + dz * fz) / distance;
      if (dot < minDot) continue;
    }

    // Nearest wins, so overlapping interactables resolve predictably.
    bestDistance = distance;
    best = target;
  }

  return best;
}

export class InteractionController {
  public currentTarget: Interactable | null = null;
  private enabled = true;
  private maxDistance = 4.0;
  private maxAngle = 0.25;
  private interactables: Interactable[];
  private cameraPosition = new THREE.Vector3();
  private cameraDirection = new THREE.Vector3();

  constructor(
    private camera: THREE.Camera,
    interactables: Interactable[],
    private onInteract: (target: Interactable) => void,
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
    this.camera.getWorldPosition(this.cameraPosition);
    this.camera.getWorldDirection(this.cameraDirection);

    this.currentTarget = pickInteractionTarget(
      {
        cameraPosition: this.cameraPosition,
        cameraDirection: this.cameraDirection,
        targets: this.interactables,
      },
      { maxDistance: this.maxDistance, maxAngle: this.maxAngle },
    );

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