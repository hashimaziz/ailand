# Roadmap

Milestone definitions come from [`implementation-plan.md`](./implementation-plan.md)
§35. Status reflects what is actually in `main`, not what is planned.

| # | Milestone | Commit | Status |
| --- | --- | --- | --- |
| 0 | Project foundation | `chore: establish browser game project foundation` | Done |
| 1 | Rendering shell | `feat: add Three.js WebGPU world shell` | Done |
| 2 | Player + neighborhood | `feat: build playable neighborhood and player controller` | Done |
| 3 | NPC simulation | `feat: implement persistent NPC simulation and schedules` | Done |
| 4 | Persistence + memory | `feat: implement persistence, IndexedDB, and memory schema` | Done |
| 5 | AI runtime spike | `feat: add browser WebGPU language model runtime` | Done |
| 6 | Conversation system | `feat: implement NPC conversation pipeline` | Done |
| 7 | Memory formation | `feat: add conversation memory formation and validation` | Done |
| 8 | Debug tooling | `feat: add NPC simulation and AI debugging tools` | Not started |
| 9 | Quality + performance | `test:` / `perf:` / `fix:` | Not started |
| 10 | Prototype release | `chore: prepare persistent AI NPC prototype release` | Not started |

## Milestone 6 — delivered

Conversation manager, budgeted context assembly, prompt builder, dialogue UI with
streaming, cancellation, and error handling. The player can approach an NPC,
open a conversation, and receive a streamed in-character reply from the local
model. The prompt carries a bounded amount of identity, world truth, relationship,
situation, retrieved memory, and recent dialogue rather than an unbounded history.

Defects found and fixed while completing it, plus API findings, are listed in
[`architecture.md`](./architecture.md#deviations-and-findings).

## Milestone 7 — delivered

Structured memory extraction after a conversation, runtime schema validation with
clamped repair, a memory proposal panel showing every accept/reject decision and
its reason, acceptance/rejection and merge/supersede logic, bounded memory growth
by pruning, and bounded relationship updates. NPCs now start with world facts plus
their own beliefs and rumours.

The prototype's central claim is now demonstrable: introduce yourself to Maria,
close the conversation, reload the page, and talk to her again — her relationship
reads `acquaintance` rather than `stranger`, and the memory of your name is in
her retrieved memories. Details in [`memory-system.md`](./memory-system.md).

## Remaining ordering rationale

Milestone 8 (debug tooling) comes next because there is now real state worth
inspecting: an NPC inspector showing prompt sections, retrieved versus excluded
memories, model settings, latency metrics, and simulation controls is the fastest
way to find out why a reply felt wrong.

Deferred, and why:

- **End-to-end tests** — Milestone 9. Headless Chromium blocks pointer lock, so
  the suite needs a deliberate entry point rather than a workaround bolted on now.
- **The remaining 8 NPC fixtures** — §17 calls for ~10 with cross-NPC
  relationships for gossip. Worth doing once the loop is stable enough that ten
  NPCs' worth of memories can be evaluated at once.
- **Seeded world generation** — replace `Math.random()` for NPC colours and any
  later cosmetic variation, per plan §24.
- **Retrieval relevance floor and full scoring weights** — plan §8 defines six
  weighted signals; only four are implemented. Worth doing now that there are real
  memories to evaluate against the memory-selectivity test set in plan §33.
- **Queued extraction** — memory formation competes with conversation for a single
  generation slot (plan §27). One conversation at a time makes this invisible.
