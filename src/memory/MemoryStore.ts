import { Memory } from './types';
import { db } from '../persistence/Database';
import { generateId } from '../utils/ids';

export class MemoryStore {
  public async addMemory(memoryInput: Omit<Memory, 'id'>): Promise<Memory> {
    const memory: Memory = {
      ...memoryInput,
      id: generateId('mem_')
    };
    await db.saveMemory(memory);
    return memory;
  }

  public async getMemories(npcId: string): Promise<Memory[]> {
    return db.getMemoriesForNpc(npcId);
  }
}

export const memoryStore = new MemoryStore();
