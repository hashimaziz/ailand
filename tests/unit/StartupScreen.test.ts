import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_APP_CONFIG,
  configFromSearch,
  getConfig,
  loadRememberedConfig,
  rememberConfig,
  resetConfig,
  setConfig,
  shouldAutoStart,
} from '../../src/config/appConfig';
import { StartupScreen, modelChoices } from '../../src/ui/StartupScreen';

describe('appConfig', () => {
  beforeEach(() => {
    resetConfig();
    window.localStorage.clear();
  });

  it('starts from documented defaults', () => {
    expect(getConfig()).toEqual(DEFAULT_APP_CONFIG);
  });

  it('rejects unknown model keys instead of storing them', () => {
    setConfig({ modelKey: 'not-a-real-model' });
    expect(getConfig().modelKey).toBe(DEFAULT_APP_CONFIG.modelKey);
  });

  it('accepts known model keys', () => {
    setConfig({ modelKey: 'qwen3-1.7b' });
    expect(getConfig().modelKey).toBe('qwen3-1.7b');
  });

  it('preserves untouched fields on a partial update', () => {
    setConfig({ modelKey: 'qwen3-1.7b', aiSource: 'mock' });
    setConfig({ runBenchmark: true });
    expect(getConfig()).toEqual({
      ...DEFAULT_APP_CONFIG,
      modelKey: 'qwen3-1.7b',
      aiSource: 'mock',
      runBenchmark: true,
    });
  });
});

describe('configFromSearch', () => {
  it('maps the legacy parameters onto the same shape as the menu', () => {
    expect(configFromSearch('?mockAi=1')).toEqual({ aiSource: 'mock' });
    expect(configFromSearch('?realAi=1')).toEqual({ aiSource: 'local' });
    expect(configFromSearch('?model=qwen3-1.7b')).toEqual({ modelKey: 'qwen3-1.7b' });
    expect(configFromSearch('?bench=1')).toEqual({ runBenchmark: true });
  });

  it('ignores unknown model keys', () => {
    expect(configFromSearch('?model=nonsense')).toEqual({});
  });

  it('returns nothing for an empty query', () => {
    expect(configFromSearch('')).toEqual({});
  });

  it('lets the menu win over a remembered choice', () => {
    const url = { ...configFromSearch('?model=qwen3-1.7b') };
    const remembered = { ...DEFAULT_APP_CONFIG, aiSource: 'mock' as const };
    expect(setConfig({ ...remembered, ...url }).modelKey).toBe('qwen3-1.7b');
  });

  it('recognises the automation bypass', () => {
    expect(shouldAutoStart('?autoStart=1')).toBe(true);
    expect(shouldAutoStart('')).toBe(false);
  });
});

describe('remembered config', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetConfig();
  });

  it('round-trips through localStorage', () => {
    rememberConfig({
      ...DEFAULT_APP_CONFIG,
      modelKey: 'qwen3-1.7b',
      aiSource: 'local',
      inferDevice: 'wasm',
    });
    expect(loadRememberedConfig()).toEqual({
      ...DEFAULT_APP_CONFIG,
      modelKey: 'qwen3-1.7b',
      aiSource: 'local',
      inferDevice: 'wasm',
    });
  });

  it('falls back to defaults when nothing is stored', () => {
    expect(loadRememberedConfig()).toEqual(DEFAULT_APP_CONFIG);
  });

  it('falls back to defaults when storage holds garbage', () => {
    window.localStorage.setItem('ai-city.appConfig', 'not json');
    expect(loadRememberedConfig()).toEqual(DEFAULT_APP_CONFIG);
  });
});

describe('StartupScreen', () => {
  let screen: StartupScreen;
  let chosen: unknown;

  beforeEach(() => {
    document.body.innerHTML = '';
    resetConfig();
    screen = new StartupScreen({ ...DEFAULT_APP_CONFIG }, (config) => {
      chosen = config;
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function field<T extends HTMLElement = HTMLElement>(selector: string): T {
    return screen.root.querySelector(selector) as T;
  }

  it('lists every candidate with its download size', () => {
    const options = [...screen.root.querySelectorAll('.startup__model option')];
    expect(options.length).toBe(modelChoices().length);
    expect(options[0].textContent).toContain('~543 MB');
  });

  it('re-quotes sizes for the CPU backend, whose build is larger', () => {
    // int4 builds are bigger on disk than q4f16, so the menu must not quote the
    // GPU size while telling the player it is downloading the CPU build.
    expect(modelChoices('wasm').find((c) => c.key === 'qwen3-1.7b')!.approxMb).toBe(2048);
    expect(modelChoices('webgpu').find((c) => c.key === 'qwen3-1.7b')!.approxMb).toBe(1360);
  });

  it('switches the quoted sizes when the inference backend changes', () => {
    field<HTMLSelectElement>('.startup__model').value = 'qwen3-1.7b';
    field<HTMLSelectElement>('.startup__device').value = 'wasm';
    field<HTMLSelectElement>('.startup__device').dispatchEvent(new Event('change'));

    const option = screen.root.querySelector('.startup__model option[value="qwen3-1.7b"]');
    expect(option?.textContent).toContain('~2048 MB');
    // The selection survives the rebuild.
    expect(field<HTMLSelectElement>('.startup__model').value).toBe('qwen3-1.7b');
  });

  it('hides the loading view until it is needed', () => {
    expect(field('.startup__loading').hidden).toBe(true);
    screen.showLoading('Preparing…');
    expect(field('.startup__loading').hidden).toBe(false);
    expect(field('.startup__form').hidden).toBe(true);
  });

  it('never shows the form and the loading view at the same time', () => {
    // The views are flex containers, so `hidden` alone is not enough: a class
    // that sets `display` beats the user-agent rule for [hidden].
    screen.showLoading('Preparing…');
    screen.showLoadingError('failed');
    expect(getComputedStyle(field('.startup__form')).display).toBe('none');
    expect(getComputedStyle(field('.startup__loading')).display).not.toBe('none');
  });

  it('reports the chosen configuration on submit', () => {
    field<HTMLSelectElement>('.startup__model').value = 'qwen3-1.7b';
    field<HTMLSelectElement>('.startup__source').value = 'mock';
    field<HTMLInputElement>('.startup__bench').checked = true;
    field<HTMLFormElement>('.startup__form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    expect(chosen).toEqual({
      ...DEFAULT_APP_CONFIG,
      modelKey: 'qwen3-1.7b',
      aiSource: 'mock',
      runBenchmark: true,
    });
  });

  it('shows byte-level download progress', () => {
    screen.showLoading('Preparing…');
    screen.updateProgress({
      phase: 'download',
      progress: 0.25,
      loadedBytes: 5 * 1048576,
      totalBytes: 20 * 1048576,
      file: 'model_q4f16.onnx',
    });

    expect(field('.startup__bar-fill').style.width).toBe('25%');
    expect(field('.startup__bar-label').textContent).toBe('5 MB / 20 MB');
    // The status follows the phase even when the worker sends no message.
    expect(field('.startup__loading-status').textContent).toBe('Downloading model…');
  });

  it('switches to an indeterminate bar once the weights have arrived', () => {
    screen.showLoading('Preparing…');
    screen.updateProgress({ phase: 'initialize' });

    expect(field('.startup__bar-fill').className).toContain('indeterminate');
    expect(field('.startup__loading-status').textContent).toContain('Compiling');
  });

  it('surfaces a load failure with a retry and stays on the loading view', () => {
    screen.showLoading('Preparing…');
    screen.showLoadingError('Model download stalled after 120s.');

    expect(field('.startup__loading-status').textContent).toContain('stalled');
    expect(field<HTMLButtonElement>('.startup__retry').hidden).toBe(false);
    // The form stays hidden so the player is not sent back to settings silently.
    expect(field('.startup__form').hidden).toBe(true);
  });

  it('offers the mock model as an escape from a failed local load', () => {
    screen.showLoading('Preparing…');
    screen.showLoadingError('Failed to get GPU adapter.');

    field<HTMLButtonElement>('.startup__use-mock').click();
    expect(chosen).toMatchObject({ aiSource: 'mock' });
  });

  it('does not offer the mock when the mock is what failed', () => {
    field<HTMLSelectElement>('.startup__source').value = 'mock';
    screen.showLoading('Preparing…');
    screen.showLoadingError('Something odd.');
    expect(field<HTMLButtonElement>('.startup__use-mock').hidden).toBe(true);
  });

  it('hides recovery actions when a new load starts', () => {
    screen.showLoadingError('failed');
    screen.showLoading('Preparing…');
    expect(field<HTMLButtonElement>('.startup__retry').hidden).toBe(true);
    expect(field<HTMLButtonElement>('.startup__use-mock').hidden).toBe(true);
  });

  it('offers every model the dev server can see', () => {
    screen.setAvailableLlamaModels([
      'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
      'Qwen2.5-3B-Instruct-Q4_K_M.gguf',
    ]);
    const options = [
      ...screen.root.querySelectorAll<HTMLOptionElement>('.startup__llama-model option'),
    ];
    expect(options.map((o) => o.value)).toEqual([
      'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
      'Qwen2.5-3B-Instruct-Q4_K_M.gguf',
    ]);
    expect(screen.root.querySelector<HTMLSelectElement>('.startup__llama-model')!.disabled).toBe(false);

  });

  it('keeps the chosen model across a refresh of the list', () => {
    screen.setAvailableLlamaModels(['a.gguf', 'b.gguf']);
    screen.root.querySelector<HTMLSelectElement>('.startup__llama-model')!.value = 'b.gguf';
    screen.setAvailableLlamaModels(['a.gguf', 'b.gguf']);
    expect(screen.root.querySelector<HTMLSelectElement>('.startup__llama-model')!.value).toBe('b.gguf');
  });

  it('says so plainly when no models are installed', () => {
    screen.setAvailableLlamaModels([]);
    const select = screen.root.querySelector<HTMLSelectElement>('.startup__llama-model')!;
    expect(select.disabled).toBe(true);
    expect(select.options[0].textContent).toContain('No .gguf models found');

  });

  it('includes the selected local model in the reported config', () => {
    screen.setAvailableLlamaModels(['a.gguf', 'b.gguf']);
    screen.root.querySelector<HTMLSelectElement>('.startup__llama-model')!.value = 'b.gguf';
    expect(screen.currentConfig().llamaModel).toBe('b.gguf');
  });

  it('warns that a forced local load will probably fail without WebGPU', () => {
    screen.setCapabilities({
      webgpu: false,
      webgl2: true,
      workers: true,
      indexeddb: true,
      level: 'partial',
      reason: 'WebGPU is unavailable.',
      warnings: [],
    });
    field<HTMLSelectElement>('.startup__source').value = 'local';
    field<HTMLSelectElement>('.startup__source').dispatchEvent(new Event('change'));

    expect(field('.startup__note').textContent).toContain('will probably fail');
  });

  it('returns to settings with the error visible', () => {
    screen.showError('Something went wrong.');
    expect(field('.startup__error').textContent).toBe('Something went wrong.');
    expect(field('.startup__form').hidden).toBe(false);
  });

  it('warns when the browser cannot run the selected model', () => {
    screen.setCapabilities({
      webgpu: false,
      webgl2: true,
      workers: true,
      indexeddb: true,
      level: 'partial',
      reason: 'WebGPU is unavailable.',
      warnings: [],
    });

    expect(field('.startup__note').textContent).toContain('No WebGPU adapter');
  });

  it('states the download size when a local model is chosen', () => {
    field<HTMLSelectElement>('.startup__source').value = 'local';
    field<HTMLSelectElement>('.startup__source').dispatchEvent(new Event('change'));
    expect(field('.startup__note').textContent).toContain('543 MB');
  });

  it('checks the llama.cpp server when its runtime is selected', async () => {
    const probed: string[] = [];
    const live = new StartupScreen(
      { ...DEFAULT_APP_CONFIG },
      () => {},
      {
        probeLlama: async (url) => {
          probed.push(url);
          return true;
        },
      },
    );

    live.root.querySelector<HTMLSelectElement>('.startup__runtime')!.value = 'llamaServer';
    live.root
      .querySelector<HTMLSelectElement>('.startup__runtime')!
      .dispatchEvent(new Event('change'));

    // The note reflects that a check is under way before it resolves.
    expect(live.root.querySelector('.startup__note')!.textContent).toContain('checking');
    await new Promise((r) => setTimeout(r, 450));

    expect(probed).toEqual([DEFAULT_APP_CONFIG.llamaServerUrl]);
    expect(live.root.querySelector('.startup__note')!.textContent).toContain('connected');
    document.body.innerHTML = '';
  });

  it('warns when no llama.cpp server answers', async () => {
    const live = new StartupScreen({ ...DEFAULT_APP_CONFIG }, () => {}, { probeLlama: async () => false });
    const select = live.root.querySelector<HTMLSelectElement>('.startup__runtime')!;
    select.value = 'llamaServer';
    select.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 450));

    const note = live.root.querySelector('.startup__note')!.textContent ?? '';
    expect(note).toContain('not responding');
    expect(live.root.querySelector('.startup__warning')!.textContent).toContain(
      'No llama.cpp server answered',
    );
    document.body.innerHTML = '';
  });

  it('re-checks when the server URL changes', async () => {
    const probed: string[] = [];
    const live = new StartupScreen(
      { ...DEFAULT_APP_CONFIG },
      () => {},
      {
        probeLlama: async (url) => {
          probed.push(url);
          return true;
        },
      },
    );
    const select = live.root.querySelector<HTMLSelectElement>('.startup__runtime')!;
    select.value = 'llamaServer';
    select.dispatchEvent(new Event('change'));

    // Typing fires `input`, not `change`.
    const input = live.root.querySelector<HTMLInputElement>('.startup__server-url')!;
    input.value = 'http://127.0.0.1:9099';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 450));

    expect(probed).toContain('http://127.0.0.1:9099');
    document.body.innerHTML = '';
  });

  it('does not probe while the browser runtime is selected', async () => {
    let calls = 0;
    const live = new StartupScreen(
      { ...DEFAULT_APP_CONFIG },
      () => {},
      { probeLlama: async () => { calls++; return true; } },
    );
    live.root
      .querySelector<HTMLSelectElement>('.startup__source')!
      .dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 450));
    expect(calls).toBe(0);
    document.body.innerHTML = '';
  });

  it('mentions that benchmarking downloads every model', () => {
    field<HTMLInputElement>('.startup__bench').checked = true;
    field<HTMLInputElement>('.startup__bench').dispatchEvent(new Event('change'));
    expect(field('.startup__note').textContent).toContain('every candidate model');
  });
});