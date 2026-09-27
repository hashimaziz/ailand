import { NpcRegistry } from './NpcRegistry';
import { WorldClock } from '../world/WorldClock';
import { locationRegistry } from '../world/LocationRegistry';
import * as THREE from 'three';

export class NpcSimulation {
  // visual representation mapping
  private meshes = new Map<string, THREE.Mesh>();
  private moveSpeed = 2.0;

  constructor(
    private registry: NpcRegistry, 
    private clock: WorldClock,
    private scene: THREE.Scene
  ) {}
  
  public initializeVisuals() {
    for (const npc of this.registry.getAll()) {
      const geo = new THREE.CylinderGeometry(0.4, 0.4, 1.6);
      const mat = new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff });
      const mesh = new THREE.Mesh(geo, mat);
      
      const loc = locationRegistry.get(npc.state.locationId);
      if (loc) {
        mesh.position.copy(loc);
        mesh.position.y = 0.8; // half height
      }
      
      this.scene.add(mesh);
      this.meshes.set(npc.id, mesh);
    }
  }

  public getMesh(npcId: string): THREE.Mesh | undefined {
    return this.meshes.get(npcId);
  }

  public update(delta: number) {
    const hour = this.clock.getHourOfDay();
    
    for (const npc of this.registry.getAll()) {
      // Find current schedule block
      const block = npc.schedule.find(b => 
        (hour >= b.startHour && hour < b.endHour) || 
        (b.startHour > b.endHour && (hour >= b.startHour || hour < b.endHour))
      );
      
      if (block) {
        npc.state.currentActivity = block.activity;
        
        // If we have a new destination
        if (npc.state.locationId !== block.locationId) {
          const targetLoc = locationRegistry.get(block.locationId);
          const mesh = this.meshes.get(npc.id);
          
          if (targetLoc && mesh) {
            // Move towards target
            const targetPos = targetLoc.clone().setY(0.8);
            const dist = mesh.position.distanceTo(targetPos);
            
            if (dist > 0.1) {
              const dir = new THREE.Vector3().subVectors(targetPos, mesh.position).normalize();
              mesh.position.addScaledVector(dir, this.moveSpeed * delta);
            } else {
              // Arrived
              npc.state.locationId = block.locationId;
            }
          } else {
            // Fallback immediately update location if no target visual info
            npc.state.locationId = block.locationId;
          }
        }
      }
    }
  }
}
