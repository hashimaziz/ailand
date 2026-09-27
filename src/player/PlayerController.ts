import * as THREE from 'three';

export class PlayerController {
  private speed = 5.0;
  private moveForward = false;
  private moveBackward = false;
  private moveLeft = false;
  private moveRight = false;

  private bounds = { minX: -48, maxX: 48, minZ: -48, maxZ: 48 };
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private isLocked = false;

  constructor(private camera: THREE.Camera, private domElement: HTMLElement) {
    this.initEvents();
  }

  private initEvents() {
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    
    this.domElement.addEventListener('click', () => {
      this.domElement.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.domElement;
    });

    document.addEventListener('mousemove', this.onMouseMove);
  }

  private onMouseMove = (event: MouseEvent) => {
    if (!this.isLocked) return;
    
    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;
    
    this.euler.setFromQuaternion(this.camera.quaternion);
    
    this.euler.y -= movementX * 0.002;
    this.euler.x -= movementY * 0.002;
    
    this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
    
    this.camera.quaternion.setFromEuler(this.euler);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW': this.moveForward = true; break;
      case 'ArrowLeft':
      case 'KeyA': this.moveLeft = true; break;
      case 'ArrowDown':
      case 'KeyS': this.moveBackward = true; break;
      case 'ArrowRight':
      case 'KeyD': this.moveRight = true; break;
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW': this.moveForward = false; break;
      case 'ArrowLeft':
      case 'KeyA': this.moveLeft = false; break;
      case 'ArrowDown':
      case 'KeyS': this.moveBackward = false; break;
      case 'ArrowRight':
      case 'KeyD': this.moveRight = false; break;
    }
  };

  public update(delta: number) {
    if (!this.isLocked) return;

    const dirZ = Number(this.moveForward) - Number(this.moveBackward);
    const dirX = Number(this.moveRight) - Number(this.moveLeft);

    if (dirZ !== 0 || dirX !== 0) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      forward.y = 0;
      forward.normalize();
      
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      right.y = 0;
      right.normalize();

      const moveDir = new THREE.Vector3()
        .addScaledVector(forward, dirZ)
        .addScaledVector(right, dirX)
        .normalize();

      this.camera.position.addScaledVector(moveDir, this.speed * delta);
    }

    this.camera.position.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.camera.position.x));
    this.camera.position.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, this.camera.position.z));
    this.camera.position.y = 1.6;
  }
}
