import { db } from '../persistence/Database';
import { PlayerRelationshipSnapshot } from '../conversation/ConversationTypes';
import { Npc } from './types';
import { defaultPlayerRelationship } from './Relationship';

function relationshipKey(npcId: string): string {
  return `relationship_${npcId}_player`;
}

/**
 * Player relationships live in the generic meta store rather than a dedicated
 * object store: they are a single small snapshot per NPC, and keeping them out of
 * the `npcs` records means a relationship update never rewrites NPC identity data.
 */
export const relationshipStore = {
  async load(npc: Npc): Promise<PlayerRelationshipSnapshot> {
    const saved = await db.loadMeta(relationshipKey(npc.id));
    if (saved && typeof saved === 'object') {
      return saved as PlayerRelationshipSnapshot;
    }
    return defaultPlayerRelationship(npc);
  },

  async save(npcId: string, relationship: PlayerRelationshipSnapshot): Promise<void> {
    await db.saveMeta(relationshipKey(npcId), relationship);
  },
};
