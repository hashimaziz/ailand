import { MODEL_CONFIGS, getModelConfig, dtypeNote, resolveModelConfig } from '../ai/ModelConfig';
import { LauncherStatus } from '../ai/llamaLauncher';
import { CapabilityReport, formatBytes, gpuBudgetWarnings } from '../ai/ModelCapabilities';
import { ProgressEvent } from '../ai/LanguageModel';
import {
  AppConfig,
  AiSource,
  DEFAULT_LLAMA_SERVER_URL,
  InferDevice,
  ModelRuntime,
  RenderBackend,
} from '../config/appConfig';

export interface StartupScreenHandlers {
  /** Called when the llama.cpp runtime is selected, to check the server. */
  probeLlama?: (url: string) => Promise<boolean>;
}

export interface ModelChoice {
  key: string;
  id: string;
  dtype: string;
  device: string;
  /** Approximate download size in megabytes, for setting expectations. */
  approxMb: number;
}

/**
 * Approximate weight-file sizes in megabytes, verified against the Hugging Face
 * API. Keyed by model id and dtype, because the CPU build is a different file and
 * a different size — int4 quantisation produces a *larger* file than q4f16.
 */
const APPROX_WEIGHT_MB: Record<string, number> = {
  'onnx-community/Qwen3-0.6B-ONNX|q4f16': 543,
  'onnx-community/Qwen3-0.6B-ONNX|q4': 877,
  'onnx-community/Qwen3-1.7B-ONNX|q4f16': 1360,
  'onnx-community/Qwen3-1.7B-ONNX|q4': 2048,
  'onnx-community/SmolLM2-360M-Instruct-ONNX|q4f16': 260,
  'onnx-community/SmolLM2-360M-Instruct-ONNX|q4': 369,
};

export function modelChoices(device: 'webgpu' | 'wasm' = 'webgpu'): ModelChoice[] {
  return Object.keys(MODEL_CONFIGS).map((key) => {
    const config = resolveModelConfig(key, device);
    return {
      key,
      id: config.id,
      dtype: config.dtype ?? 'default',
      device: config.device,
      approxMb: APPROX_WEIGHT_MB[`${config.id}|${config.dtype}`] ?? 0,
    };
  });
}

const AI_SOURCE_LABELS: Record<AiSource, string> = {
  auto: 'Automatic — local model if this browser supports it, otherwise mock',
  local: 'Local model — download it, and fail if this browser cannot run it',
  mock: 'Mock — no download, fixed replies, for UI work and tests',
};

function formatMb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(0)} MB`;
}

/**
 * The screen shown before the game starts.
 *
 * Two phases. First choose a configuration; then, if a real model needs to be
 * fetched, download it here — with byte-level progress and a real failure state —
 * before the world loads. Downloading from inside the game meant a blank or
 * frozen-looking world and an indefinite "Loading AI" with no way to tell whether
 * it was working.
 */
export class StartupScreen {
  public readonly root: HTMLElement;
  private formEl: HTMLElement;
  private loadingEl: HTMLElement;
  private barEl: HTMLElement;
  private barFill: HTMLElement;
  private barLabel: HTMLElement;
  private statusEl: HTMLElement;
  private errorEl: HTMLElement;
  private startBtn: HTMLButtonElement;
  private retryBtn: HTMLButtonElement;
  private useMockBtn: HTMLButtonElement;
  private modelSelect: HTMLSelectElement;
  private sourceSelect: HTMLSelectElement;
  private runtimeSelect: HTMLSelectElement;
  private serverUrlInput: HTMLInputElement;
  private llamaModelSelect: HTMLSelectElement;
  private deviceSelect: HTMLSelectElement;
  private renderSelect: HTMLSelectElement;
  private warnEl: HTMLElement;
  private benchInput: HTMLInputElement;
  private noteEl: HTMLElement;

  private onStart: (config: AppConfig) => void;
  private capabilities: CapabilityReport | null = null;

  constructor(
    initial: AppConfig,
    onStart: (config: AppConfig) => void,
    private handlers: StartupScreenHandlers = {},
  ) {
    this.onStart = onStart;
    this.root = document.createElement('div');
    this.root.id = 'startup-screen';
    this.root.innerHTML = `
      <div class="startup">
        <h1 class="startup__title">AI NPC City</h1>
        <p class="startup__tagline">A neighbourhood of persistent characters, with the language model running in your browser.</p>

        <form class="startup__form">
          <label class="startup__field">
            <span class="startup__label">Model runtime</span>
            <select class="startup__select startup__runtime">
              <option value="browser">In this browser (WebGPU or WASM) — no setup</option>
              <option value="llamaServer">Local llama.cpp server — larger models, needs the server running</option>
            </select>
          </label>

          <label class="startup__field startup__field--server">
            <span class="startup__label">llama.cpp server</span>
            <input type="text" class="startup__input startup__server-url" spellcheck="false" />
          </label>

          <label class="startup__field startup__field--server">
            <span class="startup__label">Local model</span>
            <select class="startup__select startup__llama-model"></select>
          </label>

          <label class="startup__field">
            <span class="startup__label">Model</span>
            <select class="startup__select startup__model"></select>
          </label>

          <label class="startup__field">
            <span class="startup__label">Model source</span>
            <select class="startup__select startup__source">
              <option value="auto">${AI_SOURCE_LABELS.auto}</option>
              <option value="local">${AI_SOURCE_LABELS.local}</option>
              <option value="mock">${AI_SOURCE_LABELS.mock}</option>
            </select>
          </label>

          <label class="startup__field">
            <span class="startup__label">Inference</span>
            <select class="startup__select startup__device">
              <option value="auto">Automatic — GPU if available, otherwise CPU</option>
              <option value="webgpu">GPU (WebGPU) — fast, needs GPU memory</option>
              <option value="wasm">CPU (WASM) — slower, works with little GPU memory</option>
            </select>
          </label>

          <label class="startup__field">
            <span class="startup__label">Rendering</span>
            <select class="startup__select startup__render">
              <option value="auto">Automatic — WebGPU with WebGL2 fallback</option>
              <option value="webgl2">WebGL2 — frees the GPU for the model</option>
            </select>
          </label>

          <label class="startup__field startup__field--check">
            <input type="checkbox" class="startup__check startup__bench" />
            <span>Benchmark all models after start (developer tool, downloads each one)</span>
          </label>

          <p class="startup__note"></p>
          <ul class="startup__warnings"></ul>
          <p class="startup__error" role="alert"></p>

          <button type="submit" class="startup__start">Start</button>
        </form>

        <div class="startup__loading">
          <p class="startup__loading-status"></p>
          <div class="startup__bar"><div class="startup__bar-fill"></div></div>
          <p class="startup__bar-label"></p>
          <div class="startup__loading-actions">
            <button type="button" class="startup__retry" hidden>Try again</button>
            <button type="button" class="startup__use-mock" hidden>Use the mock model instead</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);

    const q = <T extends HTMLElement>(selector: string): T =>
      this.root.querySelector(selector) as T;

    this.formEl = q('.startup__form');
    this.loadingEl = q('.startup__loading');
    this.barEl = q('.startup__bar');
    this.barFill = q('.startup__bar-fill');
    this.barLabel = q('.startup__bar-label');
    this.statusEl = q('.startup__loading-status');
    this.errorEl = q('.startup__error');
    this.noteEl = q('.startup__note');
    this.startBtn = q<HTMLButtonElement>('.startup__start');
    this.retryBtn = q<HTMLButtonElement>('.startup__retry');
    this.useMockBtn = q<HTMLButtonElement>('.startup__use-mock');
    this.modelSelect = q<HTMLSelectElement>('.startup__model');
    this.sourceSelect = q<HTMLSelectElement>('.startup__source');
    this.runtimeSelect = q<HTMLSelectElement>('.startup__runtime');
    this.serverUrlInput = q<HTMLInputElement>('.startup__server-url');
    this.llamaModelSelect = q<HTMLSelectElement>('.startup__llama-model');
    this.deviceSelect = q<HTMLSelectElement>('.startup__device');
    this.renderSelect = q<HTMLSelectElement>('.startup__render');
    this.warnEl = q('.startup__warnings');
    this.benchInput = q<HTMLInputElement>('.startup__bench');

    // The loading view is a second phase; it must not show through the form.
    this.loadingEl.hidden = true;

    this.populateModels();
    this.serverUrlInput.value = initial.llamaServerUrl;
    this.runtimeSelect.value = initial.runtime;
    this.modelSelect.value = initial.modelKey;
    this.sourceSelect.value = initial.aiSource;
    this.deviceSelect.value = initial.inferDevice;
    this.renderSelect.value = initial.renderBackend;
    this.benchInput.checked = initial.runBenchmark;
    this.applyRuntimeVisibility();

    for (const el of [
      this.runtimeSelect,
      this.serverUrlInput,
      this.llamaModelSelect,
      this.modelSelect,
      this.sourceSelect,
      this.deviceSelect,
      this.renderSelect,
      this.benchInput,
    ]) {
      el.addEventListener('change', () => {
        // Model sizes depend on the backend, so rebuild the options when it moves.
        if (el === this.runtimeSelect) {
          this.applyRuntimeVisibility();
          this.scheduleProbe();
        }
        if (el === this.serverUrlInput) {
          this.scheduleProbe();
        }
        if (el === this.deviceSelect) {
          const key = this.modelSelect.value;
          this.populateModelsFor(el.value === 'wasm' ? 'wasm' : 'webgpu');
          this.modelSelect.value = key;
        }
        this.renderNote();
      });
    }
    // A text field emits `input` while typing and `change` only on blur. The probe
    // is debounced, so listen to `input` or a typed URL is never re-checked.
    this.serverUrlInput.addEventListener('input', () => this.scheduleProbe());

    this.formEl.addEventListener('submit', (event) => {
      event.preventDefault();
      this.errorEl.textContent = '';
      this.onStart(this.currentConfig());
    });
    this.retryBtn.addEventListener('click', () => {
      this.errorEl.textContent = '';
      this.onStart(this.currentConfig());
    });
    // A failed local load must leave a way forward that does not involve a
    // reload, otherwise the only escape is the browser refresh button.
    this.useMockBtn.addEventListener('click', () => {
      this.errorEl.textContent = '';
      this.sourceSelect.value = 'mock';
      this.onStart(this.currentConfig());
    });

    this.renderNote();
  }

  public setCapabilities(caps: CapabilityReport): void {
    this.capabilities = caps;
    this.renderNote();
  }

  public currentConfig(): AppConfig {
    return {
      modelKey: this.modelSelect.value,
      aiSource: this.sourceSelect.value as AiSource,
      runtime: this.runtimeSelect.value as ModelRuntime,
      llamaServerUrl: this.serverUrlInput.value.trim() || DEFAULT_LLAMA_SERVER_URL,
      llamaModel: this.llamaModelSelect.value,
      inferDevice: this.deviceSelect.value as InferDevice,
      renderBackend: this.renderSelect.value as RenderBackend,
      runBenchmark: this.benchInput.checked,
    };
  }

  /** The server URL and browser-only controls are irrelevant per runtime. */
  private applyRuntimeVisibility(): void {
    const onServer = this.runtimeSelect.value === 'llamaServer';
    (this.serverUrlInput.closest('.startup__field') as HTMLElement).hidden = !onServer;
    for (const selector of ['.startup__source', '.startup__device', '.startup__model']) {
      const field = this.root.querySelector(selector)!.closest('.startup__field') as HTMLElement;
      field.hidden = onServer;
    }
  }

  /** Record whether a local llama.cpp server answered, for the menu note. */
  public setLlamaServerStatus(available: boolean | null): void {
    this.setStatus(available ? 'up' : 'down');
  }

  /**
   * Offer every GGUF the dev server can see.
   *
   * Choosing the model explicitly matters more than it looks: which file loads
   * used to depend on filesystem order, and a 1.5B model behaves very differently
   * from a 3B one. The list is what makes that a decision rather than a surprise.
   */
  public setAvailableLlamaModels(models: string[], selected?: string): void {
    const current = selected ?? this.llamaModelSelect.value;
    this.llamaModelSelect.innerHTML = '';

    const add = (value: string, label: string) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      this.llamaModelSelect.appendChild(option);
    };

    if (models.length === 0) {
      add('', 'No .gguf models found');
      this.llamaModelSelect.disabled = true;
    } else {
      this.llamaModelSelect.disabled = false;
      // Smallest first: a smaller model is the faster default when both are present.
      for (const model of models) add(model, model);
      if (current && models.includes(current)) {
        this.llamaModelSelect.value = current;
      }
    }
    this.renderNote();
  }

  private llamaServerStatus: 'idle' | 'checking' | 'up' | 'down' = 'idle';
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private probeToken = 0;

  private setStatus(status: typeof this.llamaServerStatus) {
    this.llamaServerStatus = status;
    this.renderNote();
  }

  /**
   * Check the server now.
   *
   * Triggered by selecting the runtime rather than only once at page load: the
   * usual workflow is opening the app, starting the server, then choosing the
   * option — and a single stale probe would still claim it was missing.
   */
  private scheduleProbe(): void {
    if (this.handlers.probeLlama === undefined) return;
    if (this.runtimeSelect.value !== 'llamaServer') return;

    this.setStatus('checking');

    if (this.probeTimer !== null) clearTimeout(this.probeTimer);
    const token = ++this.probeToken;
    const url = this.serverUrlInput.value.trim() || DEFAULT_LLAMA_SERVER_URL;

    // Debounced so typing a URL probes once the user stops, not per keystroke.
    this.probeTimer = setTimeout(async () => {
      const available = await this.handlers.probeLlama!(url);
      // A slower earlier probe must not overwrite a newer result.
      if (token !== this.probeToken) return;
      this.setStatus(available ? 'up' : 'down');
    }, 350);
  }

  /**
   * Switch to a loading view worded for a server launch rather than a download.
   *
   * Same phase as the model download, different story: there is nothing to fetch
   * here, the server is being started.
   */
  public showServerStart(): void {
    this.showLoading('Starting the llama.cpp server…');
  }

  public updateServerStatus(status: LauncherStatus): void {
    const detail = status.log.at(-1);
    switch (status.state) {
      case 'starting':
        this.statusEl.textContent = detail
          ? `Starting the llama.cpp server… ${detail}`
          : 'Starting the llama.cpp server…';
        this.setProgress(null);
        break;
      case 'ready':
        this.statusEl.textContent = 'Server ready. Connecting…';
        this.setProgress(null);
        break;
      case 'error':
        this.statusEl.textContent = status.message ?? 'The llama.cpp server failed to start.';
        this.setProgress(null);
        break;
      default:
        this.statusEl.textContent = 'Waiting for the llama.cpp server…';
        this.setProgress(null);
        break;
    }
  }

  /** Switch from the settings form to the download/progress view. */
  public showLoading(message: string): void {
    this.formEl.hidden = true;
    (this.root.querySelector('.startup__tagline') as HTMLElement).hidden = true;
    this.loadingEl.hidden = false;
    this.retryBtn.hidden = true;
    this.useMockBtn.hidden = true;
    this.statusEl.textContent = message;
    this.barEl.hidden = false;
    this.setProgress(null);
  }

  public updateProgress(event: ProgressEvent): void {
    const label = describeProgress(event);
    if (label) this.statusEl.textContent = label;

    if (event.phase === 'download' && typeof event.totalBytes === 'number' && event.totalBytes > 0) {
      const loaded = event.loadedBytes ?? 0;
      this.setProgress(
        loaded / event.totalBytes,
        formatMb(loaded),
        formatMb(event.totalBytes),
      );
    } else if (event.phase === 'load' || event.phase === 'initialize') {
      // Indeterminate: graph compilation has no byte counts to show.
      this.setProgress(null, event.phase === 'load' ? 'Preparing model files' : 'Compiling for your GPU');
    }
  }

  public showError(message: string): void {
    this.formEl.hidden = false;
    (this.root.querySelector('.startup__tagline') as HTMLElement).hidden = false;
    this.loadingEl.hidden = true;
    this.errorEl.textContent = message;
    this.startBtn.textContent = 'Start';
  }

  public showLoadingError(message: string): void {
    this.errorEl.textContent = '';
    this.statusEl.textContent = message;
    // A stalled bar under an error message reads as "still working".
    this.barEl.hidden = true;
    this.barLabel.textContent = '';
    this.retryBtn.hidden = false;
    // Only worth offering when the mock is not already what failed.
    this.useMockBtn.hidden = this.currentConfig().aiSource === 'mock';
    this.startBtn.disabled = false;
  }

  public destroy(): void {
    this.root.remove();
  }

  private populateModels(): void {
    this.populateModelsFor(this.deviceSelect?.value === 'wasm' ? 'wasm' : 'webgpu');
  }

  private populateModelsFor(device: 'webgpu' | 'wasm'): void {
    // Replace, never append: this runs again whenever the backend changes, and
    // appending would leave both backends' options in the list.
    this.modelSelect.innerHTML = '';
    for (const choice of modelChoices(device)) {
      const option = document.createElement('option');
      option.value = choice.key;
      const size = choice.approxMb > 0 ? `~${choice.approxMb} MB` : 'no download';
      option.textContent = `${choice.id} · ${choice.dtype}/${choice.device} · ${size}`;
      this.modelSelect.appendChild(option);
    }
  }

  private setProgress(
    fraction: number | null,
    loaded?: string,
    total?: string,
  ): void {
    if (fraction === null) {
      this.barFill.classList.add('startup__bar-fill--indeterminate');
      this.barFill.style.width = '';
      this.barLabel.textContent = '';
      return;
    }
    this.barFill.classList.remove('startup__bar-fill--indeterminate');
    const pct = Math.max(0, Math.min(1, fraction));
    this.barFill.style.width = `${(pct * 100).toFixed(1)}%`;
    this.barLabel.textContent = loaded && total ? `${loaded} / ${total}` : `${(pct * 100).toFixed(0)}%`;
  }

  /** Explain what the current selection will actually do, and what might go wrong. */
  private renderNote(): void {
    const config = this.currentConfig();
    const notes: string[] = [];
    const warnings: string[] = [];

    if (config.runtime === 'llamaServer') {
      notes.push(
        `Talks to a llama.cpp server at ${config.llamaServerUrl}. The server supplies the model, so no download happens here.`,
      );
      const status =
        this.llamaServerStatus === 'checking'
          ? 'checking…'
          : this.llamaServerStatus === 'up'
            ? 'connected'
            : this.llamaServerStatus === 'down'
              ? 'not responding'
              : 'not checked';
      notes.push(`Server status: ${status}.`);

      if (this.llamaServerStatus === 'down') {
        warnings.push(
          `No llama.cpp server answered at ${config.llamaServerUrl}. Start one (docs/development.md) — this screen re-checks automatically — or use the in-browser runtime.`,
        );
      }
      if (config.runBenchmark) {
        warnings.push('Benchmarking uses the in-browser models; the llama.cpp runtime is not benchmarked.');
      }
      this.noteEl.textContent = notes.join(' ');
      this.renderWarnings(warnings);
      return;
    }

    const cpuRequested = config.inferDevice === 'wasm';
    const choice = modelChoices(cpuRequested ? 'wasm' : 'webgpu').find(
      (c) => c.key === config.modelKey,
    );

    if (config.aiSource === 'mock') {
      notes.push('Mock model: replies are scripted and no model is downloaded. Memory still forms.');
    } else if (cpuRequested) {
      notes.push(
        `Runs on the CPU. Expect noticeably slower replies, but it does not need GPU memory. ${
          choice?.approxMb ? `Downloads ~${choice.approxMb} MB on first run.` : ''
        }`.trim(),
      );
      const note = dtypeNote(config.modelKey, 'wasm');
      if (note) notes.push(note);
    } else if (config.aiSource === 'local') {
      notes.push(
        `Downloads ~${choice?.approxMb ?? 0} MB on first run, then the browser caches it.`,
      );
      if (this.capabilities && !this.capabilities.webgpu) {
        notes.push(
          'Warning: this browser reports no WebGPU adapter, so a GPU run will probably fail. Automatic or CPU is safer.',
        );
      }
    } else if (this.capabilities && !this.capabilities.webgpu) {
      notes.push(
        `No WebGPU adapter here, so this will use the mock model. ${this.capabilities.reason ?? ''}`.trim(),
      );
    } else {
      notes.push(
        `Uses ${choice?.id ?? config.modelKey}, downloading ~${choice?.approxMb ?? 0} MB on first run.`,
      );
    }

    if (this.capabilities) {
      warnings.push(...this.capabilities.warnings);
      if (config.aiSource !== 'mock' && !cpuRequested) {
        warnings.push(
          ...gpuBudgetWarnings(this.capabilities, {
            weightMb: choice?.approxMb ?? 0,
            rendererUsesWebGpu: config.renderBackend !== 'webgl2',
          }),
        );
      }
    }

    if (config.renderBackend === 'webgl2' && config.aiSource !== 'mock') {
      notes.push('Rendering uses WebGL2, leaving the GPU to the model.');
    }

    if (config.runBenchmark) {
      notes.push('Benchmark mode will download every candidate model in turn.');
    }

    this.noteEl.textContent = notes.join(' ');
    this.renderWarnings(warnings);
  }

  private renderWarnings(warnings: string[]): void {
    this.warnEl.innerHTML = '';
    for (const warning of warnings) {
      const item = document.createElement('li');
      item.className = 'startup__warning';
      item.textContent = warning;
      this.warnEl.appendChild(item);
    }
    this.warnEl.hidden = warnings.length === 0;
  }

  /** Human-readable summary of the GPU this browser would use. */
  public adapterSummary(): string | null {
    const adapter = this.capabilities?.adapter;
    if (!adapter) return null;
    const parts: string[] = [];
    if (adapter.description) parts.push(adapter.description);
    if (adapter.maxBufferSize) parts.push(`max buffer ${formatBytes(adapter.maxBufferSize)}`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }
}

function describeProgress(event: ProgressEvent): string {
  switch (event.phase) {
    case 'download':
      return event.message ?? 'Downloading model…';
    case 'load':
      return 'Model downloaded. Loading…';
    case 'initialize':
      return 'Compiling model for your GPU…';
    default:
      return '';
  }
}

/** Exposed for tests: the config a given model key implies. */
export function describeModel(key: string): string {
  const config = getModelConfig(key);
  return `${config.id} · ${config.dtype ?? 'default'}/${config.device}`;
}