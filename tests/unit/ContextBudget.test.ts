import { describe, it, expect } from 'vitest';
import {
  fitItemsToBudget,
  takeRecentWithinBudget,
  truncateToBudget,
} from '../../src/conversation/ContextBudget';

describe('truncateToBudget', () => {
  it('leaves text within budget untouched', () => {
    expect(truncateToBudget('  hello  ', 100)).toBe('hello');
  });

  it('marks truncated text with an ellipsis', () => {
    const result = truncateToBudget('abcdefghij', 6);
    expect(result.length).toBeLessThanOrEqual(6);
    expect(result.endsWith('...')).toBe(true);
  });

  it('degrades safely for degenerate budgets', () => {
    expect(truncateToBudget('abcdef', 2)).toBe('ab');
  });
});

describe('takeRecentWithinBudget', () => {
  it('keeps the newest items that fit, in original order', () => {
    const items = ['aaa', 'bbbb', 'cc', 'dddd'];
    // 'dddd' (4) + '\n' + 'cc' (2) = 7, adding 'bbbb' would exceed 8.
    expect(takeRecentWithinBudget(items, 8, (i) => i)).toEqual(['cc', 'dddd']);
  });

  it('returns nothing when the newest item alone does not fit', () => {
    expect(takeRecentWithinBudget(['aaaaaaaaaa'], 4, (i) => i)).toEqual([]);
  });

  it('keeps everything when the budget is generous', () => {
    const items = ['one', 'two', 'three'];
    expect(takeRecentWithinBudget(items, 500, (i) => i)).toEqual(items);
  });

  it('accounts for the separator between items', () => {
    // Two 3-char items joined by a newline cost 7 characters, not 6.
    expect(takeRecentWithinBudget(['aaa', 'bbb'], 6, (i) => i)).toEqual(['bbb']);
    expect(takeRecentWithinBudget(['aaa', 'bbb'], 7, (i) => i)).toEqual(['aaa', 'bbb']);
  });
});

describe('fitItemsToBudget', () => {
  it('returns both the selected items and their rendered text', () => {
    const items = [
      { label: 'first' },
      { label: 'second' },
      { label: 'third' },
    ];
    const { selected, text } = fitItemsToBudget(items, 20, (i) => `- ${i.label}`);

    expect(selected.map((s) => s.label)).toEqual(['first', 'second']);
    expect(text).toBe('- first\n- second');
  });

  it('stops at the first item that overflows the budget', () => {
    const items = ['a', 'this-one-is-far-too-long', 'b'];
    const { selected } = fitItemsToBudget(items, 10, (i) => i);
    expect(selected).toEqual(['a']);
  });
});
