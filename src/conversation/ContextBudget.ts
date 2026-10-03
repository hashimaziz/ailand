export function truncateToBudget(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  if (maxChars <= 3) {
    return trimmed.slice(0, maxChars);
  }
  return `${trimmed.slice(0, maxChars - 3).trimEnd()}...`;
}

/**
 * Select the newest items that fit a character budget, preserving their original
 * order. Stops at the first item that does not fit, so a large early turn cannot
 * push out the most recent context.
 */
export function takeRecentWithinBudget<T>(
  items: T[],
  maxChars: number,
  format: (item: T) => string,
  separator = '\n',
): T[] {
  const kept: T[] = [];
  let used = 0;

  for (let i = items.length - 1; i >= 0; i--) {
    const line = format(items[i]);
    const nextLen = used === 0 ? line.length : used + separator.length + line.length;
    if (nextLen > maxChars) {
      break;
    }
    kept.unshift(items[i]);
    used = nextLen;
  }

  return kept;
}

export function fitItemsToBudget<T>(
  items: T[],
  maxChars: number,
  format: (item: T) => string,
  separator = '\n',
): { selected: T[]; text: string } {
  const selected: T[] = [];
  const lines: string[] = [];
  let used = 0;

  for (const item of items) {
    const line = format(item);
    const nextLen = used === 0 ? line.length : used + separator.length + line.length;
    if (nextLen > maxChars) {
      break;
    }
    selected.push(item);
    lines.push(line);
    used = nextLen;
  }

  return { selected, text: lines.join(separator) };
}
