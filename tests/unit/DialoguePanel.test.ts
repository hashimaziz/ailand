import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DialoguePanel } from '../../src/ui/DialoguePanel';

describe('DialoguePanel', () => {
  let panel: DialoguePanel;

  beforeEach(() => {
    panel = new DialoguePanel({
      onSend: () => {},
      onClose: () => {},
      onCancelGeneration: () => {},
    });
    panel.open('Maria');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function root(): HTMLElement {
    return document.getElementById('dialogue-panel') as HTMLElement;
  }

  it('opens with the NPC name and clears prior transcript', () => {
    panel.appendNpcLine('Hello');
    panel.open('David');

    expect(root().style.display).toBe('flex');
    expect(root().querySelector('.dialogue-panel__name')?.textContent).toBe('David');
    expect(root().querySelector('.dialogue-panel__transcript')?.innerHTML).toBe('');
  });

  it('keeps the error message visible while in the error phase', () => {
    panel.showError('Local model failed to load.');

    const error = root().querySelector('.dialogue-panel__error');
    expect(error?.textContent).toBe('Local model failed to load.');
    // The player must be able to try again after a failure.
    expect(root().querySelector('textarea')?.disabled).toBe(false);
  });

  it('offers the retry control only when asked', () => {
    panel.showError('nope', { showRetry: true });
    expect(root().querySelector<HTMLElement>('.dialogue-panel__retry')?.style.display).toBe(
      'inline-block',
    );

    panel.showError('nope', { showRetry: false });
    expect(root().querySelector<HTMLElement>('.dialogue-panel__retry')?.style.display).toBe('none');
  });

  it('clears a previous error when a new phase starts', () => {
    panel.showError('transient failure');
    panel.setPhase('ready');

    expect(root().querySelector('.dialogue-panel__error')?.textContent).toBe('');
    expect(root().querySelector<HTMLElement>('.dialogue-panel__retry')?.style.display).toBe('none');
  });

  it('disables input and exposes cancel only while generating', () => {
    panel.setPhase('generating');
    expect(root().querySelector('textarea')?.disabled).toBe(true);
    expect(root().querySelector<HTMLButtonElement>('.dialogue-panel__cancel')?.disabled).toBe(false);
    expect(root().querySelector<HTMLElement>('.dialogue-panel__cancel')?.style.display).toBe(
      'inline-block',
    );

    panel.setPhase('ready');
    expect(root().querySelector('textarea')?.disabled).toBe(false);
    expect(root().querySelector<HTMLElement>('.dialogue-panel__cancel')?.style.display).toBe('none');
  });

  it('disables input while the model is loading', () => {
    panel.setPhase('loading_model');
    expect(root().querySelector('textarea')?.disabled).toBe(true);
  });

  it('streams into the live line then commits it to the transcript', () => {
    panel.appendStreamToken('Good ');
    panel.appendStreamToken('morning.');
    expect(root().querySelector('.dialogue-panel__npc-line')?.textContent).toBe(
      'Maria: Good morning.',
    );
    expect(root().querySelector('.dialogue-panel__transcript')?.innerHTML).toBe('');

    panel.appendNpcLine('Good morning.');
    expect(root().querySelector('.dialogue-panel__npc-line')?.textContent).toBe('');
    expect(root().querySelector('.dialogue-panel__transcript')?.textContent).toBe(
      'Maria: Good morning.',
    );
  });

  it('submits trimmed input once and clears the composer', () => {
    const sent: string[] = [];
    const local = new DialoguePanel({
      onSend: (m) => sent.push(m),
      onClose: () => {},
      onCancelGeneration: () => {},
    });
    local.open('David');

    const input = local.root.querySelector('textarea') as HTMLTextAreaElement;
    input.value = '  hello there  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(sent).toEqual(['hello there']);
    expect(input.value).toBe('');

    // Empty submissions are ignored.
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(sent).toEqual(['hello there']);
  });
});
