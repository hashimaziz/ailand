import * as THREE from 'three';

export class Camera {
  public instance: THREE.PerspectiveCamera;

  constructor(aspect: number) {
    this.instance = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    // Initial position
    this.instance.position.set(0, 1.6, 5); // 1.6m is average eye height
  }

  public resize(aspect: number): void {
    this.instance.aspect = aspect;
    this.instance.updateProjectionMatrix();
  }
}
