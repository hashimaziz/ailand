export type MemorySource = 'world' | 'player' | 'npc' | 'observation' | 'inference';
export type MemoryType = 'fact' | 'episodic' | 'belief' | 'rumor' | 'relationship';

export interface Memory {
  id: string;
  npcId: string;
  type: MemoryType;
  content: string;
  importance: number;      // 0..1
  confidence: number;      // 0..1
  source: MemorySource;
  entities: string[];
  locationId?: string;
  createdAt: number;
  lastAccessedAt: number;
  supersedesId?: string;
}
