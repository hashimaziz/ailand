import * as THREE from 'three';
import { Lighting } from './Lighting';

export class Scene {
  public instance: THREE.Scene;

  constructor() {
    this.instance = new THREE.Scene();
    this.instance.background = new THREE.Color(0x87ceeb); // Sky blue
    
    new Lighting(this.instance);

    this.createEnvironment();
  }

  private createEnvironment(): void {
    // Basic ground
    const planeGeo = new THREE.PlaneGeometry(100, 100);
    const planeMat = new THREE.MeshStandardMaterial({ color: 0x55aa55 }); // Greenish
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    this.instance.add(plane);

    // A placeholder landmark (box)
    const boxGeo = new THREE.BoxGeometry(2, 2, 2);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xaa5555 });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(0, 1, -5);
    box.castShadow = true;
    box.receiveShadow = true;
    this.instance.add(box);
  }
}
