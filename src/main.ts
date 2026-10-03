import './style.css';
import { App } from './app/App';
import { StartupScreen } from './ui/StartupScreen';
import { DeferredLanguageModel } from './ai/DeferredLanguageModel';
import { createLanguageModel } from './ai/createLanguageModel';
import { detectCapabilities } from './ai/ModelCapabilities';
import { describeModelLoadError } from './ai/ModelErrors';
import { isLlamaServerAvailable } from './ai/createLanguageModel';
import { LlamaLauncher } from './ai/llamaLauncher';
import {
  AppConfig,
  configFromSearch,
  getConfig,
  loadRememberedConfig,
  rememberConfig,
  setConfig,
  shouldAutoStart,
} from './config/appConfig';

function requireContainer(): HTMLElement {
  const container = document.getElementById('app');
  if (!container) {
    throw new Error('Could not find #app container');
  }
  return container;
}

/**
 * Load the model, then the world.
 *
 * Order matters: the configuration is chosen first, the model is fetched and
 * initialised while the startup screen is still up, and only then does the game
 * start. Fetching the model in the background once the world was already running
 * left the player stuck on "Loading AI" with no progress and no way out.
 */
async function loadModelAndStart(container: HTMLElement, config: AppConfig, screen: StartupScreen | null) {
  const usingServer = config.runtime === 'llamaServer';
  screen?.showLoading(
    config.aiSource === 'mock'
      ? 'Starting the mock model…'
      : usingServer
        ? 'Starting the llama.cpp server…'
        : 'Preparing the language model…',
  );

  // Launch the local runtime before anything else, so the world only appears once
  // the model can actually answer.
  if (usingServer) {
    const outcome = await ensureLlamaServer(config, screen);
    if (outcome === 'failed') return;
  }

  const model = new DeferredLanguageModel(async () => {
    const { model } = await createLanguageModel();
    return model;
  });

  try {
    await model.initialize({ onProgress: (event) => screen?.updateProgress(event) });
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'The language model failed to load.';
    if (screen) {
      // ORT allocation and backend errors are opaque; translate them into steps
      // the player can actually take.
      screen.showLoadingError(describeModelLoadError(raw));
      return;
    }
    const message = raw;
    // No startup screen to recover on (automated run): play on without dialogue.
    console.error('[AI] model failed to load:', message);
  }

  screen?.destroy();

  const app = new App(container, model, config);
  await app.initialize();
  app.start();
}

/**
 * Make sure a llama.cpp server is listening, launching one if the dev server
 * supports it. Returns 'failed' when nothing is running and nothing could be
 * started, so the caller stops rather than loading a world that cannot talk.
 */
async function ensureLlamaServer(
  config: AppConfig,
  screen: StartupScreen | null,
): Promise<'ready' | 'unsupported' | 'failed'> {
  const launcher = new LlamaLauncher();

  screen?.showServerStart();

  const status = await launcher.ensureRunning(config.llamaServerUrl, {}, (update) => {
    screen?.updateServerStatus(update);
  });

  if (status?.state === 'ready') return 'ready';

  if (status === null) {
    // No launcher API: assume the user is running a server themselves.
    const available = await isLlamaServerAvailable(config.llamaServerUrl);
    if (available) return 'unsupported';
    screen?.showLoadingError(
      `No llama.cpp server answered at ${config.llamaServerUrl}, and this build cannot start one.\n\n` +
        'Run `npm run dev` (which can manage the server for you), or start one yourself:\n' +
        '  llama-server -m model.gguf --port 8080 -ngl 0\n\n' +
        'Then press Try again, or use the mock model to keep playing.',
    );
    return 'failed';
  }

  screen?.showLoadingError(
    `${status.message ?? 'The llama.cpp server failed to start.'}\n\n` +
      'Check that llama.cpp is installed and on PATH, and that a GGUF model was found.\n\n' +
      'Press Try again, or use the mock model to keep playing.',
  );
  return 'failed';
}

async function main(): Promise<void> {
  const container = requireContainer();
  const search = window.location.search;

  // URL parameters are folded into the same shape the menu produces, so deep
  // links and automated runs converge on one configuration path.
  const initial = setConfig({ ...loadRememberedConfig(), ...configFromSearch(search) });

  if (shouldAutoStart(search)) {
    await loadModelAndStart(container, getConfig(), null);
    return;
  }

  const capabilities = await detectCapabilities();

  const screen = new StartupScreen(
    initial,
    async (chosen) => {
      const config = setConfig(chosen);
      rememberConfig(config);
      await loadModelAndStart(container, config, screen);
    },
    { probeLlama: isLlamaServerAvailable },
  );
  screen.setCapabilities(capabilities);

  // Probe once so the menu can say whether the local server is actually there,
  // rather than letting the player find out after pressing Start.
  screen.setLlamaServerStatus(await isLlamaServerAvailable(initial.llamaServerUrl));
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(err);
  const container = document.getElementById('app');
  if (container) {
    container.innerHTML = `<div class="startup__fatal">Failed to start: ${message}</div>`;
  }
});