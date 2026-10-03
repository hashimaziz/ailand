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

## Model selection

The dialogue model is selected at runtime by `src/ai/createLanguageModel.ts`.
Two query parameters override detection, which is useful for development and for
keeping test runs free of model downloads:

| URL | Behaviour |
| --- | --- |
| `?mockAi=1` | Always use `MockLanguageModel` |
| `?realAi=1` | Skip capability detection and attempt the real download |
| `?model=<key>` | Use a specific candidate from `MODEL_CONFIGS` (e.g. `qwen3-1.7b`). Unknown keys are ignored. |
| `?bench=1` | Benchmark every candidate and print a comparison to the console |
| *(none)* | Real model when WebGPU is available, otherwise fall back to the mock and say why |

The default model is `onnx-community/Qwen3-0.6B-ONNX` at `q4f16` on WebGPU; see
`src/ai/ModelConfig.ts` for the candidate set. Expect a download of several
hundred megabytes on first real-model run — about 543 MB for the 0.6B candidate,
1360 MB for the 1.7B one. Transformers.js caches it in the browser, so subsequent
runs reuse it.

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
3. `npm run dev`, open `http://localhost:5173/?mockAi=1`, click the canvas to
   capture the mouse, walk north toward the apartments until `[E] Talk to Maria`
   appears, press `E`, and send a message. The reply streams in and lands in the
   transcript.
4. Send a second message and press **Cancel reply** mid-stream. The partial reply
   is kept in the transcript and the composer becomes usable again.
5. Close the conversation and expand the **Memory** panel in the bottom-left. Every
   proposed memory appears with the decision made and the reason for it.
6. Reload the page and talk to Maria again. Her relationship section in the prompt
   now reads `acquaintance`, and the memory you formed in step 5 appears under
   RETRIEVED MEMORIES.

Headless browser automation cannot capture the pointer, so any Playwright test
must stub `pointerLockElement` or the game needs a non-pointer-locked entry
point.

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
