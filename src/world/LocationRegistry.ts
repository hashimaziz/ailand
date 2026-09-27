import * as THREE from 'three';

export class LocationRegistry {
  private locations = new Map<string, THREE.Vector3>();

  public register(id: string, position: THREE.Vector3) {
    this.locations.set(id, position);
  }

  public get(id: string): THREE.Vector3 | undefined {
    return this.locations.get(id);
  }
}

export const locationRegistry = new LocationRegistry();
