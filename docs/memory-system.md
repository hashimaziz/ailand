# Memory System

How an NPC comes to remember something, and why the language model is never
allowed to decide that on its own.

The governing rule, from the plan: **the model proposes, the simulation disposes.**
Raw model output must never mutate canonical game state. Everything below exists
to make that rule enforceable rather than aspirational.

## The three layers of truth

| Layer | Owner | Can the model change it? |
| --- | --- | --- |
| Authoritative world truth | The simulation | No. Ever. |
| NPC knowledge, belief, rumour | The memory store, written by policy | Only by proposing something the policy accepts |
| Natural language | The model, freely | Yes, and that is the point |

A memory's `source` field is where authority lives:

- `world` — copied from authoritative simulation data. Canonical.
- `player` — something the player said. True as *"the player said this"*, not as
  world truth.
- `npc` — learned from another NPC. Gossip, possibly wrong.
- `observation` — the NPC saw it happen.
- `inference` — the NPC worked it out. Carries its own confidence.

A memory's `type` describes what kind of claim it is: `fact`, `episodic`,
`belief`, `rumor`, or `relationship`.

## Formation pipeline

```
conversation closes
  → significance gate           is this conversation worth an extraction round-trip?
  → structured extraction       second, low-temperature generation, strict JSON
  → parse and normalize        repair numbers, clamp, coerce entities; never throw
  → policy                      validate, dedupe, supersede, cap, prune
  → persist                     IndexedDB
  → relationship update         bounded, clamped, persisted
  → report                      memory proposal panel
```

Extraction happens when the conversation closes, not after every turn. The panel
closes immediately and formation continues in the background, so the player is
never held waiting on a second generation.

### The significance gate

A conversation must contain at least one player turn and
`MEMORY_CONFIG.minConversationChars` characters. Below that, no model call is
made at all. This is the first line of defence against memory filling with
"hello".

### Structured extraction

`buildExtractionMessages` sends the extraction system prompt, the character, and
the flattened transcript, and asks for one JSON object:

```json
{
  "memories": [
    {
      "type": "episodic",
      "content": "The player said they are moving to the neighbourhood.",
      "importance": 0.7,
      "confidence": 1.0,
      "source": "player",
      "entities": ["player"],
      "locationId": "apartments"
    }
  ],
  "relationship_updates": [
    { "delta": { "familiarity": 0.04, "trust": 0.02 }, "labels": ["acquaintance"] }
  ]
}
```

Small models wrap JSON in prose or code fences even when instructed not to, so
`extractJsonObject` scans for the outermost balanced brace while respecting
strings and escapes, rather than trusting the response to be clean. A response
with no recoverable JSON is reported as a failure and **nothing is written** — a
broken extraction must never corrupt what the NPC already knows.

`normalizeCandidate` then repairs what it can (clamping `importance` and
`confidence` into 0..1, lowercasing entities, truncating oversized content) and
reports every repair as a warning. Structurally impossible entries are dropped
individually, so one bad memory does not discard the rest of the extraction.

### Policy decisions

`MemoryProcessor` applies these in order, recording a reason for each:

1. **Schema and provenance.** Invalid enums, out-of-range values, oversized or
   empty content are rejected.
2. **Authority.** A candidate claiming `source: "world"`, or `type: "fact"` from
   any model-authored source, is rejected outright. The model has no route to
   authoritative truth.
3. **Value floor.** `importance` below `MEMORY_CONFIG.minImportance` is treated as
   chatter and dropped.
4. **Placeholders.** `n/a`, `none`, `nothing` and similar are not memories.
5. **Duplicates.** Exact match first, then lexical Jaccard similarity over content
   tokens at or above 0.8. A near-duplicate is *merged* into the existing memory
   (importance and confidence take the maximum, entities are unioned) rather than
   stored twice.
6. **Supersession.** A confident candidate of a supersedable type, covering
   exactly the same entity set as an existing memory of the same type and source,
   supersedes it. The older memory is **kept on disk** with its provenance intact
   and is excluded from prompts by `applySupersession`, so history survives while
   currency changes.
7. **Per-conversation cap.** At most four memories are created per conversation,
   no matter how many the model proposes.
8. **Bounded growth.** Past `MEMORY_CONFIG.maxMemoriesPerNpc` for an NPC, the
   weakest memories are pruned by `retentionScore = importance × (0.7 + 0.3 × recency)`,
   where recency fades over a simulated week. Importance dominates, so a genuinely
   important memory is never pruned in favour of a fresher trivial one. World facts
   are never pruned. No model call is made for maintenance.

### Relationship updates

A relationship is a small snapshot (`familiarity`, `trust`, `affection`,
`tension`, `labels`) persisted per NPC in the `meta` store.

- At most **one** update is applied per conversation, however many the model emits.
- Each delta is clamped to ±`MEMORY_CONFIG.maxRelationshipDelta` (0.15), so a
  single conversation can turn a stranger into an acquaintance but never into a
  best friend.
- Resulting values are clamped to 0..1.
- Labels are model-authored free text, so they are lowercased, stripped of
  non-word characters, length-limited, de-duplicated, and capped at five.

These bounds are the point. An LLM asked how a conversation felt will confidently
propose `familiarity +0.9`; the policy decides what actually happens.

## Recall quality rules

Two asymmetries and two filters were added after observing real failures:

- **Entity length is symmetric.** Memory entities come from the model and are
  often three letters ("fox", "dog"). Filtering the player's message at four
  characters while memories kept three made those memories permanently
  unrecallable. Both sides now use the same three-character floor.
- **Conversational words are not topics.** Entity overlap carries the largest
  weight, so "like", "know", "think" being treated as entities made unrelated
  memories match. The stop list is deliberately conversational.
- **There is a relevance floor.** Every memory earns importance and recency score
  regardless of the question, so without a floor a large memory store fills every
  prompt — and the recall note restates the top two — with unrelated material.
- **Personality restatements are not memories.** Extraction sometimes produced
  "Maria is friendly and observant", which is already in every prompt. Candidates
  made almost entirely of the NPC's own vocabulary are rejected.
- **Memories must be in the third person.** Qwen2.5-3B produced "I just moved
  into the apartments above the bakery" — the *player's* event, in the NPC's
  voice. Stored as a memory it is actively harmful: read back as "this happened to
  me", the NPC concludes it was the one who moved in, and starts inventing details
  ("a small apartment by the park"). Candidates beginning with a first-person
  subject are rejected, and the extraction prompt asks for third person explicitly.

## Retrieval

Retrieval is deterministic and budgeted — see
[`architecture.md`](./architecture.md#memory) for the current weights. Two
properties matter for the prototype's claims:

- Retrieval operates on **active** memories only, so a superseded belief is not
  offered to the model as current.
- World facts are excluded from the personal memory section and presented
  separately as WORLD TRUTH, which is how the NPC/rumor distinction becomes
  observable in a prompt.

## Initial state

`src/memory/seedMemories.ts` writes a fixed starting memory set on first run:
canonical world facts for both NPCs, plus beliefs and a rumour that are
deliberately *not* authoritative — David "believes" the shop may close, Maria
heard a rumour about a fox. Timestamps are fixed rather than relative to page
load so a save is reproducible.

## Verification

```bash
npx vitest run tests/unit/MemoryValidator.test.ts tests/unit/MemoryFormation.test.ts \
                tests/unit/MemoryProcessor.test.ts tests/unit/Relationship.test.ts
```

`MemoryProcessor` takes a narrow `MemoryPersistence` port, so the policy is
tested against an in-memory store — no IndexedDB, and no model download, in jsdom.

Manual check: talk to Maria, introduce yourself, close the conversation, and
expand the **Memory** panel in the bottom-left. Reload the page, talk to her
again, and inspect the prompt: the relationship should read `acquaintance` and
the memory about your name should appear under RETRIEVED MEMORIES.

## Known limits

- Contradiction detection is deliberately conservative. It fires only on an exact
  entity-set match, so genuinely contradictory statements about the same subject
  phrased differently will both persist. Real contradiction tracking and belief
  graphs are future work (plan §28).
- Extraction runs once per conversation, so a conversation interrupted by a page
  reload is not remembered.
- Memory formation costs a second generation per conversation. With the default
  model that is seconds of background work after the panel closes.
- The relevance floor on retrieval does not exist yet, so low-scoring memories
  can still reach the prompt.
