# Architecture

Describes the architecture **as actually implemented**. The authoritative design
intent lives in [`implementation-plan.md`](./implementation-plan.md); where the
implementation diverges from it, the divergence is recorded in
[Deviations and findings](#deviations-and-findings) below and in
[`roadmap.md`](./roadmap.md).

## Startup

The application does not begin in the world. On load it shows a startup screen
(`src/ui/StartupScreen.ts`) with two phases:

1. **Configure.** Model candidate, model source (automatic / local / mock), and a
   benchmark toggle. Each model option shows its dtype, device, and approximate
   download size. Capability detection runs up front, so a browser without WebGPU
   is told so *before* committing to a 1.3 GB download.
2. **Load.** If a real model is selected, it is downloaded and initialised here,
   with byte-level progress, then the world loads.

Only after the model is ready does the world appear. Fetching the model as a
background task once the game was already running left the player walking into a
neighbourhood and then getting stuck on "Loading AI" — no progress, no way to tell
whether it was working, and no way out.

The menu also sets *where* things run. Inference (`auto` / `webgpu` / `wasm`) and
rendering (`auto` / `webgl2`) are independent settings, because GPU memory is the
binding constraint: the CPU backend allocates outside the GPU, and forcing the
renderer to WebGL2 means Three.js does not hold a second WebGPU device alongside
the inference worker. The CPU path drops `q4f16` for `q4`, since the WASM backend
has no float16 kernels — which makes the file *larger* (Qwen3-1.7B is 2048 MB as
q4 versus 1360 MB as q4f16), so the menu quotes per-backend sizes.

Configuration lives in one place, `src/config/appConfig.ts`. The startup menu
writes it, the AI runtime reads it, and `createLanguageModel` no longer parses the
URL. Query parameters are folded into the same shape for automation and deep
links, so both entry paths converge. Choices are remembered in `localStorage`.

Failure is explicit. A load that fails leaves the startup screen up with the
reason, a **Try again** button, and a **Use the mock model instead** button — no
reload required. Selecting "local model" explicitly will *not* silently fall back
to the mock, because quietly changing what is being tested is worse than an error.

`AiWorkerClient` also enforces a stall timeout: 120 s with no message from the
worker fails the load with an explanation rather than waiting indefinitely.

Failures are translated before display. `ModelErrors` maps ORT's opaque runtime
messages — `std::bad_alloc`, "Can't create a session, ERROR_CODE: 6", missing GPU
backends, failed downloads, storage failures — to a plain statement of the problem
and concrete steps, because echoing `std::bad_alloc` at a player is not
actionable.

`detectCapabilities` reports the adapter's limits (`maxBufferSize`,
`maxStorageBufferBindingSize`) and, via `gpuBudgetWarnings`, warns *before* a
multi-gigabyte download when the model looks unlikely to fit or when the renderer
is holding a second device. These are heuristics, not guarantees; the real test is
loading the model.

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
       ├─ npc/       NpcRegistry · NpcSimulation · Relationship · fixtures
       ├─ ui/        StartupScreen · StatusPanel · DialoguePanel · MemoryProposalPanel
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

Memory formation (`MemoryFormation` → `MemoryProcessor` → `MemoryValidator`) is
described in [`memory-system.md`](./memory-system.md).

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

### Reasoning is not dialogue

Reasoning models emit chain-of-thought as ordinary generated tokens. Left alone,
that text is both shown to the player and charged against `max_new_tokens` — the
budget an NPC's one-to-three-sentence reply is supposed to fit inside, so a
reasoning preamble can consume the whole allowance and truncate the actual line.

Two defences, in order of importance:

1. **Turn thinking off at the source.** `ModelConfig.enableThinking` is forwarded
   to the chat template by the worker. It is passed as
   `tokenizer_encode_kwargs: { enable_thinking }`, because that is the option the
   Transformers.js text-generation pipeline spreads into the chat template's
   render context (`chat_template_kwargs` is *not* a pipeline option and would be
   forwarded to `generate()` instead). With it off, Qwen3 emits no reasoning
   prefix and no thinking tokens are generated at all.
2. **Filter the stream anyway.** `ThinkingFilter` strips `<think>…</think>`
   blocks from every streamed chunk, including tags split across chunk boundaries
   and unterminated blocks that run into the token limit. Only visible text is
   streamed, accumulated into `fullText`, and counted in
   `GenerationUsage.completionTokens`, so throughput metrics describe dialogue.

If a generation yields nothing but reasoning, the worker reports an explicit error
rather than leaving an empty reply.

### Two runtimes

The `LanguageModel` contract has two implementations, chosen at startup:

| Runtime | Model | Setup | Notes |
| --- | --- | --- | --- |
| `browser` | Transformers.js in a Web Worker, ONNX q4f16/q4 | None | WebGPU, or WASM on the CPU |
| `llamaServer` | GGUF on a `llama-server` on this machine | Server must be running | No GPU ceiling; supports schema-constrained decoding |

`LlamaServerLanguageModel` talks to the server's OpenAI-compatible endpoint over
SSE and streams through the same `LanguageModel` events, so nothing upstream —
conversation, memory formation, the UI — knows which runtime is in use. The
`LlamaStreamDecoder` is a pure incremental parser, tested independently of any
network: chunk boundaries land mid-JSON and mid-`data:` prefix in practice.

The local runtime is an **upgrade, not a requirement**. If no server answers,
`llama-server` is reported unavailable on the startup screen and the browser
runtime is used, so the project still runs with no setup.

Two things it does that the browser runtime cannot:

- **Schema-constrained decoding.** Extraction sends
  `response_format: { type: 'json_object', schema }`, so llama.cpp constrains the
  grammar. Verified against a live server: enums, bounds and required fields are
  all respected. The browser runtimes ignore it and rely on tolerant parsing.
- **A larger model.** The browser path is capped by GPU memory at 0.6B for many
  machines; a 1.5B–3B GGUF fits comfortably on CPU.

`createLanguageModel` selects an implementation:

| Condition | Result |
| --- | --- |
| `?mockAi=1` | `MockLanguageModel` |
| WebGPU adapter unavailable | `MockLanguageModel`, with the reason surfaced in the status panel |
| `?realAi=1` | skips detection, forces the download attempt |
| `?model=<key>` | uses that candidate from `MODEL_CONFIGS` instead of the default |
| otherwise | `AiWorkerClient`, falling back to the mock if load fails |

The main thread never imports transformers.js; `src/ai/worker.ts` owns a single
pipeline instance shared by every NPC.

### Choosing a model

Candidates live in `src/ai/ModelConfig.ts`. `?bench=1` runs every candidate
through the quality test set and prints latency, throughput, and quality flags to
the console; `?model=qwen3-1.7b` then lets you play with the winner immediately.
The scorer flags the failure modes that actually occur in play — assistant
register, echoing the player, re-introducing mid-conversation, rambling — because
reading truncated responses is not a measurement.

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

### Prompt design

Conversation context is per-session: the turn list lives on the conversation
session, is replayed into the prompt while the conversation is open, and is
discarded when it closes. Nothing about the live conversation is persisted. A new
conversation starts from memory alone, which is the behaviour the prototype is
built to demonstrate.

The system prompt is written as **positive instructions plus a worked example**,
not as a list of prohibitions. A rule-only version ("Stay in character", "You are
not a generic assistant", "Do not invent world facts") produced three consistent
failures with a 0.6B model: assistant/service-desk register ("How can I help
you?"), a fresh self-introduction on every turn, and replies that echoed the
player's question back verbatim. Small models imitate demonstrations far more
reliably than they obey negations, so the prompt now:

- states the scene concretely (a person standing face to face, not "a game"),
- names the register to avoid, so the prohibition is concrete rather than implied,
- tells the model to greet **once** and then continue,
- includes two lines of the character's own voice from `PersonalityProfile.voiceExamples`,
- includes a worked two-turn exchange, deliberately about a character who is *not*
  in the world so it cannot contaminate what the model believes about real NPCs,
- converts the relationship numbers into guidance it can act on
  (`relationshipGuidance`): warm and brief with a friend, do not re-introduce to an
  acquaintance, reserved with a stranger.

Occupations are rendered as prose via `OCCUPATION_LABELS` rather than as debug
slugs like `barista`.

## Memory

`Memory` records carry `type` (`fact | episodic | belief | rumor | relationship`),
`source` (`world | player | npc | observation | inference`), `importance`,
`confidence`, `entities`, optional `locationId`, and `supersedesId`.

Memories are formed after a conversation closes: a second, low-temperature
generation proposes structured JSON candidates, `MemoryProcessor` applies the
policy, and only accepted candidates reach IndexedDB. The model cannot propose a
`world` source or a canonical `fact` at all. See
[`memory-system.md`](./memory-system.md) for the full policy.

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
character budget when the prompt is built. Superseded memories are excluded before
scoring, so an obsolete belief is never offered as current.

## Persistence

IndexedDB database `ai-city`, version 1, three stores: `npcs`, `memories`
(indexed `by-npc`), and `meta`. NPC state and the world clock are autosaved every
5 seconds. Memories are written as conversations close; the player relationship
snapshot for an NPC lives in `meta` under `relationship_<npcId>_player`.

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
7. **`enableThinking` was configured but never reached the model.**
   `ModelConfig.enableThinking` existed from Milestone 5 but the worker did not
   forward it, so Qwen3 ran in its default thinking mode and streamed reasoning
   into the dialogue panel while spending the reply's token budget. Two things
   were needed, not one: forwarding the flag via `tokenizer_encode_kwargs` (see
   [Reasoning is not dialogue](#reasoning-is-not-dialogue)) to stop the tokens
   being generated, and a streaming filter to stop any that still appear. The
   filter's partial-tag handling is the subtle part — a closing tag routinely
   straddles a chunk boundary, so the discarded region has to retain enough of a
   tail to recognise the close.
8. **Memory formation is a second model round-trip.** Extracting structured
   memories after a conversation doubles the generation work per conversation. It
   runs after the panel closes, in the background, and only for conversations that
   clear a significance gate, but it is still the most expensive thing the memory
   system does. Queuing it behind the conversation queue (plan §27) is the
   natural follow-up once more than one conversation can be open.
9. **Supersession needs exact entity-set agreement.** Cheap and safe, but it will
   miss contradictions phrased differently. Accepted as a deliberate trade: a
   wrong supersede destroys a still-true memory, a missed one merely leaves two
   memories in tension.
10. **jsdom has no IndexedDB.** `MemoryProcessor` therefore takes a narrow
    `MemoryPersistence` port so the policy is testable against an in-memory
    store. The same seam is what plan §25 asks for in "save/load persistence
    using a testable persistence adapter".
11. **The default model was never benchmarked.** The plan (§3.6, §32) requires
    benchmarking candidates *before* one becomes the default, and `ModelBenchmark`
    existed from Milestone 5 with nothing able to invoke it. Qwen3-0.6B was
    adopted by assumption and is visibly underpowered for sustained in-character
    voice. `?bench=1` now makes the comparison possible, and `?model=` lets you
    play with a different candidate without editing code. **The default has still
    not been chosen on measured evidence** — that needs a WebGPU browser.
12. **Prompt rules alone do not hold a small model in character.** See
    [Prompt design](#prompt-design). Negations are weakly represented at this
    size; demonstrations and concrete register instructions do the work.
13. **Eagerly initialising in a factory hides progress by construction.**
    `createLanguageModel` used to `await` the load itself, so a caller could not
    register `onProgress` until loading had already finished — no progress events
    were ever delivered. It now returns an uninitialised model and the caller
    drives initialisation. Found by instrumenting the startup screen and observing
    zero progress events during a real 260 MB download.
14. **The app was only ever verified in Chromium.** Safari's WebGPU is newer and
    less tested, and a 1360 MB model there fails with `std::bad_alloc` at session
    creation. The docs claimed a Chromium requirement, but nothing detected the
    situation or offered a way out, so a Safari user hit an opaque runtime error.
    Now surfaced as a capability warning, with CPU inference and a WebGL2 renderer
    as levers, and documented as a known limitation. This is a real gap in earlier
    releases rather than a new bug, and it should have been flagged when Safari
    first came up rather than discovered this way.
15. **A small model ignores memories it was given.** With Qwen2.5-1.5B, retrieval
    worked correctly — the memory about the player was ranked first in
    `RETRIEVED MEMORIES` — and the model still answered "I'm sorry, but I don't
    have that information". The evidence sat ~1.5 KB back in a long system prompt
    and was never attended to. Restating the top recall immediately before the
    question fixed it. Measured A/B against the live model: with the recall note,
    "Of course, I remember. You live in a cozy apartment above a bakery"; without
    it, "I don't have any information". **Retrieval quality and model compliance
    are separate problems** — a green retrieval test would not have caught this.
16. **Interaction distance depended on stopping in the right spot.** The facing
    check compared against an NPC mesh's full position, which sits at knee height,
    so walking right up to someone put them below the eyeline and outside the 15°
    cone — the prompt refused to appear when the player was closest. Distance and
    angle are now measured horizontally, and the geometry is a pure tested
    function.
17. **Truncated JSON was treated as total failure.** Extraction that ran into the
    token limit mid-object returned nothing at all, so an NPC silently forgot the
    conversation. The parser now closes what is open, and drops a value cut
    mid-word rather than storing a fragment.
18. **`hidden` loses to `display` in CSS.** The startup screen's two phases are
    flex containers, so setting `.hidden = true` had no effect and both phases
    rendered at once. Fixed with a `[hidden] { display: none !important }` reset.
    Worth remembering for any future phase-based UI.

## Known gaps at this milestone

- Only 2 NPC fixtures exist (Maria, David); the target is ~10.
- No developer inspector: the memory proposal panel shows formation decisions,
  but there is no NPC state view, context inspector, simulation controls, or
  inference metrics display.
- Retrieval has no relevance floor, so low-scoring memories still reach the
  prompt; the plan's memory-selectivity evaluation would not yet pass.
- No end-to-end test suite; `playwright.config.ts` points at a `tests/e2e/`
  directory that does not exist yet. `?autoStart=1` exists for when it does.
- Forcing "local model" in a browser without WebGPU downloads the weights before
  failing, because the user explicitly asked to skip detection. The menu warns
  about this first, but it is still a wasted download.
- Player collision is a bounding box only; the player walks through buildings.
- `Math.random()` is used for NPC mesh colours, so appearance is not reproducible
  from a seed (the plan calls for a fixed world seed).
- The world clock reports time of day only; there is no day counter, so neither the
  status panel nor a prompt can say how many days have passed.
