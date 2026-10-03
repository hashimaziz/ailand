import { MODEL_CONFIGS, getModelConfig } from '../ai/ModelConfig';
import { CapabilityReport } from '../ai/ModelCapabilities';
import { ProgressEvent } from '../ai/LanguageModel';
import { AppConfig, AiSource } from '../config/appConfig';

export interface ModelChoice {
  key: string;
  id: string;
  dtype: string;
  device: string;
  /** Approximate download size in megabytes, for setting expectations. */
  approxMb: number;
}

/** Verified against the Hugging Face API; q4f16 onnx weight sizes. */
const APPROX_WEIGHT_MB: Record<string, number> = {
  'onnx-community/Qwen3-0.6B-ONNX': 543,
  'onnx-community/Qwen3-1.7B-ONNX': 1360,
  'onnx-community/SmolLM2-360M-Instruct-ONNX': 280,
  'mock-model': 0,
};

export function modelChoices(): ModelChoice[] {
  return Object.entries(MODEL_CONFIGS).map(([key, config]) => ({
    key,
    id: config.id,
    dtype: config.dtype ?? 'default',
    device: config.device,
    approxMb: APPROX_WEIGHT_MB[config.id] ?? 0,
  }));
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
  private benchInput: HTMLInputElement;
  private noteEl: HTMLElement;

  private onStart: (config: AppConfig) => void;
  private capabilities: CapabilityReport | null = null;

  constructor(
    initial: AppConfig,
    onStart: (config: AppConfig) => void,
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

          <label class="startup__field startup__field--check">
            <input type="checkbox" class="startup__check startup__bench" />
            <span>Benchmark all models after start (developer tool, downloads each one)</span>
          </label>

          <p class="startup__note"></p>
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
    this.benchInput = q<HTMLInputElement>('.startup__bench');

    // The loading view is a second phase; it must not show through the form.
    this.loadingEl.hidden = true;

    this.populateModels();
    this.modelSelect.value = initial.modelKey;
    this.sourceSelect.value = initial.aiSource;
    this.benchInput.checked = initial.runBenchmark;

    this.modelSelect.addEventListener('change', () => this.renderNote());
    this.sourceSelect.addEventListener('change', () => this.renderNote());
    this.benchInput.addEventListener('change', () => this.renderNote());
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
      runBenchmark: this.benchInput.checked,
    };
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
    for (const choice of modelChoices()) {
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

  /** Explain what the current selection will actually do. */
  private renderNote(): void {
    const config = this.currentConfig();
    const choice = modelChoices().find((c) => c.key === config.modelKey);
    const notes: string[] = [];

    if (config.aiSource === 'mock') {
      notes.push('Mock model: replies are scripted and no model is downloaded. Memory still forms.');
    } else if (config.aiSource === 'local') {
      notes.push(
        `Downloads ~${choice?.approxMb ?? 0} MB on first run, then the browser caches it.`,
      );
      if (this.capabilities && !this.capabilities.webgpu) {
        notes.push(
          'Warning: this browser reports no WebGPU adapter, so the local model will probably fail after downloading. Automatic mode falls back to the mock instead.',
        );
      }
    } else if (this.capabilities && !this.capabilities.webgpu) {
      notes.push(
        `This browser reports no WebGPU adapter, so the mock model will be used instead. ${this.capabilities.reason ?? ''}`.trim(),
      );
    } else {
      notes.push(
        `Uses ${choice?.id ?? config.modelKey}, downloading ~${choice?.approxMb ?? 0} MB on first run.`,
      );
    }

    if (config.runBenchmark) {
      notes.push('Benchmark mode will download every candidate model in turn.');
    }

    this.noteEl.textContent = notes.join(' ');
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