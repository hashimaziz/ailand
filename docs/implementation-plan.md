AI NPC City Prototype — Engineering Plan
Status: Implementation-ready architecture Target: Browser-first technical prototype Primary goal: Prove that a small 3D explorable neighborhood populated by persistent AI NPCs can feel socially persistent while running the language model locally in the browser. Date: 2026-09-27
￼
1. Product Thesis
The prototype is a small first-person 3D neighborhood where the primary gameplay loop is wandering, discovering places, encountering people, talking to them, and gradually becoming familiar with them.
The defining feature is that NPCs are persistent individuals rather than disposable dialogue generators:
	●	NPCs have identities and personalities.
	●	NPCs have schedules and move through the world independently of the player.
	●	NPCs remember selected meaningful interactions with the player.
	●	NPCs have relationships with other NPCs.
	●	NPCs can hold beliefs or rumors that differ from authoritative world facts.
	●	A single shared language model is used for all NPC dialogue.
	●	The model is conditioned on a compact per-NPC state/memory record.
	●	The model is not allowed to redefine authoritative game reality.
The prototype is successful when the player can meet an NPC, have a memorable interaction, leave for several in-game days, return, and reasonably expect the NPC to recognize the prior relationship without the conversation becoming an obvious scripted state machine.
This project is explicitly not trying to solve the final problem of simulating millions of fully active autonomous agents. It is trying to establish the architecture that could eventually support that direction.
￼
2. Scope of the Prototype
In scope
	●	Browser-based application.
	●	TypeScript.
	●	Vite.
	●	Three.js.
	●	Three.js WebGPURenderer, with WebGL2 fallback for rendering where available.
	●	WebGPU for local ML inference where supported.
	●	Transformers.js for browser ML inference.
	●	A dedicated Web Worker for model loading and generation.
	●	IndexedDB-backed persistent game state.
	●	Approximately 10 NPCs.
	●	One compact fictional neighborhood/block.
	●	Basic first-person movement.
	●	Buildings, streets, landmarks, and a small public area.
	●	NPC movement and deterministic schedules.
	●	NPC personalities and biographies.
	●	NPC relationships.
	●	Persistent NPC memories.
	●	Memory retrieval with a strict context budget.
	●	LLM-generated dialogue.
	●	Structured memory extraction after conversation.
	●	Developer-facing NPC inspector/debug UI.
	●	Unit tests for core simulation and memory logic.
	●	A small end-to-end browser test suite.
	●	Performance instrumentation.
Explicitly out of scope
	●	Massive open-world map generation.
	●	Real-world map licensing/integration.
	●	Multiplayer.
	●	Server-authoritative gameplay.
	●	Cloud inference as a requirement for core gameplay.
	●	Voice input/output.
	●	Advanced animation.
	●	Advanced combat.
	●	Procedural quest generation as a primary system.
	●	Fully autonomous background reasoning for every NPC.
	●	LLM inference every frame or every simulation tick.
	●	A distributed backend.
	●	A production authentication/account system.
	●	A large vector database.
￼
3. Architectural Decisions
These decisions are intentional and should be treated as the default architecture unless implementation research reveals a concrete incompatibility.
3.1 Application architecture
Use a vanilla TypeScript + Vite + Three.js application rather than React/Vue/Svelte.
Reason: the dominant problem is a real-time 3D application, not a document/UI-heavy application. A minimal DOM UI can be managed directly, reducing framework overhead and keeping the render/game loop straightforward.
3.2 Renderer
Use Three.js WebGPURenderer rather than directly authoring a raw WebGPU renderer.
Reasons:
	●	Three.js provides scene graph, camera, materials, loaders, animation utilities, and other game-facing primitives.
	●	WebGPURenderer is designed to use WebGPU and can fall back to WebGL2 when WebGPU is unavailable.
	●	This leaves the project free to use Three.js abstractions without writing a renderer.
The rendering layer must not depend on the AI layer.
3.3 Language runtime
Use Transformers.js for local browser inference.
Use the current stable NPM package at implementation time and validate APIs against the current official documentation rather than copying examples from an older version.
The model runtime must be isolated behind an application-defined interface so that the implementation can later be swapped for:
	●	a different local browser model,
	●	a desktop/local inference server,
	●	a cloud API,
	●	or another browser runtime.
3.4 Inference execution
Run model inference in a dedicated Web Worker.
The main thread owns rendering, input, UI, and world simulation. Model loading/tokenization/generation must not block the render loop.
The worker communicates through typed request/response messages. Use native postMessage initially rather than introducing another RPC abstraction.
3.5 Default model strategy
The initial model candidate is Qwen3-0.6B in the ONNX/Transformers.js-compatible form, using the q4f16 quantized model where supported.
Current verified artifacts include an ONNX Community Qwen3-0.6B model with Transformers.js examples using device: "webgpu" and dtype: "q4f16". The listed q4f16 artifact is roughly 570 MB in one current repository snapshot; the instruct-specific ONNX repository lists a roughly 648 MB q4f16 artifact. Exact artifact size should be re-checked at implementation time.
Qwen3-0.6B is attractive for this prototype because it is explicitly in the sub-billion-parameter range and supports an explicit non-thinking mode. For ordinary NPC conversation, thinking mode should be disabled to reduce latency and wasted tokens.
Do not hard-code the application architecture around this model. Implement a model adapter and a model capability/configuration layer.
3.6 Model benchmarking policy
Before making the model a permanent project dependency, benchmark at least:
	1.	Qwen3-0.6B ONNX, q4f16.
	2.	SmolLM2-360M ONNX, q4f16.
	3.	One larger small-model candidate if the machine used for development can handle it, such as a ~1–2B instruct model.
The benchmark should record:
	●	model download size,
	●	model initialization time,
	●	first-token latency,
	●	generation throughput,
	●	total generation latency,
	●	approximate memory footprint where practical,
	●	response quality on a fixed NPC-dialogue test set.
The benchmark decides what is used by default; the architecture does not depend on any one result.
3.7 Persistence
Use IndexedDB, accessed through a small application-owned repository layer.
Do not use a server database in the initial prototype.
A typed IndexedDB wrapper may be used if it significantly reduces boilerplate, but do not make persistence logic leak into game objects or UI components.
3.8 Memory retrieval
Start with deterministic retrieval and scoring. Do not introduce a vector database at prototype start.
Relevant memories are selected using a weighted combination of:
	●	lexical/entity overlap,
	●	memory importance,
	●	recency,
	●	relationship relevance,
	●	location relevance,
	●	conversation-topic relevance,
	●	memory type/authority.
Design the retrieval interface so embeddings can be inserted later without changing the conversation manager.
3.9 Game truth vs NPC knowledge
The system has three different layers of truth:
Authoritative world truth
The simulation/database owns facts such as:
	●	building locations,
	●	business hours,
	●	NPC schedules,
	●	NPC current locations,
	●	item ownership,
	●	quest/state flags if any.
These are authoritative.
NPC knowledge/beliefs
What an NPC knows, remembers, suspects, or believes.
These can be incomplete, stale, or wrong.
LLM output
The LLM proposes natural language and structured memory candidates. It does not own authoritative state.
Never allow raw model output to directly mutate canonical game state.
3.10 LLM memory policy
An NPC’s memory is not a transcript.
Conversation history is temporary working context. Meaningful events are distilled into durable memories.
The context passed to the LLM must be strictly budgeted.
The full NPC memory set must never be blindly serialized into every prompt.
3.11 Memory authority
Every durable memory has explicit provenance/authority.
Minimum source categories:
	●	world
	●	player
	●	npc
	●	observation
	●	inference
Every memory also has a type:
	●	fact
	●	episodic
	●	belief
	●	rumor
	●	relationship
3.12 Debuggability
The NPC inspector is a first-class engineering feature.
For any conversation, the developer must be able to inspect:
	●	NPC state,
	●	relationship state,
	●	retrieved memories,
	●	excluded candidate memories when useful,
	●	exact prompt sections supplied to the model,
	●	model generation settings,
	●	model output,
	●	proposed memory updates,
	●	accepted/rejected memory updates.
Do not expose or attempt to reconstruct hidden model chain-of-thought. Show structured inputs, outputs, and system decisions.
￼
4. High-Level System Architecture
                         ┌───────────────────────────┐
                         │        Browser App        │
                         │                           │
                         │  Three.js + DOM UI       │
                         └─────────────┬─────────────┘
                                       │
                              Game commands/events
                                       │
                                       ▼
                         ┌───────────────────────────┐
                         │     World Simulation      │
                         │                           │
                         │  time                     │
                         │  NPC schedules            │
                         │  NPC positions            │
                         │  world facts              │
                         │  interactions             │
                         └───────┬───────────┬───────┘
                                 │           │
                        state    │           │ conversation
                                 │           ▼
                                 │  ┌────────────────────┐
                                 │  │ ConversationManager│
                                 │  └─────────┬──────────┘
                                 │            │
                                 │            ├── ContextAssembler
                                 │            ├── MemoryRetriever
                                 │            ├── PromptBuilder
                                 │            └── MemoryProcessor
                                 │
                                 ▼
                         ┌───────────────────┐
                         │   Memory Store    │
                         │                   │
                         │ IndexedDB         │
                         │ NPC profiles      │
                         │ Memories          │
                         │ Relationships     │
                         └───────────────────┘

ConversationManager
        │
        │ typed worker messages
        ▼
┌───────────────────────────┐
│       AI Web Worker       │
│                           │
│  Transformers.js          │
│  tokenizer                │
│  shared model instance    │
│  WebGPU backend           │
└───────────────────────────┘
The shared language model is loaded once per page/session/worker and reused for every NPC. NPC identity lives in application data, not model instances.
￼
5. Repository Structure
Target structure:
/
├── docs/
│   ├── architecture.md
│   ├── roadmap.md
│   ├── memory-system.md
│   ├── ai-runtime.md
│   └── development.md
├── public/
│   ├── favicon.svg
│   └── assets/
├── src/
│   ├── main.ts
│   ├── app/
│   │   ├── App.ts
│   │   └── AppState.ts
│   ├── render/
│   │   ├── Renderer.ts
│   │   ├── Scene.ts
│   │   ├── Camera.ts
│   │   └── Lighting.ts
│   ├── world/
│   │   ├── World.ts
│   │   ├── WorldClock.ts
│   │   ├── WorldFacts.ts
│   │   ├── LocationRegistry.ts
│   │   └── Building.ts
│   ├── player/
│   │   ├── PlayerController.ts
│   │   └── InteractionController.ts
│   ├── npc/
│   │   ├── Npc.ts
│   │   ├── NpcFactory.ts
│   │   ├── NpcSimulation.ts
│   │   ├── Schedule.ts
│   │   ├── Personality.ts
│   │   ├── Relationship.ts
│   │   └── NpcRegistry.ts
│   ├── memory/
│   │   ├── types.ts
│   │   ├── MemoryStore.ts
│   │   ├── MemoryRetriever.ts
│   │   ├── MemoryScorer.ts
│   │   ├── MemoryValidator.ts
│   │   └── MemoryFormation.ts
│   ├── conversation/
│   │   ├── ConversationManager.ts
│   │   ├── ContextAssembler.ts
│   │   ├── PromptBuilder.ts
│   │   ├── ContextBudget.ts
│   │   └── ConversationTypes.ts
│   ├── ai/
│   │   ├── LanguageModel.ts
│   │   ├── ModelConfig.ts
│   │   ├── ModelCapabilities.ts
│   │   ├── LocalTransformersModel.ts
│   │   ├── AiWorkerClient.ts
│   │   └── worker.ts
│   ├── persistence/
│   │   ├── Database.ts
│   │   ├── repositories/
│   │   └── migrations/
│   ├── debug/
│   │   ├── DebugOverlay.ts
│   │   ├── NpcInspector.ts
│   │   └── PerformancePanel.ts
│   ├── ui/
│   │   ├── DialoguePanel.ts
│   │   ├── StatusPanel.ts
│   │   └── LoadingScreen.ts
│   ├── config/
│   │   └── gameConfig.ts
│   └── utils/
│       ├── ids.ts
│       └── time.ts
├── tests/
│   ├── unit/
│   └── e2e/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── .gitignore
└── README.md
The exact files may evolve, but subsystem boundaries should remain recognizable.
￼
6. Domain Model
6.1 NPC
interface Npc {
  id: string;
  identity: NpcIdentity;
  personality: PersonalityProfile;
  biography: string;
  occupationId: string;
  homeLocationId: string;
  schedule: Schedule;
  state: NpcState;
}
6.2 Personality
Personality should be a compact structured profile, not a giant prose biography.
Example:
interface PersonalityProfile {
  traits: string[];
  speechStyle: string[];
  values: string[];
  dislikes: string[];
  socialDisposition: number;
  trustBaseline: number;
}
Keep it bounded and stable. Personality is part of the NPC’s identity and should not be rewritten by ordinary conversation.
6.3 NPC state
interface NpcState {
  locationId: string;
  mood: string;
  energy: number;
  stress: number;
  hunger: number;
  currentActivity: string;
  lastSimulatedAt: number;
}
These values are simulation state. The model may express them but does not directly own them.
6.4 Relationship
interface Relationship {
  id: string;
  subjectNpcId: string;
  objectId: string;
  objectType: "npc" | "player";
  familiarity: number;
  trust: number;
  affection: number;
  tension: number;
  labels: string[];
  updatedAt: number;
}
The first prototype can keep relationship evolution intentionally simple and deterministic.
￼
7. Memory Data Model
interface Memory {
  id: string;
  npcId: string;
  type: MemoryType;
  content: string;
  importance: number;      // 0..1
  confidence: number;      // 0..1
  source: MemorySource;
  entities: string[];
  locationId?: string;
  createdAt: number;
  lastAccessedAt: number;
  supersedesId?: string;
}
Authority semantics
	●	world/fact: canonical fact copied from authoritative game data. It can be shown to the model as ground truth.
	●	player/*: information explicitly provided by the player. The NPC can remember it as something the player said, but it does not automatically become world truth.
	●	npc/*: something learned from another NPC; may be truthful or gossip.
	●	observation/*: something the NPC observed in the world.
	●	inference/*: something the NPC concluded; must carry confidence and should not be presented as certain unless the NPC has high confidence.
Memory lifecycle
Conversation event
       ↓
Candidate extraction
       ↓
Schema validation
       ↓
Deduplication / conflict detection
       ↓
Importance + confidence scoring
       ↓
Policy decision
       ↓
Persist
       ↓
Future retrieval
Memory pruning
The first prototype does not need sophisticated forgetting, but it should implement bounded growth.
Recommended policy:
	●	Keep a small recent-event window.
	●	Keep high-importance memories indefinitely.
	●	Decay low-importance memories by retrieval score.
	●	Merge near-duplicate memories during maintenance.
	●	Allow newer memories to supersede older contradictory beliefs without deleting provenance.
Do not run a background LLM process solely to prune memory.
￼
8. Memory Retrieval Design
The retriever takes:
interface MemoryQuery {
  npcId: string;
  playerMessage: string;
  currentLocationId?: string;
  mentionedEntities: string[];
  currentTime: number;
}
It returns ranked candidates:
interface MemoryMatch {
  memory: Memory;
  score: number;
  reasons: string[];
}
Initial scoring
Use a transparent weighted score, for example:
score =
    0.30 * topic/entity relevance
  + 0.20 * importance
  + 0.15 * recency
  + 0.15 * relationship relevance
  + 0.10 * location relevance
  + 0.10 * authority/utility
These weights are starting values, not immutable constants. Put them in configuration and expose them in the debug UI.
Retrieval procedure
	1.	Load candidate memories for the NPC.
	2.	Filter obviously irrelevant or expired memories.
	3.	Compute deterministic lexical/entity relevance.
	4.	Apply importance and recency scores.
	5.	Add relationship/location context.
	6.	Rank candidates.
	7.	Select top candidates under the memory token/character budget.
	8.	Record exactly which memories were selected for debugging.
	9.	Update lastAccessedAt for selected memories.
Future extension
The retriever interface should permit a second implementation that uses embeddings. Do not build that implementation until the deterministic system demonstrates an actual semantic-retrieval failure mode.
￼
9. Context and Prompt Architecture
A conversation context has bounded sections.
Recommended initial budget for an approximately 1K–2K-token prompt, to be tuned through benchmarking:
SYSTEM / behavior rules     ~250–350 tokens
NPC identity                ~150–250
WORLD TRUTH                 ~150–250
RELATIONSHIP                ~100–150
CURRENT SITUATION           ~100–150
RETRIEVED MEMORIES          ~300–500
RECENT DIALOGUE             ~200–300
PLAYER MESSAGE              ~50–150
-----------------------------------------
Target                     ~1,300–2,100
These are character/token targets, not hard assumptions about model capabilities. The implementation must calculate a real limit based on the selected model and configuration.
Prompt rules
The system prompt should establish:
	1.	Identity.
	2.	Personality.
	3.	Conversational role.
	4.	Game/world grounding rules.
	5.	Difference between fact, belief, rumor, and uncertainty.
	6.	Instruction to avoid inventing hard world facts.
	7.	Style constraints for short, natural dialogue.
The model should be told that:
	●	it is one NPC, not a generic assistant;
	●	it should answer as that NPC;
	●	it should use supplied memories as the NPC’s knowledge;
	●	uncertain memories should be expressed with appropriate uncertainty;
	●	it must not claim awareness of information outside supplied knowledge unless it can infer it naturally from current visible world context;
	●	it should keep ordinary NPC responses concise.
Response length
Default dialogue should usually target one to three short sentences.
This is a game, not a chatbot interface. Long responses consume model budget and reduce conversational pacing.
Use a configurable max_new_tokens, starting conservatively around 64–128 for ordinary conversation.
￼
10. Conversation Pipeline
Player enters interaction range
          ↓
Player presses interact
          ↓
Conversation session opens
          ↓
Game gathers NPC + world state
          ↓
Memory retriever selects relevant memories
          ↓
Context budgeter assembles bounded context
          ↓
Prompt builder creates model input
          ↓
AI worker generates response
          ↓
Response streams to dialogue UI
          ↓
Turn completes
          ↓
Memory extraction produces candidates
          ↓
Validator checks schema + provenance
          ↓
Memory manager accepts/rejects/merges
          ↓
Relationship state updated where appropriate
          ↓
Conversation session remains available for next turn
A conversation session must not be allowed to grow without bound.
Maintain only a short recent conversational window and rely on durable memories for older material.
￼
11. Structured Memory Extraction
Do not use free-form prose as the persistence format.
After each conversation turn (or at a sensible conversation-end boundary), run a structured extraction request.
Example target format:
{
  "memories": [
    {
      "type": "episodic",
      "content": "The player told Maria they are moving to the neighborhood.",
      "importance": 0.7,
      "confidence": 1.0,
      "source": "player",
      "entities": ["player", "Maria"],
      "locationId": "blue-door"
    }
  ],
  "relationship_updates": [
    {
      "objectType": "player",
      "objectId": "player",
      "delta": {
        "familiarity": 0.04,
        "trust": 0.02
      }
    }
  ]
}
The exact schema can evolve.
Validation requirements
Every candidate must be validated before persistence.
Reject candidates that:
	●	violate enum/schema constraints,
	●	assert a canonical world fact without a world-authoritative source,
	●	exceed size limits,
	●	duplicate an existing memory beyond a configured similarity threshold,
	●	contain obvious empty/garbage content.
For the prototype, schema validation should be performed with a runtime validation library or explicit validator. Keep the runtime schema close to the TypeScript types.
￼
12. LLM Runtime Interface
Application-facing interface:
interface LanguageModel {
  initialize(options?: InitializeOptions): Promise<ModelInfo>;
  generate(request: GenerationRequest): AsyncIterable<GenerationEvent>;
  cancel(requestId: string): Promise<void>;
  dispose(): Promise<void>;
}
Possible events:
type GenerationEvent =
  | { type: "started"; requestId: string }
  | { type: "token"; requestId: string; text: string }
  | { type: "completed"; requestId: string; usage?: GenerationUsage }
  | { type: "error"; requestId: string; message: string };
The main thread must never import Transformers.js directly for the generation path.
Only the AI worker/runtime implementation should depend on it.
￼
13. Web Worker Protocol
Typed worker messages:
interface WorkerInitMessage {
  type: "initialize";
  config: ModelConfig;
}

interface WorkerGenerateMessage {
  type: "generate";
  requestId: string;
  messages: ChatMessage[];
  generation: GenerationConfig;
}

interface WorkerCancelMessage {
  type: "cancel";
  requestId: string;
}
Response events:
interface WorkerReadyEvent {
  type: "ready";
  model: ModelInfo;
}

interface WorkerProgressEvent {
  type: "progress";
  phase: "download" | "load" | "initialize";
  progress?: number;
  message?: string;
}

interface WorkerTokenEvent {
  type: "token";
  requestId: string;
  text: string;
}
The worker owns a singleton pipeline/model instance. Do not repeatedly load the model for each NPC or each conversation.
￼
14. Model Configuration
Model configuration belongs in one place.
Example:
interface ModelConfig {
  id: string;
  task: "text-generation";
  device: "webgpu" | "wasm";
  dtype?: string;
  enableThinking: boolean;
  maxContextTokens: number;
  defaultMaxNewTokens: number;
  temperature: number;
  topP: number;
  topK: number;
}
For Qwen3 non-thinking mode, use the current documented non-thinking sampling defaults as the initial baseline and benchmark from there. Do not leave reasoning/thinking enabled for ordinary NPC dialogue unless experimentation shows a compelling reason.
￼
15. Browser Capability Strategy
The initial supported environment is desktop Chromium-based browsers with WebGPU enabled.
The application still detects capabilities and degrades gracefully.
Capability states
SUPPORTED
  WebGPU + Web Worker inference available

PARTIAL
  Rendering works but local model inference is unavailable

UNSUPPORTED
  Required rendering or browser capabilities unavailable
Fallbacks
	●	Three.js WebGPURenderer may fall back to WebGL2 for rendering.
	●	ML runtime should expose a mock/local non-WebGPU path for development and automated testing.
	●	An actual CPU/WASM model path is optional and should only be added if useful after the main WebGPU prototype works.
Do not make the prototype pretend local AI is functioning when it is not.
Provide an explicit status message such as:
> Local AI is unavailable in this browser. Use a recent Chromium-based browser with WebGPU enabled.
For production hosting, use HTTPS. WebGPU is a secure-context capability.
￼
16. World Design
Create a tiny fictional neighborhood rather than using external geographic data.
Suggested layout:
                 NORTH
                   ↑
        ┌────────────────────┐
        │      APARTMENTS    │
        │   ┌──────┐ ┌────┐  │
        │   │Lobby │ │Home│  │
        └───┴──────┴─┴────┴──┘
                 │
================= STREET =================
      ☕         │             🏪
    COFFEE       │            SHOP
                 │
            ┌────┴─────┐
            │   PARK   │
            │          │
            │  🌳      │
            └──────────┘
The actual geometry can be primitive/low-poly.
Important landmarks:
	●	apartment building,
	●	coffee shop,
	●	small shop,
	●	park,
	●	street/intersection,
	●	bus stop or other recognizable public point.
These landmarks exist to make location-aware social behavior meaningful.
￼
17. NPC Population
Start with approximately 10 NPCs.
Each should have:
	●	unique identity,
	●	occupation,
	●	home,
	●	one or more daily destinations,
	●	a small personality profile,
	●	a few relationships,
	●	initial memories,
	●	schedule,
	●	current state.
Suggested archetypes:
	1.	barista
	2.	bartender/shopkeeper
	3.	mechanic
	4.	student
	5.	retired neighbor
	6.	delivery driver
	7.	musician
	8.	office worker
	9.	shop employee
	10.	local dog walker
These are archetypes, not hard requirements.
The characters should have relationships that produce opportunities for gossip and cross-person knowledge, but do not build a full social network simulator yet.
￼
18. NPC Schedules
Schedules should be deterministic and learnable.
Example:
Maria
08:00–09:00    Home
09:00–17:00    Coffee shop
17:00–20:00    Park / errands
20:00–22:00    Home
22:00–08:00    Home / sleep
The simulation converts schedule → desired location/activity. The LLM does not control routine movement.
Schedules should eventually support:
	●	time blocks,
	●	location IDs,
	●	activity label,
	●	optional randomness/jitter,
	●	exceptions.
The first implementation can use simple deterministic blocks.
￼
19. Time System
Implement an accelerated in-game clock.
For the prototype, use a configurable mapping such as:
1 real second = N in-game seconds
The exact ratio is configurable.
The developer should be able to advance time or jump to a chosen hour/day from the debug panel.
This is essential for testing memory persistence and schedule behavior without manually waiting.
￼
20. Player Interaction
First-person controller:
	●	WASD movement.
	●	Mouse look.
	●	Interaction key such as E.
	●	NPC interaction range.
	●	A subtle interaction indicator.
	●	No combat required.
When an NPC is in range:
[E] Talk to Maria
A conversation panel opens.
￼
21. Dialogue UI
The UI should make ordinary conversation feel like a game rather than a developer console.
Requirements:
	●	NPC name.
	●	NPC portrait/avatar placeholder if available; not required initially.
	●	Dialogue text.
	●	Player text input.
	●	Send/submit control.
	●	Streaming response display.
	●	Loading/generating indicator.
	●	Cancel generation control.
	●	Clear error state.
	●	Close conversation control.
Do not build branching dialogue menus as the primary interaction. The experiment is free-form dialogue.
￼
22. Developer Debug Tools
A debug toggle such as F3 opens the developer overlay.
NPC inspector
Show:
NPC
Name
Occupation
Location
Current activity
Mood
Energy
Stress

PERSONALITY
Traits
Speech style
Values
Dislikes

PLAYER RELATIONSHIP
Familiarity
Trust
Affection
Tension

MEMORIES
Canonical / facts
Episodic
Beliefs
Rumors

CURRENT CONTEXT
World facts supplied
Retrieved memories
Recent dialogue

MODEL
Model ID
dtype
device
sampling config

LAST RESPONSE
...

MEMORY PROPOSALS
...

ACCEPTED UPDATES
...
Simulation controls
Provide:
	●	pause/resume simulation,
	●	speed multiplier,
	●	advance one minute,
	●	advance one hour,
	●	advance one day,
	●	teleport player to landmark,
	●	select NPC,
	●	reset NPC memory,
	●	reset whole save.
AI metrics
Show:
	●	model ready state,
	●	model load time,
	●	model download progress,
	●	inference time,
	●	time to first token,
	●	tokens generated,
	●	tokens/sec,
	●	prompt size,
	●	retrieved memory count.
￼
23. Persistence Model
The save should be local and automatic.
Persist:
	●	game clock,
	●	player location if desired,
	●	NPC dynamic state,
	●	relationships,
	●	memories,
	●	current save/version metadata.
Do not persist the full render scene.
The world should reconstruct itself from deterministic configuration + persisted state.
Save-versioning
Include a schema/version field.
Example:
interface SaveMeta {
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  worldSeed: number;
}
If schema changes during development, handle migration in a simple explicit migration layer.
￼
24. Deterministic World Seed
Use a fixed world seed for the prototype.
A seeded utility should generate:
	●	initial NPC placement if needed,
	●	small cosmetic variation,
	●	optional schedule jitter,
	●	initial non-critical world variation.
Do not use non-deterministic randomness for canonical facts.
This makes debugging and bug reproduction much easier.
￼
25. Testing Strategy
Unit tests
Use Vitest.
Test:
	●	schedule selection at different times,
	●	location/activity transitions,
	●	NPC serialization,
	●	relationship updates,
	●	memory validation,
	●	memory ranking,
	●	recency scoring,
	●	duplicate detection,
	●	context budgeting,
	●	prompt construction,
	●	canonical fact protection,
	●	memory update acceptance/rejection,
	●	save/load persistence using a testable persistence adapter.
AI-free tests
The fast test suite must not download a language model.
Provide mocked LanguageModel implementations.
Test deterministic responses such as:
Mock model returns:
"Good morning. I remember you helped me with the dog."
Browser/E2E tests
Use Playwright for a small set of critical flows:
	1.	Application loads.
	2.	Player can move.
	3.	NPC is present.
	4.	Player can initiate a conversation.
	5.	Mock model can produce a response.
	6.	Memory persists after the conversation.
	7.	NPC inspector exposes the expected state.
A real-WebGPU test is optional and should be kept separate from the default deterministic CI suite because model availability and GPU hardware are environment-dependent.
￼
26. Performance Targets
These are targets for a convincing prototype, not production guarantees.
Rendering
	●	Maintain approximately 60 FPS on a typical modern desktop GPU with the small prototype scene.
	●	Avoid coupling simulation frequency to LLM inference.
Interaction
	●	UI should remain responsive during model initialization and inference.
	●	First-token latency should be measured, not guessed.
	●	Dialogue generation should be intentionally short.
Model
Record:
	●	download bytes,
	●	model initialization time,
	●	first-token latency,
	●	completion latency,
	●	tokens/sec,
	●	prompt character/token estimate,
	●	approximate memory usage where feasible.
Simulation
Do not run unnecessary per-frame work for all NPCs. The small prototype can update every NPC every simulation tick, but architect state updates so inactive/distant NPCs can later be throttled.
￼
27. Scaling Path to Large NPC Counts
The eventual vision may involve very large populations. The prototype architecture should preserve the important conceptual boundaries for that future.
What scales cheaply
	●	NPC identity records.
	●	Schedules.
	●	compact memories.
	●	relationships.
	●	world facts.
What is expensive
	●	model inference,
	●	token generation,
	●	long contexts,
	●	simultaneous conversations.
Therefore:
Most NPCs
   ↓
ordinary simulation only

Nearby/interacting NPC
   ↓
activate conversational AI

Important narrative NPC
   ↓
optionally use a larger/more capable model
Do not implement multi-model tiers yet. Preserve the abstraction that makes them possible.
Future model scheduling
A future scheduler could serialize/queue active conversations because a single local GPU model may not efficiently handle many concurrent generations.
For the prototype, one active generation at a time is acceptable and simpler.
￼
28. Memory Scaling Path
Long-term memory should be transformed rather than endlessly appended.
Future hierarchy:
Raw conversation
       ↓
recent working memory
       ↓
important episodic events
       ↓
semantic summaries / relationship state
       ↓
compressed long-term memory
Potential future features:
	●	semantic embeddings,
	●	memory clustering,
	●	episodic summarization,
	●	contradiction tracking,
	●	belief graphs,
	●	entity graph relationships.
None are required for the initial prototype.
￼
29. Prompt Security / Model Robustness
Even in a single-player local game, model output is untrusted.
Never use model output as executable code.
Never parse natural language by brittle substring assumptions when structured JSON is available.
Validate structured outputs.
Never let the model directly change:
	●	currency,
	●	inventory,
	●	world coordinates,
	●	canonical schedules,
	●	quest completion,
	●	hidden developer data,
	●	other authoritative simulation state.
If a future design needs tool/function calls, introduce explicit validated commands between the model and simulation.
￼
30. Error Handling
Model initialization failure
Show a recoverable state:
	●	reason if known,
	●	retry button,
	●	browser capability guidance.
Generation failure
Conversation remains open. Do not corrupt memory. Show a friendly in-game error and allow retry.
Memory failure
Dialogue can still complete even if memory persistence fails, but the debug panel should report the persistence error.
Browser storage unavailable
Use a clear error state. Do not silently convert to ephemeral storage unless explicitly configured.
￼
31. Logging
Use structured development logging with categories:
WORLD
NPC
MEMORY
CONVERSATION
AI
PERSISTENCE
PERFORMANCE
In production builds, logs should be reduced or disabled by configuration.
For development, the debug inspector should be more useful than raw console logs.
￼
32. Model Benchmark Harness
Create a reusable benchmark mode.
Input fixture:
NPC identity
NPC personality
World facts
Relationship
Memories
Player message
Run this against each candidate model with deterministic generation settings where possible.
Collect:
{
  "model": "...",
  "dtype": "q4f16",
  "device": "webgpu",
  "loadMs": 0,
  "firstTokenMs": 0,
  "generationMs": 0,
  "outputTokens": 0,
  "tokensPerSecond": 0,
  "promptTokens": 0,
  "memoryBytes": null,
  "response": "..."
}
The benchmark is a developer tool, not a gameplay feature.
￼
33. Quality Test Set for NPC Behavior
Create a small fixed set of conversational evaluations.
Examples:
Identity consistency
Player asks:
> What do you do around here?
Expected behavior:
NPC answers according to their occupation.
Memory continuity
Turn 1:
> My name is Alex.
Later:
> Do you remember my name?
Expected:
NPC may recall Alex if memory was accepted.
Memory selectivity
NPC has 30 memories unrelated to the current topic.
Expected:
They do not inflate the prompt with irrelevant material.
World truth grounding
Game truth:
> Pharmacy closes at 21:00.
NPC belief:
> Pharmacy probably closes at 20:00.
Expected:
NPC may express their belief but should not cause the game to change the actual closing time.
Relationship continuity
After several positive interactions:
Expected:
NPC’s tone should reflect increased familiarity/trust.
Contradiction handling
Old memory says:
> Player works at the hospital.
New player statement says:
> I quit the hospital.
Expected:
Old memory can remain historically valid while newer state supersedes current belief.
￼
34. Development Workflow
The repository is Git-managed from the beginning.
Git rules
	●	Use main as the stable branch.
	●	Keep commits coherent and intentional.
	●	Do not make artificial micro-commits.
	●	Do not combine unrelated work into a single commit.
	●	Every commit should leave the app in a reasonably buildable/testable state.
	●	Do not commit generated model weights.
	●	Do not commit browser caches.
	●	Do not commit local save data.
Commit style
Preferred format:
feat: add NPC schedule simulation
feat: implement persistent memory store
feat: add browser WebGPU model worker
feat: implement bounded conversation context
feat: add NPC inspector
fix: prevent model output from mutating world facts
refactor: isolate AI runtime behind LanguageModel
perf: instrument inference latency
Logical commit rule
A commit may contain many files.
The criterion is cohesion, not size.
Example of a good feature commit:
feat: implement persistent NPC memory
may contain:
	●	memory types,
	●	database schema,
	●	repository implementation,
	●	validation,
	●	retrieval code,
	●	tests,
	●	debug inspector changes necessary to inspect memory.
These all belong to one coherent feature.
Do not split that work merely to make the commit graph look busy.
￼
35. Milestones and Commit Plan
Milestone 0 — Project foundation
Deliver:
	●	Vite + TypeScript project.
	●	Strict TypeScript.
	●	Three.js dependency.
	●	testing tools.
	●	Git configuration.
	●	README.
	●	docs structure.
	●	basic CI-quality scripts.
Suggested commit:
chore: establish browser game project foundation
Acceptance:
	●	npm install works.
	●	dev server works.
	●	production build works.
	●	tests run.
	●	blank application renders.
Milestone 1 — Rendering shell
Deliver:
	●	Three.js scene.
	●	WebGPURenderer.
	●	WebGL2 fallback.
	●	camera.
	●	lighting.
	●	basic ground.
	●	simple environment.
Commit:
feat: add Three.js WebGPU world shell
Acceptance:
	●	stable render loop.
	●	capability status displayed.
	●	basic scene visible.
Milestone 2 — Player + neighborhood
Deliver:
	●	first-person controls.
	●	collision/basic boundaries.
	●	neighborhood geometry.
	●	landmarks.
	●	interaction ray/capsule detection.
Commit:
feat: build playable neighborhood and player controller
Acceptance:
	●	player can walk around the block.
	●	landmarks are recognizable.
	●	interaction target can be detected.
Milestone 3 — NPC simulation
Deliver:
	●	NPC domain model.
	●	NPC registry.
	●	schedules.
	●	world clock.
	●	movement.
	●	activity labels.
	●	initial 10 NPC fixtures.
Commit:
feat: implement persistent NPC simulation and schedules
Acceptance:
	●	NPCs visibly move.
	●	schedules can be inspected.
	●	simulation is independent from LLM.
Milestone 4 — Persistence + memory
Deliver:
	●	IndexedDB database.
	●	save/load.
	●	NPC persistence.
	●	relationships.
	●	memory schema.
	●	memory retrieval.
	●	deterministic scoring.
	●	memory validation.
	●	tests.
Commit:
feat: implement persistent NPC memory and relationships
Acceptance:
	●	restart browser/page and persistent data remains.
	●	memory ranking is testable.
	●	authoritative world facts are distinguishable from beliefs.
Milestone 5 — AI runtime spike
Deliver:
	●	model benchmark harness.
	●	LanguageModel abstraction.
	●	AI worker.
	●	Transformers.js integration.
	●	WebGPU capability detection.
	●	model loading/progress.
	●	candidate model benchmark.
Commit:
feat: add browser WebGPU language model runtime
Acceptance:
	●	chosen candidate model can load in a supported browser.
	●	generation works through the worker.
	●	rendering remains responsive.
	●	benchmark metrics are recorded.
Milestone 6 — Conversation system
Deliver:
	●	conversation manager.
	●	bounded context.
	●	prompt builder.
	●	dialogue UI.
	●	streaming text.
	●	cancellation.
	●	error handling.
Commit:
feat: implement NPC conversation pipeline
Acceptance:
	●	player can approach and talk to an NPC.
	●	NPC replies in character.
	●	model context contains only bounded relevant information.
Milestone 7 — Memory formation
Deliver:
	●	structured extraction.
	●	runtime schema validation.
	●	memory proposal UI.
	●	acceptance/rejection logic.
	●	relationship update processing.
Commit:
feat: add conversation memory formation and validation
Acceptance:
	●	meaningful facts can persist across conversations.
	●	irrelevant chatter does not fill memory indefinitely.
	●	world truth cannot be overwritten by hallucinated model output.
Milestone 8 — Debug tooling
Deliver:
	●	NPC inspector.
	●	context inspector.
	●	memory retrieval view.
	●	model metrics.
	●	simulation controls.
Commit:
feat: add NPC simulation and AI debugging tools
Acceptance:
	●	developer can explain why an NPC produced a response from observable structured state.
Milestone 9 — Quality + performance pass
Deliver:
	●	benchmark refinement.
	●	performance instrumentation.
	●	browser compatibility states.
	●	e2e tests.
	●	persistence tests.
	●	regression fixtures.
	●	UX cleanup.
Commits may include multiple coherent commits, for example:
test: add NPC conversation regression coverage
perf: instrument browser inference performance
fix: improve WebGPU capability error handling
Milestone 10 — Prototype release
Deliver:
	●	polished README.
	●	setup instructions.
	●	supported-browser notes.
	●	model download expectations.
	●	known limitations.
	●	clean startup flow.
	●	final smoke test.
Commit:
chore: prepare persistent AI NPC prototype release
￼
36. Acceptance Criteria for the Entire Prototype
The prototype is considered successful when all of the following work:
	1.	The user can load the browser game and enter a small 3D neighborhood.
	2.	The player can walk around naturally enough to explore.
	3.	Roughly 10 NPCs exist as persistent individuals.
	4.	NPCs follow schedules without needing the LLM to control basic simulation.
	5.	The player can approach an NPC and initiate dialogue.
	6.	A local browser model can generate the NPC response through the Web Worker path.
	7.	The rendering loop stays responsive during model work.
	8.	The prompt contains a bounded amount of relevant memory rather than the NPC’s full history.
	9.	The NPC has a recognizable personality.
	10.	The NPC can remember a meaningful player-provided fact across time.
	11.	The NPC can distinguish at least some beliefs/rumors from authoritative world facts.
	12.	The memory system can reject invalid or redundant memory candidates.
	13.	Restarting the application retains the save state.
	14.	The developer can inspect the NPC’s retrieved memories and exact structured context.
	15.	Tests cover the critical deterministic systems.
	16.	The project has a clean, coherent Git history.
The key qualitative test is:
> Meet NPC → talk → leave → advance several in-game days → return → NPC behaves as though the prior relationship exists.
If this does not feel convincing, do not expand the map. Improve memory, context selection, personality conditioning, and relationship state first.
￼
37. What Not to Build Yet
Do not let the project drift into infrastructure work before the core loop works.
Avoid adding:
	●	microservices,
	●	cloud functions,
	●	message queues,
	●	Redis,
	●	PostgreSQL,
	●	vector databases,
	●	Kubernetes,
	●	multiplayer netcode,
	●	procedural megacities,
	●	dozens of external APIs,
	●	speech synthesis,
	●	voice recognition,
	●	sophisticated agent frameworks,
	●	autonomous LLM-driven NPC planning.
The prototype should prove one thing extremely well:
A small world with persistent people can feel alive because memory and personality persist independently of the shared language model.
￼
38. Research Basis and Current Technical Notes
This plan is based on the current state of the relevant web tooling as checked on 2026-09-27.
Three.js
Three.js documents WebGPURenderer as the modern renderer and states that it targets WebGPU when available and can fall back to a WebGL2 backend. The manual also recommends importing the WebGPU build when using this renderer.
	●	https://threejs.org/docs/pages/WebGPURenderer.html
	●	https://threejs.org/manual/en/webgpu/
Transformers.js
Hugging Face documents Transformers.js as a browser ML runtime using ONNX Runtime. It supports text generation and other model tasks in-browser, and provides WebGPU execution through the device: "webgpu" option.
	●	https://huggingface.co/docs/transformers.js/
	●	https://huggingface.co/docs/transformers.js/guides/webgpu
	●	https://huggingface.co/docs/transformers.js/pipelines
The current v4 release uses a rewritten C++ WebGPU runtime and supports the same Transformers.js code across browsers and several server/desktop JS environments.
	●	https://huggingface.co/blog/transformersjs-v4
Hugging Face recommends Web Worker offloading for model work so model execution does not block the main UI thread.
	●	https://huggingface.co/docs/transformers.js/en/tutorials/react
	●	https://huggingface.co/docs/transformers.js/en/integrations/vercel-ai-sdk
WebGPU
WebGPU is a secure-context web API. Worker-side WebGPU is available through WorkerNavigator.gpu in browsers that support it, but browser availability is not universal.
	●	https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
	●	https://developer.mozilla.org/en-US/docs/Web/API/WorkerNavigator/gpu
Hugging Face’s current WebGPU guide reports roughly 85% global support as of March 2026 and notes browser-specific limitations, reinforcing the need for capability detection and graceful fallback/error states.
	●	https://huggingface.co/docs/transformers.js/guides/webgpu
Qwen3-0.6B
The Qwen3-0.6B model is a 0.6B-parameter model. The official model documentation describes both thinking and non-thinking modes; non-thinking mode is specifically positioned for efficiency. The current ONNX Community WebGPU-ready repository provides a Transformers.js example using WebGPU and q4f16.
	●	https://huggingface.co/Qwen/Qwen3-0.6B
	●	https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX
Current ONNX artifacts should be re-checked at implementation time because repository contents and exact file sizes can change.
Smaller candidate
SmolLM2-360M has a current ONNX Community q4f16 artifact on the order of a few hundred MB and is a useful lower-cost comparison candidate.
	●	https://huggingface.co/onnx-community/SmolLM2-360M-ONNX
Vite
Vite remains a lightweight modern frontend build tool with a first-party TypeScript template and optimized production bundling.
	●	https://vite.dev/guide/
Testing
Vitest provides TypeScript-friendly testing integrated with the Vite ecosystem. Playwright supports TypeScript end-to-end tests.
	●	https://vitest.dev/guide/learn/writing-tests
	●	https://playwright.dev/docs/test-typescript
￼
39. Instructions to the Implementing Engineer / Codex
Treat this document as the authoritative architecture for the prototype.
Before coding:
	1.	Inspect the repository.
	2.	Validate current package/API versions against official documentation.
	3.	Confirm the current Transformers.js model/runtime APIs rather than assuming examples are unchanged.
	4.	Run a small feasibility spike for the chosen WebGPU model before deeply integrating it.
	5.	Update docs/architecture.md if implementation details differ materially from this plan.
Then implement milestone-by-milestone.
At each milestone:
	1.	Implement the coherent feature set.
	2.	Write/update tests.
	3.	Run type checking.
	4.	Run the test suite.
	5.	Run a production build.
	6.	Manually verify the browser feature when applicable.
	7.	Commit the coherent milestone.
	8.	Record important deviations or findings in documentation.
Do not rewrite the architecture merely because an alternative library is fashionable. Change a decision only when there is a concrete technical reason, then document the reason.
Do not make commits that exist only because the work happened to be edited in separate files. Commits represent logical changes.
Do not commit generated model files or caches.
Do not hard-wire the game to the chosen model.
Do not allow the LLM to become the source of truth for the simulation.
Do not let context size grow without a hard budget.
Do not optimize for city size before the 10-NPC social-memory loop works.
The implementation’s north-star test is:
> The player can explore a small neighborhood, form relationships with NPCs, leave, return later, and experience genuine continuity because each NPC carries a compact persistent memory while sharing the same underlying language model.
￼
40. Definition of Done
The prototype is done when the repository can be cloned, installed, built, and run locally by another developer, and the core persistent-NPC experience can be demonstrated without manually editing data files.
A developer should be able to:
npm install
npm run dev
and then:
	●	enter the neighborhood,
	●	talk to NPCs,
	●	observe schedules,
	●	see memory persistence,
	●	inspect the AI context,
	●	reset the simulation,
	●	and measure local inference.
The repository should contain a coherent Git history showing the project evolved as a sequence of understandable engineering milestones.