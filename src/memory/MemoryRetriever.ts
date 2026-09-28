import { Memory } from './types';

export interface MemoryQuery {
  npcId: string;
  playerMessage: string;
  currentLocationId?: string;
  mentionedEntities: string[];
  currentTime: number;
}

export interface MemoryMatch {
  memory: Memory;
  score: number;
  reasons: string[];
}

export class MemoryRetriever {
  public retrieve(query: MemoryQuery, allMemories: Memory[]): MemoryMatch[] {
    const matches: MemoryMatch[] = [];
    
    for (const mem of allMemories) {
      let score = 0;
      const reasons: string[] = [];

      // Recency
      const ageHours = (query.currentTime - mem.createdAt) / 3600;
      if (ageHours < 24) {
        score += 0.15;
        reasons.push('recent');
      }

      // Importance
      score += mem.importance * 0.20;
      if (mem.importance > 0.7) reasons.push('important');

      // Location match
      if (query.currentLocationId && mem.locationId === query.currentLocationId) {
        score += 0.10;
        reasons.push('location_match');
      }

      // Entity match
      let entityOverlap = 0;
      for (const entity of query.mentionedEntities) {
        if (mem.entities.includes(entity)) {
          entityOverlap++;
        }
      }
      if (entityOverlap > 0) {
        score += 0.30;
        reasons.push('entity_match');
      }

      matches.push({ memory: mem, score, reasons });
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 10); // Return top 10
  }
}
