import { npcRegistry } from '../npc/NpcRegistry';
import { MemoryProposal, MemoryProposalRecord } from '../memory/MemoryTypes';

const MAX_VISIBLE_ENTRIES = 12;

const DECISION_LABEL: Record<MemoryProposal['decision'], string> = {
  accepted: 'remembered',
  merged: 'merged',
  superseded: 'remembered (supersedes)',
  rejected: 'discarded',
};

/**
 * Developer-facing view of what the memory system decided after a conversation.
 *
 * This is the minimum viable answer to "why does this NPC think that?" — it shows
 * every candidate the model proposed, whether it was kept, and why. It is a
 * deliberate second-tier panel: collapsed and out of the way during play, since
 * the game itself should not read like a developer console.
 */
export class MemoryProposalPanel {
  private root: HTMLElement;
  private listEl: HTMLElement;
  private badgeEl: HTMLElement;
  private count = 0;

  constructor() {
    this.root = document.createElement('details');
    this.root.id = 'memory-panel';
    this.root.className = 'memory-panel';

    const summary = document.createElement('summary');
    summary.className = 'memory-panel__summary';
    summary.textContent = 'Memory';
    this.badgeEl = document.createElement('span');
    this.badgeEl.className = 'memory-panel__badge';
    this.badgeEl.textContent = '0';
    summary.appendChild(this.badgeEl);

    this.listEl = document.createElement('div');
    this.listEl.className = 'memory-panel__list';

    this.root.appendChild(summary);
    this.root.appendChild(this.listEl);
    document.body.appendChild(this.root);

    this.addEntry('Start a conversation to see what each NPC decides to remember.', 'info');
  }

  public append(record: MemoryProposalRecord): void {
    const npc = npcRegistry.get(record.npcId);
    const who = npc?.identity.name ?? record.npcId;

    if (record.error) {
      this.addEntry(`${who}: memory formation failed — ${record.error}`, 'error');
      return;
    }
    if (record.skipped) {
      this.addEntry(`${who}: ${record.skipped}`, 'info');
      return;
    }
    if (record.proposals.length === 0) {
      this.addEntry(`${who}: nothing worth remembering.`, 'info');
      return;
    }

    for (const proposal of record.proposals) {
      const reasons = proposal.reasons.length > 0 ? ` (${proposal.reasons.join('; ')})` : '';
      this.addEntry(
        `${who} · ${DECISION_LABEL[proposal.decision]}: ${proposal.candidate.content}${reasons}`,
        proposal.decision === 'rejected' ? 'rejected' : 'accepted',
      );
    }
  }

  private addEntry(text: string, kind: 'accepted' | 'rejected' | 'error' | 'info'): void {
    const entry = document.createElement('p');
    entry.className = `memory-panel__entry memory-panel__entry--${kind}`;
    entry.textContent = text;
    this.listEl.insertBefore(entry, this.listEl.firstChild);

    while (this.listEl.childElementCount > MAX_VISIBLE_ENTRIES) {
      this.listEl.removeChild(this.listEl.lastElementChild!);
    }

    if (kind !== 'info') {
      this.count++;
      this.badgeEl.textContent = String(this.count);
    }
  }
}
