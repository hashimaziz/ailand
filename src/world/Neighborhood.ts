import * as THREE from 'three';
import { locationRegistry } from '../world/LocationRegistry';

export class Neighborhood {
  constructor(private scene: THREE.Scene) {
    this.build();
  }

  private build() {
    const matRoad = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const matBuilding = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    const matPark = new THREE.MeshStandardMaterial({ color: 0x228b22 });
    
    // Road
    const road = new THREE.Mesh(new THREE.PlaneGeometry(100, 10), matRoad);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.01, 0);
    road.receiveShadow = true;
    this.scene.add(road);

    // North Apartments
    const apartments = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 20), matBuilding);
    apartments.position.set(0, 10, -20);
    apartments.castShadow = true;
    apartments.receiveShadow = true;
    this.scene.add(apartments);
    locationRegistry.register('apartments', new THREE.Vector3(0, 0, -10));

    // South Park
    const park = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), matPark);
    park.rotation.x = -Math.PI / 2;
    park.position.set(0, 0.02, 25);
    park.receiveShadow = true;
    this.scene.add(park);
    
    // Park Tree
    const treeTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 4), new THREE.MeshStandardMaterial({ color: 0x8b4513 }));
    treeTrunk.position.set(0, 2, 25);
    treeTrunk.castShadow = true;
    this.scene.add(treeTrunk);
    const treeLeaves = new THREE.Mesh(new THREE.SphereGeometry(3), matPark);
    treeLeaves.position.set(0, 5, 25);
    treeLeaves.castShadow = true;
    this.scene.add(treeLeaves);
    locationRegistry.register('park', new THREE.Vector3(0, 0, 20));

    // West Coffee Shop
    const coffeeShop = new THREE.Mesh(new THREE.BoxGeometry(15, 8, 15), new THREE.MeshStandardMaterial({ color: 0x885533 }));
    coffeeShop.position.set(-30, 4, -20);
    coffeeShop.castShadow = true;
    coffeeShop.receiveShadow = true;
    this.scene.add(coffeeShop);
    locationRegistry.register('coffee-shop', new THREE.Vector3(-30, 0, -10));

    // East Shop
    const shop = new THREE.Mesh(new THREE.BoxGeometry(15, 8, 15), new THREE.MeshStandardMaterial({ color: 0x556688 }));
    shop.position.set(30, 4, -20);
    shop.castShadow = true;
    shop.receiveShadow = true;
    this.scene.add(shop);
    locationRegistry.register('shop', new THREE.Vector3(30, 0, -10));
  }
}
