import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Npc } from '../npc/types';
import { Memory } from '../memory/types';

interface AiCityDB extends DBSchema {
  npcs: {
    key: string;
    value: Npc;
  };
  memories: {
    key: string;
    value: Memory;
    indexes: { 'by-npc': string };
  };
  meta: {
    key: string;
    value: any;
  };
}

export class Database {
  private db!: IDBPDatabase<AiCityDB>;

  public async init() {
    this.db = await openDB<AiCityDB>('ai-city', 1, {
      upgrade(db) {
        db.createObjectStore('npcs', { keyPath: 'id' });
        const memoryStore = db.createObjectStore('memories', { keyPath: 'id' });
        memoryStore.createIndex('by-npc', 'npcId');
        db.createObjectStore('meta');
      },
    });
  }

  public async saveNpc(npc: Npc) {
    await this.db.put('npcs', npc);
  }

  public async loadAllNpcs(): Promise<Npc[]> {
    return this.db.getAll('npcs');
  }

  public async saveMemory(memory: Memory) {
    await this.db.put('memories', memory);
  }

  public async deleteMemory(id: string) {
    await this.db.delete('memories', id);
  }

  public async getMemoriesForNpc(npcId: string): Promise<Memory[]> {
    return this.db.getAllFromIndex('memories', 'by-npc', npcId);
  }

  public async saveMeta(key: string, value: any) {
    await this.db.put('meta', value, key);
  }

  public async loadMeta(key: string): Promise<any> {
    return this.db.get('meta', key);
  }
}

export const db = new Database();
