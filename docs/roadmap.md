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
| 7 | Memory formation | `feat: add conversation memory formation and validation` | In progress |
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

## Milestone 7 — in progress

Deliverables: structured memory extraction after a conversation, runtime schema
validation, memory proposal UI, acceptance/rejection logic, and relationship
update processing.

The point of this milestone is that it makes the prototype's thesis testable.
Without it, an NPC forgets everything the moment the panel closes, and criteria
10, 11, 12 and 13 of the plan's acceptance list cannot pass.

## Remaining ordering rationale

Milestone 7 comes before Milestone 8 on purpose. The inspector is most useful
once there is real memory state to inspect, and the north-star test (talk → leave
→ advance days → return → continuity) is the thing that decides whether the
prototype is worth polishing. Debug tooling cannot rescue a memory system that
does not work.

Deferred, and why:

- **Forwarding `enable_thinking` to the Qwen3 chat template** — belongs with the
  next AI runtime change; it is a latency fix, not a correctness one.
- **End-to-end tests** — Milestone 9. Headless Chromium blocks pointer lock, so
  the suite needs a deliberate entry point rather than a workaround bolted on now.
- **Seeded world generation** — replace `Math.random()` for NPC colours and any
  later cosmetic variation, per plan §24.
- **Retrieval relevance floor and full scoring weights** — plan §8 defines six
  weighted signals; only four are implemented. Worth doing once there are real
  memories to evaluate against the memory-selectivity test set in plan §33.
