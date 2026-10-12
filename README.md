# AILand

A small 3D neighbourhood you can walk around, populated by AI NPCs that remember
who you are — with the language model running locally, in your browser or on your
own machine.

Nothing leaves your machine. There is no API key, no account, and no server to
deploy to.

## What it is

Most game dialogue systems generate a line and throw it away. Here NPCs are
persistent individuals rather than disposable dialogue generators. Each carries
an identity, a personality, a daily schedule, and a compact persistent memory of
past interactions. A single shared language model serves every NPC, conditioned on
that per-NPC state, and is never allowed to redefine authoritative game reality.

The prototype succeeds when you can meet an NPC, have a meaningful interaction,
leave for several in-game days, return, and reasonably expect them to still
recognise you — without the conversation feeling like a scripted state machine.

> The repository is named **AILand**, and the npm package is still `ai-city` from
> when this was a prototype. The running app's title, in the browser tab and on
> the startup screen, is *AI NPC City*.

## Features

- **A walkable neighbourhood** — a road, North Apartments, South Park, the West
  Coffee Shop and the East Shop, rendered with Three.js.
- **NPCs with a daily schedule** — Maria the barista and David the shopkeeper
  move between home, work and the park as the in-game clock advances (one real
  second is one in-game minute).
- **Free-form conversation** — type a message, and the reply streams in token by
  token. You can cancel a reply mid-stream.
- **Persistent memory** — after a conversation, the model proposes memories; a
  policy decides whether each one is accepted, merged, superseded or discarded,
  and why. Everything lives in IndexedDB, so it survives a reload.
- **Relationships that move** — each conversation nudges trust and familiarity
  within bounded limits; `stranger` becomes `acquaintance` once you've actually
  talked.
- **Two inference runtimes** — llama.cpp on your own machine (the good path, and
  large models), or Transformers.js in a Web Worker (zero setup, small models).
- **A memory inspector** — the Memory panel in the bottom-left shows every
  proposed memory and the decision made on it.
- **A model benchmark** — score every candidate model against a fixture set in
  the browser and compare them.

## Tech stack

| Layer | Choice |
| --- | --- |
| Language | TypeScript (strict) |
| Build / dev server | Vite 5 |
| Rendering | Three.js `WebGPURenderer`, with a WebGL2 fallback |
| Local inference | llama.cpp `llama-server`, or `@huggingface/transformers` in a Web Worker |
| Persistence | IndexedDB via `idb` |
| Unit tests | Vitest (jsdom) |
| Browser tests | Playwright (config only — no specs yet) |

No UI framework: vanilla TypeScript and direct DOM manipulation.

## Prerequisites

- **Node.js 18+** (Vite 5 declares `^18.0.0 || >=20.0.0`). Developed against Node 24.
- A **desktop Chromium-based browser** for local inference — WebGPU needs a
  secure context, so use `localhost` during development.
- **Optional, but recommended:** [llama.cpp](https://github.com/ggml-org/llama.cpp)
  on your `PATH`, plus an instruct **GGUF** model file. Without this the app still
  runs — it falls back to in-browser Transformers.js or a mock model.

### Optional: llama.cpp

```bash
brew install llama.cpp        # macOS
# other platforms: https://github.com/ggml-org/llama.cpp/releases
```

This puts `llama-server` on your `PATH`. You do **not** have to start it
yourself — see [Running it](#running-it).

## Install

```bash
git clone https://github.com/hashimaziz/ailand.git
cd AILand
npm install
```

### Adding a model (optional)

For the llama.cpp path you need an **instruct** GGUF. A base model cannot hold a
conversation. Drop it in `models/` (the directory is committed with a README and
its contents are gitignored):

```bash
mkdir -p models
curl -L -o models/Qwen2.5-3B-Instruct-Q4_K_M.gguf \
  https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf
```

That's ~1.8 GB and is the model this project has been tested against. To keep
large weights outside the repo, set `AILAND_LLAMA_MODEL=/path/to/model.gguf`
instead. See [`models/README.md`](models/README.md) for other sizes.

You can skip all of this and still run the app — see
[Running it without a model](#running-it-without-a-model).

## Running it

```bash
npm run dev
```

Then open `http://localhost:5173`. The dev server uses `strictPort`, so if 5173
is already taken it fails loudly rather than moving to 5174 where nothing is
watching for it.

On the startup screen:

1. **Model runtime** → *Local llama.cpp server*
2. **Local model** → pick the `.gguf` the server listed
3. Press **Start**

You do **not** start `llama-server` yourself. The dev server launches it as a
child process, narrates its startup from the server's log, and shuts it down
when the dev server exits. The world loads only once the model can answer. If you
would rather manage it by hand, run it yourself on the default port
(`http://127.0.0.1:8080`) and select the same runtime:

```bash
llama-server -m /path/to/model.gguf --port 8080 --host 127.0.0.1 -c 4096
```

Leave `-ngl` alone: it defaults to `auto`, which uses Metal on macOS and falls
back to CPU only when it must. Forcing `-ngl 0` roughly halved generation speed
in testing.

The llama launcher only exists under `npm run dev` / `npm run preview` — a static
build cannot spawn a process and says so, expecting a server to be running
already. Any OpenAI-compatible server works.

### Running it without a model

Choose **In this browser** on the startup screen instead. Transformers.js
downloads weights into the browser and runs them on WebGPU, with a CPU (WASM)
fallback. No setup, but the models that fit are small and the NPCs are noticeably
weaker — use it for UI work. For the fastest possible start with no download at
all, pick the **mock** model source: scripted replies, no AI.

```bash
npm run dev -- --open    # then pick "mock"
# or open directly:
#   http://localhost:5173/?mockAi=1&autoStart=1
```

## How to use it

Click the canvas to capture the mouse.

| Input | Action |
| --- | --- |
| `WASD` | Move |
| Mouse | Look |
| `E` | Talk to the NPC you are facing |
| `Enter` | Send the typed message |
| `Esc` | Close the conversation |

Walk to the North Apartments until `[E] Talk to Maria` appears. Talk to her, then
open the **Memory** panel in the bottom-left to see exactly what she chose to
remember, and why.

To try the whole point of the thing: tell her your name and where you live, close
the conversation, reload the page, and ask again. She should know, and her
relationship will have moved on from `stranger`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173, host exposed on the LAN |
| `npm run build` | Type-check with `tsc`, then bundle to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Vitest in watch mode |
| `npx vitest run` | Vitest once — 270 unit tests, no model download |
| `npm run test:e2e` | Playwright. Currently fails with "No tests found" — the config points at `tests/e2e/`, which does not exist yet |

The production build is a static site in `dist/`. WebGPU requires a secure
context, so serve it over HTTPS if you host it anywhere other than `localhost`.

## Configuration

Environment variables, read by the dev server's llama plugin:

| Variable | Purpose |
| --- | --- |
| `AILAND_LLAMA_MODEL` | Path to a GGUF file, instead of scanning `models/` |
| `AILAND_LLAMA_MODELS_DIR` | Directory to scan for `.gguf` (default `models`) |
| `AILAND_LLAMA_BIN` | Path to the binary, if not on `PATH` as `llama-server` |
| `AILAND_LLAMA_NGL` | GPU layer count. Unset by default, which is correct — llama.cpp defaults `-ngl` to `auto`. Set `0` to force CPU. |

In-app configuration is chosen on the startup screen and remembered in
`localStorage`. URL flags exist for automation and deep links; the menu is the
normal path.

| Flag | Effect |
| --- | --- |
| `?autoStart=1` | Skip the menu and boot straight into the configured setup |
| `?mockAi=1` | Equivalent to choosing the mock model source |
| `?realAi=1` | Equivalent to choosing the local model source |
| `?model=<key>` | Preselect a candidate, e.g. `?model=qwen3-1.7b`. Unknown keys are ignored. |
| `?runtime=llama` | Use a local llama.cpp server (`browser` also accepted) |
| `?serverUrl=...` | Point at a non-default llama.cpp server |
| `?llamaModel=<name>` | Preselect a GGUF basename |
| `?device=wasm` | Preselect CPU (WASM) inference |
| `?webgl=1` | Preselect the WebGL2 renderer |
| `?bench=1` | Preselect benchmark mode — downloads every candidate |

The default in-browser model is `onnx-community/Qwen3-0.6B-ONNX` at `q4f16` on
WebGPU. Expect a download of several hundred megabytes on the first real-model
run; Transformers.js caches it in the browser afterwards. Candidates are defined
in [`src/ai/ModelConfig.ts`](src/ai/ModelConfig.ts).

## Project structure

```
src/
  ai/             Model runtimes: llama.cpp, Transformers.js worker, mock, benchmark
  app/            App wiring — scene, player, NPCs, panels, render loop
  config/         Startup config (single source of truth) and game/prompt budgets
  conversation/   Conversation manager, prompt building, context budgeting
  memory/         Memory extraction, validation, retrieval, storage policy
  npc/            NPC fixtures, registry, schedules and simulation, relationships
  persistence/    IndexedDB schema and access
  player/         Movement and the interaction cone
  render/         Three.js scene, camera, lighting, renderer
  ui/             Startup screen, dialogue panel, memory panel, status panel
  world/          Neighborhood geometry, location registry, world clock
vite/             Vite plugin that manages the llama-server child process
tests/unit/       Vitest specs (jsdom, no model download)
docs/             Design and engineering documentation
```

Two invariants worth knowing if you contribute: the render layer must not import
the AI layer, and the main thread must not import `@huggingface/transformers`.
Model output is treated as untrusted — it may propose structured data, but it
never mutates authoritative state directly.

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | The engineering plan: thesis, locked decisions, domain model, milestones, acceptance criteria |
| [`docs/architecture.md`](docs/architecture.md) | Architecture as implemented, plus deviations and findings |
| [`docs/memory-system.md`](docs/memory-system.md) | How memories form, what the model may propose, and the policy that decides |
| [`docs/roadmap.md`](docs/roadmap.md) | Milestone status and what is deferred |
| [`docs/development.md`](docs/development.md) | Setup, model selection, testing, manual verification |

## Troubleshooting

**`Error: Port 5173 is already in use`** — the dev server uses `strictPort` on
purpose, so a stale server can't silently move the app somewhere nothing is
watching. Find and stop it:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
kill <pid>
```

Check what is listening before killing anything.

**The startup screen says it could not launch `llama-server`** — it isn't on your
`PATH`. Install llama.cpp, or set `AILAND_LLAMA_BIN` to the binary's full path.

**"No GGUF model found"** — put an instruct `.gguf` in `models/`, or set
`AILAND_LLAMA_MODEL` to an absolute path.

**`std::bad_alloc` / "Can't create a session, ERROR_CODE: 6"** — the GPU ran out
of memory creating the inference session. In order of likelihood:

1. Use a smaller model (Qwen3 0.6B rather than 1.7B).
2. Set **Inference** to **CPU (WASM)**. Slower, but does not use GPU memory.
3. Set **Rendering** to **WebGL2**, freeing the GPU device Three.js holds — two
   WebGPU devices exist while inference runs, so this is a real saving.
4. Close other GPU-heavy tabs and applications, then retry.

The startup screen shows adapter limits and warns before you commit to a large
download when the model looks unlikely to fit.

**Everything is slow, or the model will not load in Safari** — expected. Use
Chromium for local inference. The CPU option may work in Safari, but speed and
quality there are unverified.

**A conversation pauses after you close it** — memory extraction runs in the
background against a llama server that serves one request at a time. Expect a
short pause, not a failure.

## Current state

Milestones 0–7 are complete: project foundation, WebGPU render shell, playable
neighbourhood, NPC schedules and simulation, IndexedDB persistence and the memory
schema, the local AI runtime, the conversation pipeline, and memory formation.

The core loop works end to end. Introduce yourself to an NPC, close the
conversation, reload the page, and talk to them again: their relationship has
moved from `stranger` to `acquaintance`, and what you told them is in their
retrieved memories.

Known gaps — only 2 NPCs rather than ~10, no developer inspector, no day counter,
no end-to-end tests, bounding-box-only collision, and small-model consistency
issues — are listed at the end of
[`docs/architecture.md`](docs/architecture.md#known-gaps-at-this-milestone).

## License

No license file yet. The package is marked `"private": true` and the repository
has no `LICENSE`; treat it as all rights reserved until one is added.
