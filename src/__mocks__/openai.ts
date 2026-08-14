/**
 * The OpenAI mocks — two boundaries, one file.
 *
 *   1. `embeddings.create`, injected into `src/lib/usageTracker.ts`. Vectors are
 *      a hash of the input, so similarity is reproducible: a retrieval test that
 *      passes is passing because the code found the right point, not because two
 *      random vectors happened to land near each other.
 *
 *   2. The structured drafter, injected through
 *      `src/lib/ai/structured.ts` → `__testing.setObjectRunner`. Responses are
 *      keyed by a fingerprint of (model, system, prompt). Two consequences, both
 *      deliberate: the same input always produces the same draft, and *changing a
 *      prompt changes the mock's answer* — so prompt coupling surfaces as a
 *      failing assertion instead of hiding behind a stub that returns a constant.
 *
 * Note what is NOT mocked here: `generateStructured` itself runs for real, so zod
 * validation, the corrective retry, the numeric guard and the cost log all
 * execute against whatever this returns.
 */

// ADR-6 bans importing the OpenAI client so that every model call goes through
// `generateStructured`. This is a TYPE-ONLY import in a test-support module, and
// it is the mechanism the ADR's own fidelity rule depends on: the mock's
// `embeddings.create` signature is taken from the real SDK, so a drift between
// the two is a compile error. No client is constructed and no call is made here.
// eslint-disable-next-line no-restricted-imports
import type OpenAI from 'openai';
import type { z } from 'zod';
import type { ObjectRunner } from '@/lib/ai/structured';
import { deterministicVector, fingerprint, seededRandom } from './deterministic';
import type { OpenAiRecord, Recorder } from './recorder';

type Embeddings = OpenAI['embeddings'];
type Completions = OpenAI['chat']['completions'];
type ChatCreateParams = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
type EmbeddingCreateParams = Parameters<Embeddings['create']>[0];
type EmbeddingRequestOptions = Parameters<Embeddings['create']>[1];
type EmbeddingResult = ReturnType<Embeddings['create']>;

/** Default dimension. Overridden from `config.openai.embedding.size` at install. */
export const DEFAULT_EMBEDDING_SIZE = 3072;

function normalizeInput(input: EmbeddingCreateParams['input']): string[] {
    if (typeof input === 'string') return [input];
    if (Array.isArray(input)) return input.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)));
    return [String(input)];
}

/** Cheap, stable token estimate. Never a random number — cost assertions depend on it. */
function estimateTokens(texts: string[]): number {
    return texts.reduce((total, text) => total + Math.max(1, Math.ceil(text.length / 4)), 0);
}

// ───────────────────────────────────────────────────────── chat completions

/**
 * `chat.completions.create`, for the legacy resume pipeline.
 *
 * Everything written since the AI rules landed goes through
 * `generateStructured`, which this file doubles at the object-runner seam. The
 * original resume pipeline predates that and still calls
 * `trackedChatCompletion` → `openai.chat.completions.create` directly, which
 * is why J6 could not exist until this was here.
 *
 * The response is deterministic and content-addressed, like everything else in
 * the layer, and it deliberately contains NO numbers unless a test scripts
 * them. That default is the useful one: it means the no-fabrication assertion
 * in J6 fails loudly the day the pipeline starts inventing figures, rather
 * than passing because the mock happened to echo the source back.
 */
export class MockOpenAIChatCompletions {
    private script: Array<{ match: RegExp; content: string }> = [];

    constructor(private readonly recorder: Recorder) {}

    /** Script a reply for prompts matching `match`. First registered wins. */
    onChat(match: RegExp, content: string): void {
        this.script.push({ match, content });
    }

    resetScript(): void {
        this.script = [];
    }

    async create(params: ChatCreateParams): Promise<unknown> {
        const prompt = params.messages
            .map((message) => (typeof message.content === 'string' ? message.content : ''))
            .join('\n');
        const model = String(params.model);

        this.recorder.openai.push({
            kind: 'object',
            model,
            system: '',
            prompt,
            temperature: params.temperature ?? null,
            fingerprint: fingerprint(model, prompt),
        });

        const scripted = this.script.find((entry) => entry.match.test(prompt));
        const wantsJson =
            scripted === undefined &&
            (params.response_format as { type?: string } | undefined)?.type === 'json_object';

        const content = scripted?.content ?? (wantsJson ? '{}' : 'Backend engineer.');
        const promptTokens = estimateTokens([prompt]);
        const completionTokens = estimateTokens([content]);

        return {
            id: `chatcmpl_${fingerprint(model, prompt)}`,
            object: 'chat.completion',
            created: 0,
            model,
            choices: [
                { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
            ],
            usage: {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: promptTokens + completionTokens,
            },
        };
    }
}

// ───────────────────────────────────────────────────────────── embeddings

export class MockOpenAIEmbeddings implements Pick<Embeddings, 'create'> {
    constructor(
        private readonly recorder: Recorder,
        private size: number,
    ) {}

    setSize(size: number): void {
        this.size = size;
    }

    create(body: EmbeddingCreateParams, options?: EmbeddingRequestOptions): EmbeddingResult {
        void options;
        const inputs = normalizeInput(body.input);
        const model = String(body.model);
        const dimensions = Number(body.dimensions ?? this.size);

        this.recorder.openai.push({
            kind: 'embedding',
            model,
            input: inputs,
            fingerprint: fingerprint(model, ...inputs),
        });

        const promptTokens = estimateTokens(inputs);
        const response = {
            object: 'list' as const,
            model,
            data: inputs.map((text, index) => ({
                object: 'embedding' as const,
                index,
                embedding: deterministicVector(text, dimensions),
            })),
            usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
        };

        // `APIPromise` is a `Promise` subclass whose extra methods the app never
        // touches; awaiting is the only thing `trackedEmbeddingCreate` does.
        return Promise.resolve(response) as unknown as EmbeddingResult;
    }
}

// ─────────────────────────────────────────── deterministic object synthesis

type JsonSchema = Record<string, unknown>;

const WORDS = [
    'shipped',
    'pricing',
    'latency',
    'pipeline',
    'migration',
    'onboarding',
    'reliability',
    'checkout',
    'schema',
    'ingest',
    'rollout',
    'dashboard',
    'retention',
    'indexing',
    'throughput',
    'observability',
];

/**
 * Synthesize a value that satisfies `schema`, deterministically from `seed`.
 *
 * Generated strings are deliberately digit-free: the numeric guard in
 * `src/lib/ai/guard.ts` strips fabricated quantities, and a mock that sprinkled
 * numbers into prose would make every guarded generation report `degraded` for
 * reasons that have nothing to do with the code under test.
 */
function synthesize(schema: JsonSchema, seed: string, root: JsonSchema, depth = 0): unknown {
    if (depth > 12) return null;
    const next = seededRandom(seed);

    if (typeof schema.$ref === 'string') {
        const pointer = schema.$ref.replace(/^#\//, '').split('/');
        let target: unknown = root;
        for (const segment of pointer) {
            target = (target as Record<string, unknown>)?.[segment];
        }
        return target ? synthesize(target as JsonSchema, `${seed}:ref`, root, depth + 1) : null;
    }

    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        return schema.enum[Math.floor(next() * schema.enum.length) % schema.enum.length];
    }
    if ('const' in schema) return schema.const;

    const branches = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined;
    if (Array.isArray(branches) && branches.length > 0) {
        // Prefer a non-null branch: `T | null` should produce a T, because a
        // mock that always answers null tests nothing downstream.
        const concrete = branches.filter((branch) => branch.type !== 'null');
        const pool = concrete.length > 0 ? concrete : branches;
        return synthesize(pool[Math.floor(next() * pool.length) % pool.length], `${seed}:any`, root, depth + 1);
    }

    if (Array.isArray(schema.allOf)) {
        const merged: Record<string, unknown> = {};
        (schema.allOf as JsonSchema[]).forEach((branch, index) => {
            const value = synthesize(branch, `${seed}:all${index}`, root, depth + 1);
            if (value && typeof value === 'object') Object.assign(merged, value);
        });
        return merged;
    }

    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

    switch (type) {
        case 'object': {
            const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
            const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
            const out: Record<string, unknown> = {};
            for (const [key, property] of Object.entries(properties)) {
                // Optional fields are filled too: a mock that omits them would
                // never exercise the branches that read them.
                out[key] = synthesize(property, `${seed}.${key}`, root, depth + 1);
                void required;
            }
            return out;
        }
        case 'array': {
            const items = (schema.items ?? { type: 'string' }) as JsonSchema;
            const min = Number(schema.minItems ?? 1);
            const max = Number(schema.maxItems ?? Math.max(min, 2));
            const length = Math.max(0, Math.min(max, Math.max(min, min === 0 ? 1 : min)));
            return Array.from({ length }, (_unused, index) =>
                synthesize(items, `${seed}[${index}]`, root, depth + 1),
            );
        }
        case 'integer':
        case 'number': {
            const rawMin = Number(schema.minimum ?? schema.exclusiveMinimum ?? 0);
            const rawMax = Number(schema.maximum ?? schema.exclusiveMaximum ?? rawMin + 100);
            const min = Number.isFinite(rawMin) ? rawMin : 0;
            const max = Number.isFinite(rawMax) && rawMax > min ? Math.min(rawMax, min + 1000) : min + 100;
            const value = min + next() * (max - min);
            return type === 'integer' ? Math.floor(value) : Math.round(value * 100) / 100;
        }
        case 'boolean':
            return next() > 0.5;
        case 'null':
            return null;
        case 'string': {
            if (schema.format === 'date-time') {
                // Fixed epoch, not the wall clock — a mock must not drift.
                return new Date(Date.UTC(2026, 0, 1)).toISOString();
            }
            const min = Number(schema.minLength ?? 0);
            const max = Number(schema.maxLength ?? Math.max(min + 24, 48));
            const parts: string[] = [];
            let text = '';
            while (text.length < Math.max(min, 12)) {
                parts.push(WORDS[Math.floor(next() * WORDS.length) % WORDS.length]);
                text = parts.join(' ');
            }
            if (text.length > max) text = text.slice(0, max).trim();
            while (text.length < min) text = `${text}x`;
            return text;
        }
        default:
            return null;
    }
}

/** What a scripted handler may return in place of the synthesized default. */
export type ScriptedObject = {
    object: unknown;
    inputTokens?: number;
    outputTokens?: number;
};

export type ObjectHandler = (args: {
    model: string;
    system: string;
    prompt: string;
    schema: z.ZodType;
    fingerprint: string;
}) => ScriptedObject | unknown;

type ScriptEntry = {
    matches: (args: { model: string; system: string; prompt: string }) => boolean;
    handler: ObjectHandler;
};

// ────────────────────────────────────────────────────────── the client mock

export class MockOpenAI {
    readonly embeddings: MockOpenAIEmbeddings;
    /** Shaped like the SDK: `openai.chat.completions.create`. */
    readonly chat: { completions: MockOpenAIChatCompletions };

    private readonly script: ScriptEntry[] = [];
    private failNext: Error | null = null;

    constructor(
        private readonly recorder: Recorder,
        size: number = DEFAULT_EMBEDDING_SIZE,
    ) {
        this.embeddings = new MockOpenAIEmbeddings(recorder, size);
        this.chat = { completions: new MockOpenAIChatCompletions(recorder) };
    }

    /** Script a `chat.completions` reply. See MockOpenAIChatCompletions. */
    onChat(match: RegExp, content: string): void {
        this.chat.completions.onChat(match, content);
    }

    /** Every model call this run — embeddings and structured drafts alike. */
    get calls(): OpenAiRecord[] {
        return this.recorder.openai;
    }

    get embeddingCalls(): Extract<OpenAiRecord, { kind: 'embedding' }>[] {
        return this.recorder.openai.filter(
            (call): call is Extract<OpenAiRecord, { kind: 'embedding' }> => call.kind === 'embedding',
        );
    }

    get objectCalls(): Extract<OpenAiRecord, { kind: 'object' }>[] {
        return this.recorder.openai.filter(
            (call): call is Extract<OpenAiRecord, { kind: 'object' }> => call.kind === 'object',
        );
    }

    setEmbeddingSize(size: number): void {
        this.embeddings.setSize(size);
    }

    /**
     * Script a structured response. `match` is tested against the system prompt
     * and the user prompt; the first registered entry that matches wins, so
     * later registrations are fallbacks rather than overrides.
     */
    onObject(
        match: string | RegExp | ((prompt: string) => boolean),
        /** A handler, or the response itself when it does not depend on the prompt. */
        response: ObjectHandler | ScriptedObject,
    ): this {
        const matches = (args: { model: string; system: string; prompt: string }): boolean => {
            const haystack = `${args.system}\n${args.prompt}`;
            if (typeof match === 'string') return haystack.includes(match);
            if (match instanceof RegExp) return match.test(haystack);
            return match(haystack);
        };
        const handler: ObjectHandler =
            typeof response === 'function' ? response : () => response;
        this.script.push({ matches, handler });
        return this;
    }

    /** The next structured call throws. Exercises the "model is down" path. */
    failNextObject(message = 'mock openai failure'): this {
        this.failNext = new Error(message);
        return this;
    }

    /** Hand this to `structured.__testing.setObjectRunner`. */
    get objectRunner(): ObjectRunner {
        return async ({ model, schema, system, prompt, temperature }) => {
            const print = fingerprint(model, system, prompt);

            this.recorder.openai.push({
                kind: 'object',
                model,
                system,
                prompt,
                temperature: temperature ?? null,
                fingerprint: print,
            });

            if (this.failNext) {
                const error = this.failNext;
                this.failNext = null;
                throw error;
            }

            const entry = this.script.find((candidate) => candidate.matches({ model, system, prompt }));
            if (entry) {
                const produced = entry.handler({ model, system, prompt, schema, fingerprint: print });
                const scripted = (
                    produced && typeof produced === 'object' && 'object' in produced
                        ? produced
                        : { object: produced }
                ) as ScriptedObject;
                return {
                    object: scripted.object,
                    inputTokens: scripted.inputTokens ?? 120,
                    outputTokens: scripted.outputTokens ?? 60,
                };
            }

            return {
                object: this.draft(schema, print),
                inputTokens: 120,
                outputTokens: 60,
            };
        };
    }

    /**
     * The default drafter: a schema-valid object derived from the prompt
     * fingerprint. Exposed so a test can compute the expected value itself.
     */
    draft(schema: z.ZodType, seed: string): unknown {
        const jsonSchema = toJsonSchema(schema);
        return synthesize(jsonSchema, seed, jsonSchema);
    }

    reset(): void {
        this.script.length = 0;
        this.failNext = null;
        this.chat.completions.resetScript();
        this.recorder.openai.length = 0;
    }

    /** The single cast. Both sub-resources above are structurally correct. */
    asOpenAI(): OpenAI {
        return this as unknown as OpenAI;
    }
}

/**
 * Zod → JSON Schema, which is what the synthesizer walks. Using zod's own
 * converter rather than its internals means a zod upgrade cannot quietly change
 * what the mock produces without the conversion itself changing.
 */
function toJsonSchema(schema: z.ZodType): JsonSchema {
    const converter = (schema as unknown as { toJSONSchema?: () => JsonSchema }).toJSONSchema;
    if (typeof converter === 'function') {
        return converter.call(schema);
    }
    throw new Error('mock openai: schema does not support JSON Schema conversion; script it with onObject()');
}
