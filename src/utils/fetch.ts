/**
 * An abort signal that fires after `ms`.
 *
 * `AbortSignal.timeout` is missing from older Safari and from jsdom. Calling it
 * unguarded throws a TypeError that is easy to swallow inside a `try`, which is
 * how a launcher probe once reported "unsupported" on a perfectly capable server.
 */
export function timeoutSignal(ms: number): { signal: AbortSignal; done: () => void } {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(ms), done: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
