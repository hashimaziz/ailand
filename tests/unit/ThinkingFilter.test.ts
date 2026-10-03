import { describe, it, expect } from 'vitest';
import { ThinkingFilter } from '../../src/ai/ThinkingFilter';

/** Push `text` in chunks of `size`, mimicking a token stream. */
function stream(text: string, size: number, filter = new ThinkingFilter()): string {
  let out = '';
  for (let i = 0; i < text.length; i += size) {
    out += filter.push(text.slice(i, i + size));
  }
  out += filter.flush();
  return out;
}

describe('ThinkingFilter', () => {
  it('passes ordinary dialogue through untouched', () => {
    expect(stream('Hey! Good to see you around here.', 7)).toBe(
      'Hey! Good to see you around here.',
    );
  });

  it('removes a complete reasoning block', () => {
    const text = '<think>The player asked my name.</think>Hey, good to see you!';
    expect(stream(text, 6)).toBe('Hey, good to see you!');
  });

  it('removes multiple reasoning blocks', () => {
    const text = '<think>one</think>Hello<think>two</think>there';
    expect(stream(text, 4)).toBe('Hellothere');
  });

  it('is insensitive to case and spacing inside the tags', () => {
    expect(stream('< THINK >hidden</Think >shown', 5)).toBe('shown');
  });

  it('handles tags split across chunk boundaries', () => {
    // Chunking lands mid-tag in several places.
    expect(stream('<think>abc</think>visible', 1)).toBe('visible');
    expect(stream('<think>abc</think>visible', 3)).toBe('visible');
    expect(stream('<think>abc</think>visible', 7)).toBe('visible');
  });

  it('never leaks a partial tag to the caller', () => {
    const filter = new ThinkingFilter();
    expect(filter.push('hello <thi')).toBe('hello ');
    expect(filter.push('nk>secret</think>hi')).toBe('hi');
    expect(filter.flush()).toBe('');
  });

  it('drops reasoning when the block is never closed', () => {
    const filter = new ThinkingFilter();
    filter.push('<think>still reasoning and then the token budget ran out');
    expect(filter.isSuppressing).toBe(true);
    expect(filter.flush()).toBe('');
  });

  it('drops a stray closing tag with no opener', () => {
    expect(stream('Hello</think> world', 3)).toBe('Hello world');
  });

  it('drops a dangling partial tag at the end of a stream', () => {
    const filter = new ThinkingFilter();
    expect(filter.push('Goodbye <')).toBe('Goodbye ');
    expect(filter.flush()).toBe('');
  });

  it('emits trailing text buffered after the last tag', () => {
    expect(stream('<think>x</think>final words', 100)).toBe('final words');
  });

  it('produces identical output regardless of chunk size', () => {
    const text =
      '<think>The player seems new here.</think>Hi! I\'m Maria.<think>Should I ask about the shop?</think>What brings you by?';
    const expected = "Hi! I'm Maria.What brings you by?";

    for (const size of [1, 2, 3, 5, 8, 13, 64, 4096]) {
      expect(stream(text, size)).toBe(expected);
    }
  });

  it('does not hold back text that merely contains a less-than sign', () => {
    expect(stream('I think 3 < 5 and 7 > 2, honestly.', 6)).toBe(
      'I think 3 < 5 and 7 > 2, honestly.',
    );
  });

  it('treats a literal think tag written by an NPC as markup, not dialogue', () => {
    // Documented trade-off: an NPC cannot say the word out loud.
    expect(stream('<think>not really a thought</think>visible', 6)).toBe('visible');
  });
});