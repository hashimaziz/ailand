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
       ├─ npc/       NpcRegistry · NpcSimulation · Relationship · fixtures
       ├─ ui/        StatusPanel · DialoguePanel · MemoryProposalPanel
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

## Known gaps at this milestone

- Only 2 NPC fixtures exist (Maria, David); the target is ~10.
- No developer inspector: the memory proposal panel shows formation decisions,
  but there is no NPC state view, context inspector, simulation controls, or
  inference metrics display.
- Retrieval has no relevance floor, so low-scoring memories still reach the
  prompt; the plan's memory-selectivity evaluation would not yet pass.
- No end-to-end test suite; `playwright.config.ts` points at a `tests/e2e/`
  directory that does not exist yet.
- Player collision is a bounding box only; the player walks through buildings.
- `Math.random()` is used for NPC mesh colours, so appearance is not reproducible
  from a seed (the plan calls for a fixed world seed).
- The world clock reports time of day only; there is no day counter, so neither the
  status panel nor a prompt can say how many days have passed.
