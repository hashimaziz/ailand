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
- Transformers.js in a Web Worker for local WebGPU inference
- IndexedDB (`idb`) for persistence
- Vitest for unit tests, Playwright for browser tests

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` and choose your settings on the startup screen.

**Supported browser: recent Chromium-based Chrome or Edge.** Local inference is
built and tested against Chromium with WebGPU. Safari's WebGPU is newer and less
tested, and large models there commonly fail to allocate GPU memory — see
[Troubleshooting](#troubleshooting) below if that happens.

The dialogue model is a few hundred megabytes and is downloaded on first use and
cached by the browser. The world is fully explorable while it downloads.

### Choosing a model

The app opens on a startup screen. Pick a model, where it comes from (automatic,
local, or a scripted mock), where inference runs (GPU or CPU), and press Start.
Each option shows its download size up front, and the model is fetched and
initialised *before* the world loads — with byte-level progress, so a slow
download is visibly making progress rather than looking frozen.

**Model runtime** is also a choice. *In this browser* needs no setup. *Local
llama.cpp server* uses a `llama-server` running on your machine, which lifts the
GPU-memory ceiling, allows a 1.5B–3B model instead of 0.6B, and supports
schema-constrained decoding so memory extraction is reliable. See
[`docs/development.md`](docs/development.md#the-local-llamacpp-runtime).

**Inference** and **Rendering** are separate because GPU memory is the scarce
resource. Inference can run on the CPU via WASM, which is slower but does not
touch the GPU at all; rendering can be forced to WebGL2, which stops Three.js
holding a second WebGPU device while the model loads.

If the model cannot load, the startup screen stays up with the reason and offers a
retry or a switch to the mock model, so you are never stuck.

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
