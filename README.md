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

Open `http://localhost:5173`. Use a recent Chromium-based browser with WebGPU
enabled for local inference.

The dialogue model is a few hundred megabytes and is downloaded on first use and
cached by the browser. The world is fully explorable while it downloads.

### URL flags

| Flag | Effect |
| --- | --- |
| `?mockAi=1` | Use the deterministic mock model. No download, no WebGPU needed. |
| `?realAi=1` | Force the real model download even if WebGPU detection fails. |
| *(none)* | Real model when WebGPU is available, otherwise mock, with the reason shown. |

### Controls

Click the canvas to capture the mouse. `WASD` to move, mouse to look, `E` to talk
to the NPC you are facing, `Esc` to close a conversation.

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | The authoritative engineering plan: thesis, locked decisions, domain model, milestones, acceptance criteria |
| [`docs/architecture.md`](docs/architecture.md) | Architecture as implemented, plus deviations and findings |
| [`docs/roadmap.md`](docs/roadmap.md) | Milestone status and what is deferred |
| [`docs/development.md`](docs/development.md) | Setup, model selection, testing, manual verification |

## Testing

```bash
npx vitest run   # unit tests, no model download
npm run test:e2e # Playwright (no specs yet)
```

## Current State

Milestones 0–6 are complete: project foundation, WebGPU render shell, playable
neighborhood, NPC schedules and simulation, IndexedDB persistence and the memory
schema, the local AI runtime, and the conversation pipeline. Memory formation —
turning conversations into persistent memories — is in progress.

Known limitations are listed at the end of
[`docs/architecture.md`](docs/architecture.md#known-gaps-at-this-milestone).
