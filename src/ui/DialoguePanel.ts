import { ConversationPhase } from '../conversation/ConversationTypes';

export interface DialoguePanelHandlers {
  onSend: (message: string) => void;
  onClose: () => void;
  onCancelGeneration: () => void;
  onRetryModel?: () => void;
}

export class DialoguePanel {
  public readonly root: HTMLElement;
  private nameEl: HTMLElement;
  private transcriptEl: HTMLElement;
  private npcBubbleEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private cancelBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private statusEl: HTMLElement;
  private noticeEl: HTMLElement;
  private errorEl: HTMLElement;
  private retryBtn: HTMLButtonElement;
  private handlers: DialoguePanelHandlers;
  private npcName = '';
  private streamingNpc = '';

  constructor(handlers: DialoguePanelHandlers) {
    this.handlers = handlers;
    this.root = document.createElement('div');
    this.root.id = 'dialogue-panel';
    this.root.innerHTML = `
      <div class="dialogue-panel__inner">
        <header class="dialogue-panel__header">
          <h2 class="dialogue-panel__name"></h2>
          <button type="button" class="dialogue-panel__close" aria-label="Close conversation">×</button>
        </header>
        <div class="dialogue-panel__transcript"></div>
        <div class="dialogue-panel__npc-line" aria-live="polite"></div>
        <p class="dialogue-panel__notice"></p>
        <p class="dialogue-panel__status"></p>
        <p class="dialogue-panel__error" role="alert"></p>
        <div class="dialogue-panel__composer">
          <textarea rows="2" placeholder="Say something..." aria-label="Message to NPC"></textarea>
          <div class="dialogue-panel__actions">
            <button type="button" class="dialogue-panel__cancel">Cancel reply</button>
            <button type="button" class="dialogue-panel__retry">Retry model load</button>
            <button type="button" class="dialogue-panel__send">Send</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.nameEl = this.root.querySelector('.dialogue-panel__name')!;
    this.transcriptEl = this.root.querySelector('.dialogue-panel__transcript')!;
    this.npcBubbleEl = this.root.querySelector('.dialogue-panel__npc-line')!;
    this.inputEl = this.root.querySelector('textarea')!;
    this.sendBtn = this.root.querySelector('.dialogue-panel__send')!;
    this.cancelBtn = this.root.querySelector('.dialogue-panel__cancel')!;
    this.closeBtn = this.root.querySelector('.dialogue-panel__close')!;
    this.statusEl = this.root.querySelector('.dialogue-panel__status')!;
    this.noticeEl = this.root.querySelector('.dialogue-panel__notice')!;
    this.errorEl = this.root.querySelector('.dialogue-panel__error')!;
    this.retryBtn = this.root.querySelector('.dialogue-panel__retry')!;

    this.closeBtn.addEventListener('click', () => this.handlers.onClose());
    this.sendBtn.addEventListener('click', () => this.submit());
    this.cancelBtn.addEventListener('click', () => this.handlers.onCancelGeneration());
    this.retryBtn.addEventListener('click', () => this.handlers.onRetryModel?.());

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible()) {
        this.handlers.onClose();
      }
    });

    this.hide();
  }

  public open(npcName: string) {
    this.npcName = npcName;
    this.nameEl.textContent = npcName;
    this.transcriptEl.innerHTML = '';
    this.npcBubbleEl.textContent = '';
    this.streamingNpc = '';
    this.clearError();
    this.clearNotice();
    this.root.style.display = 'flex';
    this.inputEl.disabled = false;
    this.inputEl.focus();
    this.setPhase('ready');
  }

  public hide() {
    this.root.style.display = 'none';
  }

  public isVisible(): boolean {
    return this.root.style.display !== 'none';
  }

  public appendPlayerLine(text: string) {
    if (this.streamingNpc) {
      this.appendNpcLine(this.streamingNpc);
    }
    const line = document.createElement('p');
    line.className = 'dialogue-panel__line dialogue-panel__line--player';
    line.textContent = `You: ${text}`;
    this.transcriptEl.appendChild(line);
    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
  }

  public appendNpcLine(text: string) {
    this.streamingNpc = '';
    this.npcBubbleEl.textContent = '';
    const line = document.createElement('p');
    line.className = 'dialogue-panel__line dialogue-panel__line--npc';
    line.textContent = `${this.npcName}: ${text}`;
    this.transcriptEl.appendChild(line);
    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
  }

  public appendStreamToken(text: string) {
    this.streamingNpc += text;
    this.npcBubbleEl.textContent = `${this.npcName}: ${this.streamingNpc}`;
  }

  public setPhase(phase: ConversationPhase) {
    if (phase !== 'error') {
      this.errorEl.textContent = '';
      this.retryBtn.style.display = 'none';
    }

    const generating = phase === 'generating';
    const loading = phase === 'loading_model';
    this.inputEl.disabled = generating || loading;
    this.sendBtn.disabled = generating || loading;
    this.cancelBtn.style.display = generating ? 'inline-block' : 'none';

    switch (phase) {
      case 'loading_model':
        this.statusEl.textContent = 'Loading local language model…';
        break;
      case 'generating':
        this.statusEl.textContent = 'Thinking…';
        break;
      case 'error':
        this.statusEl.textContent = '';
        break;
      case 'ready':
      case 'idle':
      default:
        this.statusEl.textContent = '';
        break;
    }
  }

  public showError(message: string, options?: { showRetry?: boolean }) {
    this.errorEl.textContent = message;
    this.retryBtn.style.display = options?.showRetry ? 'inline-block' : 'none';
    this.setPhase('error');
  }

  /** Explain why the composer is unavailable, without implying an error. */
  public showNotice(message: string): void {
    this.noticeEl.textContent = message;
  }

  public clearNotice(): void {
    this.noticeEl.textContent = '';
  }

  public clearError() {
    this.errorEl.textContent = '';
    this.retryBtn.style.display = 'none';
  }

  private submit() {
    const text = this.inputEl.value.trim();
    if (!text) return;
    this.inputEl.value = '';
    this.appendPlayerLine(text);
    this.handlers.onSend(text);
  }

}
