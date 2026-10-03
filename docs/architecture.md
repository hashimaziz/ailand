# Architecture

Describes the architecture **as actually implemented**. The authoritative design
intent lives in [`implementation-plan.md`](./implementation-plan.md); where the
implementation diverges from it, the divergence is recorded in
[Deviations and findings](#deviations-and-findings) below and in
[`roadmap.md`](./roadmap.md).

## Layer boundaries

The rendering layer never imports the AI layer. The AI runtime is reachable only
through the `LanguageModel` interface, and the only module that imports
`@huggingface/transformers` is the worker.

```
main.ts
  └─ App  ──────────────────────────── owns the loop, wiring, persistence timer
       ├─ render/    Scene · Camera · Renderer · Lighting      (Three.js)
       ├─ world/     Neighborhood · LocationRegistry · WorldClock
       ├─ player/    PlayerController · InteractionController
       ├─ npc/       NpcRegistry · NpcSimulation · fixtures
       ├─ ui/        StatusPanel · DialoguePanel
       ├─ persistence/Database                                 (IndexedDB via idb)
       ├─ conversation/ ConversationManager
       │    ├─ ContextAssembler ── MemoryRetriever ── MemoryStore ── Database
       │    ├─ PromptBuilder ── ContextBudget
       │    └─ ContextAssembler ── gameConfig budgets
       └─ ai/        LanguageModel (interface)
            ├─ DeferredLanguageModel   lazy resolution, one underlying model
            ├─ createLanguageModel     capability detection + fallback choice
            ├─ AiWorkerClient          main-thread side of postMessage
            ├─ worker.ts               ONLY module importing transformers.js
            └─ MockLanguageModel       deterministic, AI-free tests
```

## AI runtime

`LanguageModel` (`src/ai/LanguageModel.ts`) is the whole contract the rest of the
app knows:

```ts
interface LanguageModel {
  initialize(options?): Promise<ModelInfo>;
  generate(requestId, messages, config, onEvent): Promise<void>;
  cancel(requestId): Promise<void>;
  dispose(): Promise<void>;
  isReady(): boolean;
  getModelInfo?(): ModelInfo | null;
}
```

`DeferredLanguageModel` wraps a factory so the ~600 MB model download never
blocks boot: `App.start()` kicks off `initialize()` after the first frame, and the
render loop runs throughout. `resolve()` memoizes the factory, so concurrent
callers (background warm-up plus a player opening a conversation mid-download)
share one worker rather than racing to create two.

Generation events are `started` → `token`* → `completed` | `error`. Cancelling
emits `completed` with the partial text already streamed, so a cancelled reply
still lands in the transcript instead of leaving an orphaned bubble; the pending
`generate()` promise is always settled.

`createLanguageModel` selects an implementation:

| Condition | Result |
| --- | --- |
| `?mockAi=1` | `MockLanguageModel` |
| WebGPU adapter unavailable | `MockLanguageModel`, with the reason surfaced in the status panel |
| `?realAi=1` | skips detection, forces the download attempt |
| otherwise | `AiWorkerClient`, falling back to the mock if load fails |

The main thread never imports transformers.js; `src/ai/worker.ts` owns a single
pipeline instance shared by every NPC.

## Conversation pipeline

```
open conversation
  → gather NPC + world state
  → MemoryRetriever ranks that NPC's memories for this message
  → ContextAssembler splits world truth from personal memory
  → PromptBuilder assembles a budgeted system prompt + chat turns
  → worker streams a reply → DialoguePanel
  → turn appended to a bounded session window
```

Prompt sections and their hard character budgets (`src/config/gameConfig.ts`):

| Section | Budget (chars) |
| --- | --- |
| System rules | 1400 |
| NPC identity | 1000 |
| World truth | 1000 |
| Relationship | 600 |
| Current situation | 600 |
| Retrieved memories | 2000 |
| Recent dialogue | 1200 |
| Player message | 600 |

Token counts are estimated at 4 characters per token; the soft prompt ceiling is
`maxContextTokens (2048) × 4`. Exceeding it logs a warning rather than silently
truncating the player's own message.

Recent dialogue is replayed as **real alternating chat turns** (`user` /
`assistant`) newest-first under budget, not as a prose recap block preceded by a
fabricated acknowledgement turn. The current player message is always the final
turn.

## Memory

`Memory` records carry `type` (`fact | episodic | belief | rumor | relationship`),
`source` (`world | player | npc | observation | inference`), `importance`,
`confidence`, `entities`, optional `locationId`, and `supersedesId`.

Retrieval (`src/memory/MemoryRetriever.ts`) is fully deterministic — no
embeddings, no vector store — and currently scores:

| Signal | Weight |
| --- | --- |
| Entity overlap with the player message | +0.30 |
| `importance` | ×0.20 |
| Recency (created within the last 24 in-game hours) | +0.15 |
| `locationId` matches the NPC's current location | +0.10 |

Ties break on the stable sort, preserving the order returned by IndexedDB. The top
10 candidates are returned; `fitItemsToBudget` then trims them to the memory
character budget when the prompt is built.

## Persistence

IndexedDB database `ai-city`, version 1, three stores: `npcs`, `memories`
(indexed `by-npc`), and `meta`. NPC state and the world clock are autosaved every
5 seconds. `memories` and `meta` have no writer yet — nothing creates memories or
relationship snapshots until Milestone 7 lands.

## World

One block: apartments (north), coffee shop (west), shop (east), park (south),
registered in `LocationRegistry` as both geometry and NPC destinations. The clock
runs 1 real second = 60 in-game seconds starting at 08:00, and NPC schedules are
matched by hour so movement is independent of the language model.

## Deviations and findings

Recorded per the instruction in the plan to document deviations as they arise.

1. **`WebGPURenderer.init()` must be awaited before the first frame.**
   `Renderer.init()` was a no-op and the loop called the deprecated
   `renderAsync()`. Three auto-initializes inside `renderAsync()`, so this was not
   fatal, but it logged a deprecation warning on every boot. Now `App.initialize()`
   awaits `renderer.init()` and the loop calls the synchronous `render()`.
2. **Model download must not block application boot.** The first implementation
   awaited the model before the first frame, which on a WebGPU-capable machine
   means a blank screen for the length of a ~600 MB download. Fixed with
   `DeferredLanguageModel` (see above).
3. **Cancelling a generation has to settle the request.** The worker drops
   cancelled generations silently, which left `generate()`'s promise pending
   forever and leaked the conversation turn. Cancellation now emits `completed`
   with the streamed prefix from both the worker client and the mock.
4. **`THREE.Clock` is deprecated** in three 0.186 (`THREE.Timer` is the
   replacement). The render loop computes its own delta from `performance.now()`
   rather than pulling in an addon for two lines.
5. **Prompt replay must use real chat roles.** The original builder wrapped prior
   turns in a single `Recent conversation:` user message and appended a
   fabricated assistant reply so the next turn would not follow a user turn.
   That wastes budget and teaches the model to emit filler acknowledgements.
6. **Headless Chromium refuses pointer lock.** Relevant to the e2e suite: browser
   tests must either stub `pointerLockElement` or drive the game through a
   non-pointer-locked entry point.
7. **`enableThinking` is configured but not yet forwarded to the model.**
   `ModelConfig.enableThinking` is `false` for both candidates, but the worker
   does not pass `enable_thinking` through to the Qwen3 chat template. Until it
   does, Qwen3 may emit reasoning tokens that are billed and streamed as dialogue.
   This is a real latency and quality risk for the default model.

## Known gaps at this milestone

- Only 2 NPC fixtures exist (Maria, David); the target is ~10.
- Nothing writes memories yet: there is no structured extraction step, so NPC
  continuity across sessions is not yet demonstrable. This is Milestone 7.
- Relationship state is derived per conversation from defaults and never
  persisted or evolved.
- No developer inspector, no simulation controls, no inference metrics display.
- Retrieval has no relevance floor, so low-scoring memories still reach the
  prompt; the plan's memory-selectivity evaluation would not yet pass.
- No end-to-end test suite; `playwright.config.ts` points at a `tests/e2e/`
  directory that does not exist yet.
- Player collision is a bounding box only; the player walks through buildings.
- `Math.random()` is used for NPC mesh colours, so appearance is not reproducible
  from a seed (the plan calls for a fixed world seed).
