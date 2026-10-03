# Development

## Setup

```bash
npm install
npm run dev     # http://localhost:5173
```

Node 18+ is required (Vite 5 declares `^18.0.0 || >=20.0.0`). The project uses
strict TypeScript with `noUnusedLocals`/`noUnusedParameters`; `npm run build`
type-checks before bundling, so a type error fails the build rather than shipping.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173, host exposed on the LAN |
| `npm run build` | `tsc` then production bundle into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Vitest in watch mode |
| `npx vitest run` | Vitest once, for CI-style checks |
| `npm run test:e2e` | Playwright (no specs exist yet) |

Model weights live in `models/` and are gitignored. Never commit a `.gguf`.

## The dev server and port 5173

`npm run dev` uses `strictPort`, so if something is already on 5173 it fails with
`Error: Port 5173 is already in use` rather than quietly starting on 5174. That
matters: a stale server left running is invisible, the app still works, but on a
port nothing else is watching — and anything pointed at 5173 breaks for no visible
reason.

If you hit that error, find and stop the old server:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
kill <pid>
```

Check what is listening before killing anything. Other projects on this machine
run their own servers on other ports, and they are not ours to stop.

## Model selection

**Use the startup menu.** Open the app and you get a screen to pick the model, the
model source, and whether to benchmark — with the download size shown before you
commit. The chosen model is then downloaded and initialised *before* the world
loads, with byte-level progress.

The choice is remembered between reloads. The runtime reads it from
`src/config/appConfig.ts`; nothing else decides which model is in use.

Query parameters exist for automation and deep links, and are folded into the same
configuration shape:

| URL | Behaviour |
| --- | --- |
| `?autoStart=1` | Skip the menu and boot straight into the configured setup |
| `?mockAi=1` | Equivalent to choosing the mock model source |
| `?realAi=1` | Equivalent to choosing the local model source |
| `?model=<key>` | Preselect a candidate (e.g. `qwen3-1.7b`). Unknown keys are ignored. |
| `?runtime=llama` | Use a local llama.cpp server |
| `?serverUrl=...` | Point at a non-default llama.cpp server |
| `?device=wasm` | Preselect CPU (WASM) inference |
| `?webgl=1` | Preselect the WebGL2 renderer |
| `?bench=1` | Preselect benchmark mode |

The default model is `onnx-community/Qwen3-0.6B-ONNX` at `q4f16` on WebGPU; see
`src/ai/ModelConfig.ts` for the candidate set. Expect a download of several
hundred megabytes on first real-model run — about 543 MB for the 0.6B candidate,
1360 MB for the 1.7B one. Transformers.js caches it in the browser, so subsequent
runs reuse it.

### The local llama.cpp runtime

Optional, and it is where the good models live. **With `npm run dev` you do not
need to start a server yourself.** Put a GGUF file in `models/` (or set
`AILAND_LLAMA_MODEL`), choose **Local llama.cpp server** on the startup screen,
and press Start — the dev server launches `llama-server`, the loading view narrates
the startup from the server's log, and the world loads once the model is ready. The
server is shut down when the dev server exits.

To manage it by hand instead:

```bash
llama-server -m ~/path/to/model.gguf --port 8080 --host 127.0.0.1 -c 4096 -ngl 0
```

The screen still works either way: selecting the option probes the server and
reports `checking…` / `connected` / `not responding`, and re-selecting (or editing
the URL) re-checks. Starting a server after the page has loaded and re-selecting
is a supported flow.

Configuration:

| Variable | Purpose |
| --- | --- |
| `AILAND_LLAMA_MODEL` | Path to a GGUF file, instead of scanning `models/` |
| `AILAND_LLAMA_MODELS_DIR` | Directory to scan for `.gguf` (default `models`) |
| `AILAND_LLAMA_BIN` | Path to the binary, if not on PATH as `llama-server` |
| `AILAND_LLAMA_NGL` | GPU layers; `0` (default) keeps it on the CPU |

The launcher API only exists under `npm run dev` / `npm run preview`. In a static
build the app cannot start a server and says so, falling back to expecting one to
be running already. Any
OpenAI-compatible server works — `node-llama-cpp` exposes one too.

Good small instruct models in GGUF, verified present on Hugging Face:
`bartowski/Qwen2.5-3B-Instruct-GGUF` (Q4_K_M, 1840 MB),
`bartowski/Llama-3.2-3B-Instruct-GGUF` (Q4_K_M), and the official
`Qwen/Qwen2.5-3B-Instruct-GGUF`.

Useful flags once it is running:

```bash
curl -s http://127.0.0.1:8080/health
curl -s http://127.0.0.1:8080/v1/models      # note: {"models":[{"name":...}]}, not OpenAI's data[]
```

Only one slot serves requests at a time by default, so a second tab will queue
behind a streaming generation.

### Low GPU memory

If a model fails with `std::bad_alloc` or "Can't create a session", the GPU could
not allocate for the inference session. In order: smaller model, then Inference =
CPU (WASM), then Rendering = WebGL2, then close other GPU-heavy apps. The startup
screen shows adapter limits and warns when a model looks unlikely to fit.

Two WebGPU devices exist while inference runs — Three.js's renderer and the
worker — so forcing the WebGL2 renderer is a real memory saving, not a cosmetic
one.

### Choosing a model

The default was adopted by assumption rather than measurement, and a sub-billion
model has visibly more trouble holding an in-character voice. If dialogue quality
seems off, measure before tuning prompts further:

1. Open `http://localhost:5173/?bench=1` in a WebGPU-capable browser. It runs every
   candidate through the quality test set and logs a comparison table.
2. Read the flags. `assistantRegister`, `echoesPlayer`, `reintroduced`, and
   `tooLong` are the failure modes that show up in play; fewer is better.
3. Play with the winner using `?model=<key>`, then change `DEFAULT_MODEL_KEY`.

Latency matters too — a model that answers in character but slowly is a better
trade than a fast one that says "How can I help you?". The benchmark reports
time-to-first-token and tokens/sec so the trade is visible.

Reasoning is disabled for dialogue (`enableThinking: false`), and `ThinkingFilter`
strips any `<think>` block from the stream regardless. If you swap in a
reasoning model and see empty or truncated replies, check that
`ModelConfig.enableThinking` is still `false` — see
[`architecture.md`](./architecture.md#reasoning-is-not-dialogue).

The application stays interactive while the model loads — the render loop and
player movement do not wait on it. Opening a conversation before the model is
ready shows a loading state in the dialogue panel.

## Browser support

Desktop Chromium-based browsers with WebGPU enabled are the supported target for
local inference. Rendering falls back to a WebGL2 backend automatically, so the
world still renders without WebGPU, but dialogue falls back to the mock rather
than pretending local AI is working.

WebGPU requires a secure context, so use `localhost` during development and HTTPS
if you host the build.

## Testing

Unit tests run in jsdom and never download a model. `MockLanguageModel` provides
deterministic streaming replies so the AI-dependent paths stay testable offline.

```
tests/unit/AiRuntime.test.ts         mock model lifecycle, cancellation, deferred loading, benchmark
tests/unit/ConversationPrompt.test.ts  prompt assembly and budgeting
tests/unit/ContextBudget.test.ts     budget trimming helpers
tests/unit/DialoguePanel.test.ts     dialogue UI states
tests/unit/MemoryRetriever.test.ts   memory ranking
tests/unit/MemoryValidator.test.ts   candidate normalization and authority rules
tests/unit/MemoryFormation.test.ts   extraction prompt and tolerant JSON parsing
tests/unit/MemoryProcessor.test.ts   accept/reject/merge/supersede/prune policy
tests/unit/Relationship.test.ts      relationship defaults, clamping, bounded deltas
tests/unit/ThinkingFilter.test.ts    reasoning-strip stream filter, incl. split tags
tests/unit/ModelBenchmark.test.ts    quality scorer, fixtures, model candidates
tests/unit/StartupScreen.test.ts      config resolution, startup screen, progress
tests/unit/LlamaServer.test.ts        SSE decoding at any chunk size, runtime config
tests/unit/LlamaLauncher.test.ts      server launch, readiness polling, cancellation
tests/unit/InteractionController.test.ts  horizontal distance/cone geometry
```

`MemoryProcessor` depends on a narrow `MemoryPersistence` port rather than
IndexedDB directly, which is how the memory policy is tested without a database.
Use that seam rather than reaching into `Database` from a test.

To add coverage that needs real persistence, note that jsdom does not implement
IndexedDB. Either test through the port with an in-memory double, or install
`fake-indexeddb` and point `Database` at it.

## Manual verification

The deterministic checks that matter most, and how to run them:

1. `npm run build` completes with no type errors.
2. `npx vitest run` passes with no model download.
3. `npm run dev`, open `http://localhost:5173`, pick **Mock** as the model source,
   and press Start. Click the canvas to capture the mouse, walk north toward the
   apartments until `[E] Talk to Maria` appears, press `E`, and send a message.
   The reply streams in and lands in the transcript.
4. Send a second message and press **Cancel reply** mid-stream. The partial reply
   is kept in the transcript and the composer becomes usable again.
5. Close the conversation and expand the **Memory** panel in the bottom-left. Every
   proposed memory appears with the decision made and the reason for it.
6. Reload the page and talk to Maria again. Her relationship section in the prompt
   now reads `acquaintance`, and the memory you formed in step 5 appears under
   RETRIEVED MEMORIES.

Headless browser automation cannot capture the pointer, so any Playwright test
must stub `pointerLockElement` or the game needs a non-pointer-locked entry
point. It also cannot get a WebGPU adapter, so `?autoStart=1&mockAi=1` is the
entry point for deterministic runs.

## Conventions

- Vanilla TypeScript and direct DOM manipulation. No UI framework.
- The render layer must not import the AI layer, and the main thread must not
  import `@huggingface/transformers`.
- Model output is untrusted. It may propose structured data; it never mutates
  authoritative state directly.
- Prompt context is budgeted per section in `src/config/gameConfig.ts`. Do not
  grow a context section without a budget.
- Commits are logical units of work, named `feat:`, `fix:`, `refactor:`, `perf:`,
  `test:`, `chore:`, and each should leave the app buildable and testable.
- Record deviations from the plan in [`architecture.md`](./architecture.md).
- Never initialise a model inside a factory that a caller needs to observe; return
  it uninitialised so progress callbacks can be attached first.
