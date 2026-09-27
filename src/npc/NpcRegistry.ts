import { Npc } from './types';

export class NpcRegistry {
  private npcs = new Map<string, Npc>();

  public register(npc: Npc) {
    this.npcs.set(npc.id, npc);
  }

  public get(id: string): Npc | undefined {
    return this.npcs.get(id);
  }

  public getAll(): Npc[] {
    return Array.from(this.npcs.values());
  }
}

export const npcRegistry = new NpcRegistry();
