import { Memory } from './types';

export class MemoryValidator {
  public validate(candidate: Partial<Memory>): string[] {
    const errors: string[] = [];
    
    if (!candidate.content || candidate.content.trim().length === 0) {
      errors.push('Content is empty');
    }
    if (candidate.content && candidate.content.length > 500) {
      errors.push('Content exceeds size limit');
    }
    if (candidate.importance === undefined || candidate.importance < 0 || candidate.importance > 1) {
      errors.push('Importance must be between 0 and 1');
    }
    if (!candidate.type || !['fact', 'episodic', 'belief', 'rumor', 'relationship'].includes(candidate.type)) {
      errors.push('Invalid memory type');
    }
    if (!candidate.source || !['world', 'player', 'npc', 'observation', 'inference'].includes(candidate.source)) {
      errors.push('Invalid memory source');
    }
    if (candidate.type === 'fact' && candidate.source !== 'world') {
      errors.push('Only world source can assert a canonical fact');
    }
    
    return errors;
  }

  public isDuplicate(candidate: Partial<Memory>, existingMemories: Memory[]): boolean {
    for (const mem of existingMemories) {
      if (mem.content === candidate.content && mem.type === candidate.type) {
        return true;
      }
    }
    return false;
  }
}
