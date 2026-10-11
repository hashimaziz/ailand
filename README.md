# AI NPC City Prototype

A browser-first technical prototype: a small 3D explorable neighborhood populated
by persistent AI NPCs, where the language model runs locally in the browser.

The defining feature is that NPCs are persistent individuals rather than
disposable dialogue generators. Each carries an identity, a personality, a daily
schedule, and a compact persistent memory of past interactions. A single shared
language model serves every NPC, conditioned on that per-NPC state, and is never
allowed to redefine authoritative game reality.

The prototype succeeds when you can meet an NPC, have a meaningful interaction,
leave for several in-game days, return, and reasonably expect them to still
recognize you — without the conversation feeling like a scripted state machine.

## Tech Stack

- TypeScript (strict), Vite
- Three.js `WebGPURenderer` with WebGL2 fallback
- llama.cpp (`llama-server`) for local inference — the recommended path
- Transformers.js in a Web Worker as an in-browser alternative
- IndexedDB (`idb`) for persistence
- Vitest for unit tests, Playwright for browser tests

## Run it

The recommended setup runs the language model on your own machine via
[llama.cpp](https://github.com/ggml-org/llama.cpp). It needs no browser support
for AI, handles models that are too large for WebGPU, and makes the NPCs markedly
better. About 10 minutes, most of it downloading.

### 1. Requirements

- Node 18 or newer
- [llama.cpp](https://github.com/ggml-org/llama.cpp) installed, so that
  `llama-server` is on your `PATH`:
  ```bash
  brew install llama.cpp        # macOS
  # or: https://github.com/ggml-org/llama.cpp/releases for other platforms
  ```

### 2. Install

```bash
git clone <this-repo> ai-city && cd ai-city
npm install
```

### 3. Put a model in `models/`

Download an **instruct** GGUF — a base model cannot hold a conversation. Then:

```bash
mkdir -p models
curl -L -o models/Qwen2.5-3B-Instruct-Q4_K_M.gguf \
  https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf
```

That is 1.8 GB and is the one used throughout this project's testing. To keep it
outside the repo instead, set `AILAND_LLAMA_MODEL=/path/to/model.gguf`.

### 4. Start it

```bash
npm run dev
```

Open `http://localhost:5173`. On the startup screen:

- **Model runtime** → *Local llama.cpp server*
- **Local model** → your `.gguf` (it lists what it found)
- Press **Start**

You do **not** start `llama-server` yourself. The dev server launches it, shows
its progress while it boots, and shuts it down when you stop the dev server. The
world loads only once the model can answer.

### 5. Play

Click the canvas to capture the mouse, then:

| Input | Action |
| --- | --- |
| `WASD` | Move |
| Mouse | Look |
| `E` | Talk to the NPC you are facing |
| `Esc` | Close a conversation |
| `Enter` | Send the typed message |

Walk north from the spawn point until `[E] Talk to Maria` appears. After a
conversation, expand the **Memory** panel in the bottom-left to see exactly what
she chose to remember, and why.

To try the prototype's whole point, tell her your name and where you live, close
the conversation, reload the page, and ask again: she should know.

### Running it without a local model

Pick **In this browser** on the startup screen instead. Transformers.js downloads
the weights into the browser and runs them on WebGPU, with a CPU (WASM) fallback.
No setup, but the models that fit are small and the NPCs are noticeably weaker —
use it for UI work and for tests. `?mockAi=1` (or choosing the **mock** source)
skips the download entirely and uses scripted replies.

### Automation

```bash
npx vitest run                      # unit tests, no model download
?mockAi=1&autoStart=1               # boot straight into the mock model
?runtime=llama&autoStart=1          # boot straight into the local model
```

### URL flags

These exist for automation and deep links; the startup menu is the normal path.

| Flag | Effect |
| --- | --- |
| `?autoStart=1` | Skip the menu and boot straight away. |
| `?mockAi=1` | Equivalent to choosing the mock model source. |
| `?realAi=1` | Equivalent to choosing the local model source. |
| `?model=<key>` | Preselect a candidate, e.g. `?model=qwen3-1.7b`. |
| `?device=wasm` | Preselect CPU inference. |
| `?webgl=1` | Preselect the WebGL2 renderer. |
| `?bench=1` | Preselect benchmark mode. |

### Controls

Click the canvas to capture the mouse. `WASD` to move, mouse to look, `E` to talk
to the NPC you are facing, `Esc` to close a conversation.

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | The authoritative engineering plan: thesis, locked decisions, domain model, milestones, acceptance criteria |
| [`docs/architecture.md`](docs/architecture.md) | Architecture as implemented, plus deviations and findings |
| [`docs/memory-system.md`](docs/memory-system.md) | How memories form, what the model is allowed to propose, and the policy that decides |
| [`docs/roadmap.md`](docs/roadmap.md) | Milestone status and what is deferred |
| [`docs/development.md`](docs/development.md) | Setup, model selection, testing, manual verification |

## Troubleshooting

**`std::bad_alloc` / "Can't create a session, ERROR_CODE: 6"** — the GPU ran out
of memory creating the inference session. In order of likelihood:

1. Use a smaller model: Qwen3 **0.6B** rather than 1.7B.
2. Set **Inference** to **CPU (WASM)**. Slower, but does not use GPU memory.
3. Set **Rendering** to **WebGL2**, freeing the GPU device the renderer holds.
4. Close other GPU-heavy tabs and applications, then retry.

The startup screen warns before you commit to a large download when the selected
model looks unlikely to fit the adapter.

**Everything is slow or the model will not load at all in Safari** — expected.
Use Chromium for local inference. The CPU option may work in Safari, but quality
and speed are unverified there.

## Testing

```bash
npx vitest run   # unit tests, no model download
npm run test:e2e # Playwright (no specs yet)
```

## Current State

Milestones 0–7 are complete: project foundation, WebGPU render shell, playable
neighborhood, NPC schedules and simulation, IndexedDB persistence and the memory
schema, the local AI runtime, the conversation pipeline, and memory formation.

The core loop now works end to end. Introduce yourself to an NPC, close the
conversation, reload the page, and talk to them again: their relationship has
moved from `stranger` to `acquaintance`, and what you told them is in their
retrieved memories. The **Memory** panel in the bottom-left shows every memory
the model proposed after each conversation and whether it was remembered, merged,
or discarded with the reason.

Known limitations are listed at the end of
[`docs/architecture.md`](docs/architecture.md#known-gaps-at-this-milestone).
