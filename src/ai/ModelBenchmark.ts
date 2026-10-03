// ─── Model Benchmark Harness ───
// Developer tool for measuring model performance.
// Not a gameplay feature — used to compare candidate models.
//
// The plan (§3.6, §32) requires a benchmark to decide the default model, and the
// quality test set in §33 to judge responses. Both live here. Quality flags exist
// because reading truncated responses is not a measurement: the failure modes we
// actually care about (assistant register, echoing the player, re-introducing
// itself mid-conversation) are all mechanically detectable.

import { LanguageModel, ChatMessage, GenerationConfig, GenerationUsage } from './LanguageModel';

export interface BenchmarkFixture {
  name: string;
  /** What a good answer looks like, for the developer's judgement. */
  expectation: string;
  messages: ChatMessage[];
  generationConfig: GenerationConfig;
}

export interface QualityFlags {
  /** Assistant/service-desk register instead of a neighbour's voice. */
  assistantRegister: boolean;
  /** The player's question reproduced verbatim in the reply. */
  echoesPlayer: boolean;
  /** Reintroduced itself when the conversation was already underway. */
  reintroduced: boolean;
  /** Answered with something mechanically checkable (identity, hours). */
  tooLong: boolean;
}

export interface BenchmarkResult {
  fixture: string;
  modelId: string;
  dtype: string;
  device: string;
  loadMs: number;
  firstTokenMs: number;
  generationMs: number;
  outputTokens: number;
  tokensPerSecond: number;
  promptTokens: number;
  response: string;
  flags: QualityFlags;
}

const CONCISE: GenerationConfig = {
  maxNewTokens: 96,
  temperature: 0.7,
  topP: 0.8,
  topK: 20,
  doSample: true,
};

const NPC_SYSTEM = (name: string, role: string, voice: string[]): ChatMessage => ({
  role: 'system',
  content: [
    `You are ${name}, ${role}, standing in a small neighbourhood and talking to someone face to face. You are not an assistant.`,
    'Answer in your own voice, one to three short sentences, like a neighbour having a moment.',
    'Greet and introduce yourself once, at the start. Afterwards, continue the conversation instead of starting over.',
    'Do not echo their words back at them.',
    'Sound like a neighbour, never like a service desk.',
    '',
    'Things you say, in your own voice:',
    ...voice.map((line) => `- "${line}"`),
  ].join('\n'),
});

/** Fixtures mirroring the quality test set in the plan (§33) plus observed failures. */
export const DEFAULT_FIXTURES: BenchmarkFixture[] = [
  {
    name: 'identity_consistency',
    expectation: 'Answers according to occupation without prompting for it.',
    messages: [
      NPC_SYSTEM('Maria', 'a barista at the West Coffee Shop', [
        'Morning! The usual? You look like a long one.',
      ]),
      { role: 'user', content: 'What do you do around here?' },
    ],
    generationConfig: CONCISE,
  },
  {
    name: 'greeting_register',
    expectation: 'Greets like a person, not "How can I help you?".',
    messages: [
      NPC_SYSTEM('Maria', 'a barista at the West Coffee Shop', [
        'Morning! The usual?',
      ]),
      { role: 'user', content: 'Hello Maria' },
    ],
    generationConfig: CONCISE,
  },
  {
    name: 'no_reintroduction',
    expectation: 'Continues the conversation; does NOT greet or introduce again.',
    messages: [
      NPC_SYSTEM('Maria', 'a barista at the West Coffee Shop', ['Morning! The usual?']),
      { role: 'user', content: 'Hello Maria' },
      { role: 'assistant', content: "Morning! I'm Maria, I run the coffee place on the corner." },
      { role: 'user', content: 'Have we met before?' },
    ],
    generationConfig: CONCISE,
  },
  {
    name: 'question_not_echoed',
    expectation: 'Answers the question instead of repeating it back.',
    messages: [
      NPC_SYSTEM('David', 'the owner of the East Shop', ["What do you need?"]),
      { role: 'user', content: 'Have we met before?' },
    ],
    generationConfig: CONCISE,
  },
  {
    name: 'memory_recall',
    expectation: 'Recalls the remembered fact without restating the whole prompt.',
    messages: [
      NPC_SYSTEM('David', 'the owner of the East Shop', [
        'You helped me carry the sign in, once.',
      ]),
      {
        role: 'system',
        content:
          '=== RETRIEVED MEMORIES ===\n- [episodic/player, conf 0.9] The player helped carry the shop sign last week.',
      },
      { role: 'user', content: 'Hey David, remember me?' },
    ],
    generationConfig: CONCISE,
  },
  {
    name: 'world_truth_grounding',
    expectation: 'States the authoritative fact, or admits uncertainty. No invention.',
    messages: [
      NPC_SYSTEM('David', 'the owner of the East Shop', ['Paint, mostly.']),
      {
        role: 'system',
        content:
          '=== WORLD TRUTH ===\n- The coffee shop on the west side opens at 07:00 and closes at 18:00.\n=== RETRIEVED MEMORIES ===\n- [belief/inference, conf 0.5] The coffee shop keeps better hours than the sign advertises.',
      },
      { role: 'user', content: "When does the coffee shop close?" },
    ],
    generationConfig: CONCISE,
  },
];

const ASSISTANT_PHRASES = [
  'how can i help',
  'how may i assist',
  'is there anything else',
  'let me know if',
  'i hope this helps',
  'feel free to ask',
];

const INTRO_PHRASES = [
  "i'm ",
  'my name is',
  'i am a',
  'i work as',
];

/**
 * Mechanically detectable quality problems.
 *
 * `tooLong` is a proxy for rambling rather than a real length check: four or more
 * sentences is well past the one-to-three the design calls for.
 */
export function scoreResponse(fixture: BenchmarkFixture, response: string): QualityFlags {
  const lower = response.toLowerCase();
  const lastUser = [...fixture.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const question = lastUser.replace(/[?!.]+$/, '').trim().toLowerCase();

  const midConversation = fixture.messages.some((m) => m.role === 'assistant');
  const sentenceCount = response.split(/[.!?]+\s/).filter((s) => s.trim().length > 0).length;

  return {
    assistantRegister: ASSISTANT_PHRASES.some((p) => lower.includes(p)),
    echoesPlayer: question.length > 8 && lower.includes(question),
    reintroduced: midConversation && INTRO_PHRASES.some((p) => lower.includes(p)),
    tooLong: sentenceCount > 4,
  };
}

export function countFlags(flags: QualityFlags): number {
  return Object.values(flags).filter(Boolean).length;
}

export class ModelBenchmark {
  async run(
    model: LanguageModel,
    modelId: string,
    device: string,
    dtype: string,
    loadMs: number,
    fixtures: BenchmarkFixture[] = DEFAULT_FIXTURES,
  ): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];

    for (const fixture of fixtures) {
      let usage: GenerationUsage | undefined;
      let response = '';

      await model.generate(
        `bench_${fixture.name}_${Date.now()}`,
        fixture.messages,
        fixture.generationConfig,
        (event) => {
          if (event.type === 'completed') {
            response = event.fullText;
            usage = event.usage;
          }
        },
      );

      results.push({
        fixture: fixture.name,
        modelId,
        dtype,
        device,
        loadMs,
        firstTokenMs: usage?.firstTokenMs ?? 0,
        generationMs: usage?.totalMs ?? 0,
        outputTokens: usage?.completionTokens ?? 0,
        tokensPerSecond: usage?.tokensPerSecond ?? 0,
        promptTokens: usage?.promptTokens ?? 0,
        response,
        flags: scoreResponse(fixture, response),
      });
    }

    return results;
  }

  formatResults(results: BenchmarkResult[]): string {
    const lines: string[] = [
      `\n═══ Model Benchmark Results ═══`,
      `Model: ${results[0]?.modelId ?? 'unknown'}`,
      `Device: ${results[0]?.device ?? 'unknown'}`,
      `Dtype: ${results[0]?.dtype ?? 'unknown'}`,
      `Load time: ${results[0]?.loadMs?.toFixed(0) ?? '?'}ms`,
      `───────────────────────────────`,
    ];

    for (const r of results) {
      const flags = Object.entries(r.flags)
        .filter(([, on]) => on)
        .map(([name]) => name);
      lines.push(`\n[${r.fixture}]`);
      lines.push(`  First token: ${r.firstTokenMs.toFixed(0)}ms`);
      lines.push(`  Total: ${r.generationMs.toFixed(0)}ms`);
      lines.push(`  Tokens: ${r.outputTokens}`);
      lines.push(`  Speed: ${r.tokensPerSecond.toFixed(1)} tok/s`);
      lines.push(`  Flags: ${flags.length === 0 ? 'none' : flags.join(', ')}`);
      lines.push(`  Response: "${r.response.slice(0, 160)}${r.response.length > 160 ? '...' : ''}"`);
    }

    lines.push(`\n═══════════════════════════════\n`);
    return lines.join('\n');
  }
}