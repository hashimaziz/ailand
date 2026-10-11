import { Memory } from './types';

export interface MemoryQuery {
  npcId: string;
  playerMessage: string;
  currentLocationId?: string;
  mentionedEntities: string[];
  currentTime: number;
}

/**
 * A memory must score at least this to be offered to the model.
 *
 * Every memory earns some importance and recency score whether or not it is
 * about the current message, so without a floor a large memory store fills every
 * prompt with unrelated material.
 */
export const MIN_RELEVANCE = 0.3;

export interface MemoryMatch {
  memory: Memory;
  score: number;
  reasons: string[];
}

export interface RetrieveOptions {
  /** Highest-scoring memories to return. */
  limit?: number;
  /** Score below which a memory is considered irrelevant to this message. */
  minScore?: number;
}

export class MemoryRetriever {
  public retrieve(
    query: MemoryQuery,
    allMemories: Memory[],
    options: RetrieveOptions = {},
  ): MemoryMatch[] {
    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? MIN_RELEVANCE;
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

    // Drop the tail that matched nothing at all. Without a floor, every memory an
    // NPC owns is injected into every prompt, and the recall note restates the
    // top two — so unrelated memories would be read out as if they were the
    // current topic.
    const relevant = matches.filter((m) => m.score >= minScore);
    return relevant.slice(0, limit);
  }
}
