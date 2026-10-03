import { DEFAULT_MODEL_KEY, isKnownModelKey } from '../ai/ModelConfig';

/**
 * Which language model implementation to use.
 *
 * `auto` uses the real model when the browser supports it and falls back to the
 * mock with a visible reason otherwise. `local` skips capability detection and
 * insists on the real model. `mock` never downloads anything.
 */
export type AiSource = 'auto' | 'local' | 'mock';

export interface AppConfig {
  modelKey: string;
  aiSource: AiSource;
  runBenchmark: boolean;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  modelKey: DEFAULT_MODEL_KEY,
  aiSource: 'auto',
  runBenchmark: false,
};

let current: AppConfig = { ...DEFAULT_APP_CONFIG };

export function getConfig(): AppConfig {
  return current;
}

/**
 * Apply a configuration chosen at startup.
 *
 * This is the single source of truth: the startup menu writes here, and the AI
 * runtime reads from here rather than parsing the URL itself. That keeps the
 * question "which model am I actually testing?" answerable from one place.
 */
export function setConfig(next: Partial<AppConfig>): AppConfig {
  current = {
    modelKey: isKnownModelKey(next.modelKey ?? current.modelKey)
      ? (next.modelKey ?? current.modelKey)
      : DEFAULT_APP_CONFIG.modelKey,
    aiSource: next.aiSource ?? current.aiSource,
    runBenchmark: next.runBenchmark ?? current.runBenchmark,
  };
  return current;
}

export function resetConfig(): AppConfig {
  current = { ...DEFAULT_APP_CONFIG };
  return current;
}

/**
 * Resolve configuration from the query string, for automation and for deep links.
 *
 * `?autoStart=1` bypasses the startup menu; the other parameters are folded into
 * the same shape the menu produces, so both entry points converge here.
 */
export function configFromSearch(search: string): Partial<AppConfig> {
  const params = new URLSearchParams(search);
  const modelKey = params.get('model');

  let aiSource: AiSource | undefined;
  if (params.get('mockAi') === '1') aiSource = 'mock';
  else if (params.get('realAi') === '1') aiSource = 'local';

  return {
    ...(isKnownModelKey(modelKey ?? '') ? { modelKey: modelKey as string } : {}),
    ...(aiSource ? { aiSource } : {}),
    ...(params.get('bench') === '1' ? { runBenchmark: true } : {}),
  };
}

/** True when the startup menu should be skipped, for automated runs. */
export function shouldAutoStart(search: string): boolean {
  return new URLSearchParams(search).get('autoStart') === '1';
}

const STORAGE_KEY = 'ai-city.appConfig';

export function loadRememberedConfig(): AppConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APP_CONFIG };
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return setConfig({ ...DEFAULT_APP_CONFIG, ...parsed });
  } catch {
    return { ...DEFAULT_APP_CONFIG };
  }
}

export function rememberConfig(config: AppConfig): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage can be unavailable or full; remembering the choice is a nicety.
  }
}