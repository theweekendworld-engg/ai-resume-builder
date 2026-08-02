/**
 * One place to install every external boundary, and one place to reset them.
 *
 * The contract this directory exists to keep: **mock at the provider, never at
 * the module under test.** Everything the app owns — `sendEmail`'s preference
 * and suppression rules, `generateStructured`'s validation, retry and numeric
 * guard, `trackedEmbeddingCreate`'s usage accounting, `sendTelegramMessage`'s
 * body construction — runs for real, with a mock underneath it. If the module
 * being replaced is the module being tested, the test measures nothing.
 *
 * Usage:
 *
 *   // module scope — Clerk must register before the module under test imports it
 *   import { installClerkMock } from '@/__mocks__/clerk';
 *   const clerk = installClerkMock();
 *   const wins = await import('@/actions/wins');
 *
 *   // inside the suite
 *   import { installMocks, resetMocks } from '@/__mocks__';
 *   const mocks = installMocks();
 *   afterEach(() => resetMocks());
 *
 * Determinism: no mock reads `Math.random` or the wall clock. Two runs of the
 * same test produce the same ids, the same vectors and the same drafts.
 */

import { config } from '@/lib/config';
import { __testing as structuredTesting } from '@/lib/ai/structured';
import { __testing as emailTesting } from '@/lib/email/send';
import { __testing as telegramTesting } from '@/lib/telegram';
import { __testing as usageTesting } from '@/lib/usageTracker';
import { __setStripeClientForTests } from '@/lib/stripe';
import { invalidateCollectionEnsured, resetQdrantClient, setQdrantClient } from '@/lib/qdrantClient';

import { MockClerk, mockClerk } from './clerk';
import { MockGithubApi } from './github';
import { MockOpenAI } from './openai';
import { MockQdrantClient } from './qdrant';
import { MockResend } from './resend';
import { MockStripe } from './stripe';
import { MockTelegram } from './telegram';
import { Recorder } from './recorder';

export type Mocks = {
    /** The shared ledger. `mocks.email.sent` and friends are views onto it. */
    recorder: Recorder;
    /** Resend, under the real `sendEmail`. `mocks.email.sent` is the outbox. */
    email: MockResend;
    /** In-memory Qdrant with real filter semantics. */
    qdrant: MockQdrantClient;
    /** Embeddings + the structured drafter. `mocks.openai.calls` is every model call. */
    openai: MockOpenAI;
    stripe: MockStripe;
    /** `mocks.telegram.messages` is every Bot API call. */
    telegram: MockTelegram;
    /** Not auto-installed — hand it to whatever takes a `GithubApi`. */
    github: MockGithubApi;
    /** Registered separately, at module scope. See {@link installClerkMock}. */
    clerk: MockClerk;
};

export type Boundary = 'email' | 'qdrant' | 'openai' | 'stripe' | 'telegram';

export type InstallOptions = {
    /**
     * Wire ONLY these boundaries. Prefer this over `skip`.
     *
     * Bun runs every test file in one process, and these seams are module-level
     * bindings — so a suite that installs the Qdrant mock it does not need has
     * pointed a *different* suite's real Qdrant at an in-memory store. Naming
     * what you need keeps the blast radius to your own file.
     */
    only?: Boundary[];
    /** Boundaries to leave alone. Ignored when `only` is given. */
    skip?: Boundary[];
    /** Defaults to `config.openai.embedding.size`, so vectors match the collection. */
    embeddingSize?: number;
    /** Set when a suite exercises the Stripe webhook route. */
    stripeWebhookSecret?: string;
};

let current: Mocks | null = null;
let installedFor: InstallOptions = {};

function build(options: InstallOptions): Mocks {
    const recorder = new Recorder();
    return {
        recorder,
        email: new MockResend(recorder),
        qdrant: new MockQdrantClient(recorder),
        openai: new MockOpenAI(recorder, options.embeddingSize ?? config.openai.embedding.size),
        stripe: new MockStripe(recorder),
        telegram: new MockTelegram(recorder),
        github: new MockGithubApi(recorder),
        clerk: mockClerk,
    };
}

const ALL_BOUNDARIES: Boundary[] = ['email', 'qdrant', 'openai', 'stripe', 'telegram'];

function resolveBoundaries(options: InstallOptions): Set<Boundary> {
    if (options.only) return new Set(options.only);
    const skipped = new Set(options.skip ?? []);
    return new Set(ALL_BOUNDARIES.filter((name) => !skipped.has(name)));
}

function wire(mocks: Mocks, options: InstallOptions): void {
    const wanted = resolveBoundaries(options);

    if (wanted.has('email')) {
        emailTesting.setResendClient(mocks.email.asResend());
    }
    if (wanted.has('qdrant')) {
        setQdrantClient(mocks.qdrant.asQdrantClient());
    }
    if (wanted.has('openai')) {
        usageTesting.setOpenAIClient(mocks.openai.asOpenAI());
        structuredTesting.setObjectRunner(mocks.openai.objectRunner);
    }
    if (wanted.has('stripe')) {
        if (options.stripeWebhookSecret) mocks.stripe.webhookSecret = options.stripeWebhookSecret;
        __setStripeClientForTests(mocks.stripe.asStripe());
    }
    if (wanted.has('telegram')) {
        telegramTesting.setFetch(mocks.telegram.fetch);
    }
}

/**
 * Install every provider mock and return the handles.
 *
 * Calling twice returns the same instance and re-wires it, so a `beforeEach`
 * that calls `installMocks()` does not silently orphan the handles a suite
 * captured at module scope.
 *
 * ── Why installing clears the recorder ──────────────────────────────────────
 *
 * `current` is module state, and Bun shares module bindings across the whole
 * process, so every test FILE in a run gets the same instance. Reusing the
 * instance is correct. Inheriting its recorded history is not, and it made J1
 * fail roughly one run in four:
 *
 *   J1 asserts that the numeric guard fired on one Win — "two model round
 *   trips, not one" — by counting `objectCalls` whose prompt contains that
 *   PR's title. The capture and backfill eval suites read the SAME GitHub
 *   fixture corpus, so their prompts contain that title too. Whenever Bun
 *   scheduled one of those files first, their calls were still in the recorder
 *   when J1's `beforeAll` ran, and the count came out 4 instead of 2.
 *
 * The old code only reset in the journey harness's `afterEach`, which a file
 * that never uses the harness never runs. Clearing on install makes the
 * guarantee belong to the boundary that can actually make it. Leftover
 * SCRIPTED responses are the same hazard in a quieter form — a script
 * registered by a previous file silently satisfying a later test's call is a
 * green test that proves nothing — and this clears those too.
 */
export function installMocks(options: InstallOptions = {}): Mocks {
    installedFor = options;
    if (current) {
        // Rewires as a side effect, hence the wire() below being unconditional
        // rather than in an else.
        resetMocks();
    } else {
        current = build(options);
    }
    // After the reset: `openai.reset()` restores the default embedding size.
    if (options.embeddingSize) current.openai.setEmbeddingSize(options.embeddingSize);
    wire(current, options);
    return current;
}

/** The installed mocks. Throws rather than silently installing — an un-installed
 *  boundary is a real network call waiting to happen. */
export function mocks(): Mocks {
    if (!current) throw new Error('installMocks() has not been called');
    return current;
}

/**
 * Clear all recorded calls and scripted behaviour, keeping the wiring in place.
 * This is the `afterEach` — it must not un-wire, or the next test in the file
 * would reach the network.
 */
export function resetMocks(): void {
    if (!current) return;
    current.email.reset();
    current.qdrant.reset();
    // The store just lost its collections, so the module-level "already
    // ensured" cache in the client is now a lie. Leaving it set makes
    // `ensureKnowledgeBaseCollection()` short-circuit against a collection that
    // no longer exists, and the next read fails with "Collection doesn't exist".
    invalidateCollectionEnsured();
    current.openai.reset();
    current.stripe.reset();
    current.telegram.reset();
    current.github.reset();
    current.recorder.reset();
    // Clerk is intentionally NOT reset here: a suite that signs in at
    // `beforeAll` would be signed out by the first `afterEach`. Call
    // `mocks.clerk.signOut()` explicitly.
    wire(current, installedFor);
}

/**
 * Restore every real client. For an `afterAll` in a suite that shares the
 * process with tests which must NOT see the mocks.
 */
export function uninstallMocks(): void {
    emailTesting.reset();
    structuredTesting.reset();
    usageTesting.reset();
    telegramTesting.reset();
    __setStripeClientForTests(null);
    resetQdrantClient();
    current = null;
    installedFor = {};
}

export { installClerkMock, mockClerk, MockClerk } from './clerk';
export { MockGithubApi } from './github';
export type { GithubCorpus, GithubMockOptions } from './github';
export { MockOpenAI, MockOpenAIEmbeddings } from './openai';
export { MockQdrantClient, matchesFilter } from './qdrant';
export { MockResend, MockResendEmails } from './resend';
export type { ResendOutcome } from './resend';
export { MockStripe, MOCK_STRIPE_NOW_SECONDS } from './stripe';
export { MockTelegram } from './telegram';
export type { TelegramOutcome } from './telegram';
export { Recorder } from './recorder';
export type {
    EmailRecord,
    GithubRecord,
    OpenAiRecord,
    QdrantRecord,
    StripeRecord,
    TelegramRecord,
} from './recorder';
export {
    cosineSimilarity,
    deterministicVector,
    fingerprint,
    seededRandom,
    shortId,
} from './deterministic';
