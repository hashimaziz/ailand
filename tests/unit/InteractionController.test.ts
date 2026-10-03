import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pickInteractionTarget, Interactable } from '../../src/player/InteractionController';

const OPTIONS = { maxDistance: 4, maxAngle: 0.25 };

function npc(id: string, x: number, z: number, y = 0.8): Interactable {
  return { id, type: 'npc', name: id, position: new THREE.Vector3(x, y, z) };
}

function look(px: number, pz: number, dx: number, dz: number) {
  return {
    cameraPosition: { x: px, y: 1.6, z: pz },
    cameraDirection: { x: dx, y: 0, z: dz },
  };
}

describe('pickInteractionTarget', () => {
  it('finds an NPC directly ahead', () => {
    const result = pickInteractionTarget(
      { ...look(0, 0, 0, -1), targets: [npc('maria', 0, -2)] },
      OPTIONS,
    );
    expect(result?.id).toBe('maria');
  });

  it('still finds an NPC when standing right on top of them', () => {
    // Regression: the target sits at knee height, so a 3D angle check put a
    // close NPC outside the cone and the prompt refused to appear.
    const result = pickInteractionTarget(
      { ...look(0, 0, 0, -1), targets: [npc('maria', 0, -0.5)] },
      OPTIONS,
    );
    expect(result?.id).toBe('maria');
  });

  it('finds an NPC while looking slightly downward at them', () => {
    const result = pickInteractionTarget(
      {
        cameraPosition: { x: 0, y: 1.6, z: 0 },
        cameraDirection: { x: 0, y: -0.6, z: -0.8 },
        targets: [npc('maria', 0, -2)],
      },
      OPTIONS,
    );
    expect(result?.id).toBe('maria');
  });

  it('finds an NPC while looking upward', () => {
    const result = pickInteractionTarget(
      {
        cameraPosition: { x: 0, y: 1.6, z: 0 },
        cameraDirection: { x: 0, y: 0.5, z: -0.86 },
        targets: [npc('maria', 0, -2)],
      },
      OPTIONS,
    );
    expect(result?.id).toBe('maria');
  });

  it('ignores an NPC behind the player', () => {
    const result = pickInteractionTarget(
      { ...look(0, 0, 0, -1), targets: [npc('maria', 0, 2)] },
      OPTIONS,
    );
    expect(result).toBeNull();
  });

  it('ignores an NPC too far away, however well aligned', () => {
    const result = pickInteractionTarget(
      { ...look(0, 0, 0, -1), targets: [npc('maria', 0, -10)] },
      OPTIONS,
    );
    expect(result).toBeNull();
  });

  it('ignores an NPC outside the facing cone', () => {
    // 60 degrees off to the side.
    const result = pickInteractionTarget(
      { ...look(0, 0, 0, -1), targets: [npc('maria', 3, -0.5)] },
      OPTIONS,
    );
    expect(result).toBeNull();
  });

  it('prefers the nearest of several candidates', () => {
    const result = pickInteractionTarget(
      { ...look(0, 0, 0, -1), targets: [npc('far', 0, -3.5), npc('near', 0, -1)] },
      OPTIONS,
    );
    expect(result?.id).toBe('near');
  });

  it('does not depend on the order candidates arrive in', () => {
    const forward = [npc('far', 0, -3.5), npc('near', 0, -1)];
    const reversed = [...forward].reverse();
    expect(pickInteractionTarget({ ...look(0, 0, 0, -1), targets: forward }, OPTIONS)?.id).toBe('near');
    expect(pickInteractionTarget({ ...look(0, 0, 0, -1), targets: reversed }, OPTIONS)?.id).toBe('near');
  });

  it('returns null with nothing in range', () => {
    expect(pickInteractionTarget({ ...look(0, 0, 0, -1), targets: [] }, OPTIONS)).toBeNull();
  });

  it('returns null when the look direction is degenerate', () => {
    expect(
      pickInteractionTarget({ ...look(0, 0, 0, 0), targets: [npc('maria', 0, -1)] }, OPTIONS),
    ).toBeNull();
  });
});