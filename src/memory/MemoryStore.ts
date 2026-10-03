import { Memory } from './types';
import { db } from '../persistence/Database';
import { generateId } from '../utils/ids';

/**
 * Memories that a newer memory has superseded stay on disk with their
 * provenance intact, but must not be presented to the model as current belief.
 */
export function applySupersession(memories: Memory[]): Memory[] {
  const supersededIds = new Set(
    memories.map((m) => m.supersedesId).filter((id): id is string => Boolean(id)),
  );
  if (supersededIds.size === 0) return memories;
  return memories.filter((m) => !supersededIds.has(m.id));
}

export class MemoryStore {
  public async addMemory(memoryInput: Omit<Memory, 'id'>): Promise<Memory> {
    const memory: Memory = {
      ...memoryInput,
      id: generateId('mem_'),
    };
    await db.saveMemory(memory);
    return memory;
  }

  public async getMemories(npcId: string): Promise<Memory[]> {
    return db.getMemoriesForNpc(npcId);
  }

  /** Persist an in-place change to an existing memory. */
  public async save(memory: Memory): Promise<void> {
    await db.saveMemory(memory);
  }

  /** Memories that are still the NPC's current understanding. */
  public async getActiveMemories(npcId: string): Promise<Memory[]> {
    return applySupersession(await this.getMemories(npcId));
  }
}

export const memoryStore = new MemoryStore();
