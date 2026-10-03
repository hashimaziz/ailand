import './style.css';
import { App } from './app/App';
import { StartupScreen } from './ui/StartupScreen';
import { DeferredLanguageModel } from './ai/DeferredLanguageModel';
import { createLanguageModel } from './ai/createLanguageModel';
import { detectCapabilities } from './ai/ModelCapabilities';
import { describeModelLoadError } from './ai/ModelErrors';
import { isLlamaServerAvailable } from './ai/createLanguageModel';
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
  screen?.showLoading(
    config.aiSource === 'mock'
      ? 'Starting the mock model…'
      : 'Preparing the language model…',
  );

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