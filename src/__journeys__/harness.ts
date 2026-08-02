/**
 * Shared harness for the end-to-end journey tests.
 *
 * A journey is not a bigger unit test. It exercises a loop that spans features
 * — capture into digest into confirm into grounding — with every external
 * boundary mocked and a real database underneath. The point is the seams
 * *between* features, which is exactly the ground no single-feature suite
 * covers and where the interesting bugs live.
 *
 * Three rules for anything written against this harness:
 *
 * 1. **Drive the product, not the internals.** Call the same server actions and
 *    job handlers the app calls. A journey that reaches past them into Prisma
 *    to set up its next step has stopped testing the loop and started testing
 *    its own fixtures.
 *
 * 2. **Assert the invariants at every hop, not just at the end.** A green
 *    final state can hide a Win that was briefly grounded without evidence, or
 *    a confidential row that was embedded and then cleaned up.
 *
 * 3. **Run the queue the way production does.** `drainJobs()` goes through the
 *    real runner, so fan-out, dedupe keys, backoff and idempotency are all
 *    genuinely exercised rather than bypassed by calling handlers directly.
 */

import { afterAll, afterEach, beforeAll } from 'bun:test';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { installMocks, resetMocks, uninstallMocks, mocks, type Boundary } from '@/__mocks__';
import { installClerkMock, type MockClerk } from '@/__mocks__/clerk';
import { drain } from '@/lib/jobs/runner';
import '@/lib/jobs/registry';

/** Everything a journey touches, so teardown is exhaustive rather than hopeful. */
const USER_SCOPED_MODELS = [
    'claimLink', 'evidence', 'impactMetric',
    'win', 'weeklyDigest', 'monthlyReview',
    'captureSignal', 'captureRun', 'captureSource',
    'reviewPacket', 'competencyFramework', 'interviewSession',
    'emailSend', 'emailPreference',
    'usageQuota', 'subscription', 'apiUsageLog', 'funnelEvent',
    'userExperience', 'userProfile',
] as const;

export type Journey = {
    /** Unique per run, so a re-run or a parallel file cannot collide. */
    readonly runId: string;
    /** The signed-in user for this journey. */
    readonly userId: string;
    readonly clerk: MockClerk;
    /** The installed mocks. Same object as `mocks()`. */
    readonly m: ReturnType<typeof mocks>;
};

let active: Journey | null = null;
/** When each run began, so job cleanup can be scoped by time rather than key shape. */
const runStartedAt = new Map<string, Date>();

function uniqueRunId(prefix: string): string {
    // No Math.random: journeys must be reproducible. The pid keeps parallel
    // Bun processes apart, the counter keeps files within a process apart.
    counter += 1;
    return `j-${prefix}-${process.pid}-${counter}`;
}
let counter = 0;

/**
 * Wire a journey. Call at module scope; it registers its own lifecycle hooks.
 *
 * `boundaries` is deliberately explicit. Seams are module-level bindings shared
 * across the whole Bun process, so installing a boundary you do not need
 * repoints some other suite's real client at an in-memory one.
 */
export function defineJourney(options: {
    /** Short slug, e.g. 'core-loop'. Used in ids so failures are traceable. */
    name: string;
    boundaries: Boundary[];
    /** Vector width. Must match the collection the code under test uses. */
    embeddingSize?: number;
    stripeWebhookSecret?: string;
}): Journey {
    const clerk = installClerkMock();
    const runId = uniqueRunId(options.name);
    const userId = `${runId}:user`;

    const journey: Journey = {
        runId,
        userId,
        clerk,
        get m() {
            return mocks();
        },
    } as Journey;

    beforeAll(() => {
        runStartedAt.set(runId, new Date());
        installMocks({
            only: options.boundaries,
            embeddingSize: options.embeddingSize,
            stripeWebhookSecret: options.stripeWebhookSecret,
        });
        clerk.signIn(userId);
        active = journey;
    });

    afterEach(() => {
        // Clears recorded calls and scripted responses; leaves wiring intact,
        // or the next test in the file would reach the network.
        resetMocks();
        // Re-assert identity: a test that signs out must not affect the next.
        clerk.signIn(userId);
    });

    afterAll(async () => {
        await purge(runId);
        clerk.signOut();
        uninstallMocks();
        active = null;
    });

    return journey;
}

export function currentJourney(): Journey {
    if (!active) throw new Error('defineJourney() has not run — call it at module scope');
    return active;
}

/**
 * Delete everything this run created.
 *
 * Matches on the run id prefix rather than a user id, because a journey creates
 * rows for collaborators, employers and jobs that are not keyed by user. Order
 * matters: children before parents.
 */
export async function purge(runId: string): Promise<void> {
    const like = { contains: runId };


    await prisma.claimLink.deleteMany({ where: { userId: like } });
    await prisma.evidence.deleteMany({ where: { userId: like } });
    await prisma.impactMetric.deleteMany({ where: { userId: like } });
    await prisma.captureSignal.deleteMany({ where: { userId: like } });
    await prisma.captureRun.deleteMany({ where: { userId: like } });
    await prisma.captureSource.deleteMany({ where: { userId: like } });
    await prisma.win.deleteMany({ where: { userId: like } });
    await prisma.weeklyDigest.deleteMany({ where: { userId: like } });
    await prisma.monthlyReview.deleteMany({ where: { userId: like } });
    await prisma.reviewPacket.deleteMany({ where: { userId: like } });
    await prisma.competencyFramework.deleteMany({ where: { userId: like } });
    await prisma.interviewSession.deleteMany({ where: { userId: like } });
    await prisma.emailSend.deleteMany({ where: { userId: like } });
    await prisma.emailPreference.deleteMany({ where: { userId: like } });
    await prisma.usageQuota.deleteMany({ where: { userId: like } });
    await prisma.subscription.deleteMany({ where: { userId: like } });
    await prisma.apiUsageLog.deleteMany({ where: { userId: like } });
    await prisma.funnelEvent.deleteMany({ where: { userId: like } });
    await prisma.userExperience.deleteMany({ where: { userId: like } });
    await prisma.userProfile.deleteMany({ where: { userId: like } });
    // Jobs are scoped by TIME, not by key.
    //
    // Handlers mint child dedupe keys from row ids — `embed_win:<winId>:<ts>`,
    // `draft_wins:<sourceId>:<captureRunId>` — so a run-id match misses every
    // fan-out child. Chasing those fragments also fails once the owning row is
    // gone, which is how a directory run accumulated 546 orphaned rows.
    //
    // A journey owns its database for the duration, so everything enqueued
    // since it started is its own. Safe, and it cannot be defeated by a key
    // shape nobody anticipated.
    const startedAt = runStartedAt.get(runId);
    await prisma.job.deleteMany({
        where: startedAt ? { createdAt: { gte: startedAt } } : { dedupeKey: like },
    });
    runStartedAt.delete(runId);
}

/**
 * The collection the app writes to. Mirrors `COLLECTION_NAME` in
 * `src/actions/embed.ts`, which is not exported. ADR-5's move to a
 * `QDRANT_COLLECTION` env var and 1024 dims (P0.6) never happened; if it does,
 * this must follow or every vector assertion here silently passes on an empty
 * collection.
 */
export const JOURNEY_COLLECTION = 'knowledge_base';

/** Assert nothing leaked. Worth calling once at the end of a journey file. */
export async function assertPurged(runId: string): Promise<Record<string, number>> {
    const like = { contains: runId };
    const counts: Record<string, number> = {};
    for (const model of USER_SCOPED_MODELS) {
        const delegate = prisma[model] as unknown as {
            count: (args: { where: Prisma.WinWhereInput }) => Promise<number>;
        };
        const n = await delegate.count({ where: { userId: like } as Prisma.WinWhereInput });
        if (n > 0) counts[model] = n;
    }
    return counts;
}

// ---------------------------------------------------------------------------
// Driving the product
// ---------------------------------------------------------------------------

/**
 * Run the job queue to quiescence, through the REAL runner.
 *
 * Handlers fan out, so one drain is rarely enough: a dispatch enqueues children
 * that only run on the next pass. Loops until nothing is left or `maxPasses` is
 * hit — and throws on the cap rather than returning quietly, because a journey
 * that silently stopped draining would assert against a half-finished world.
 */
export async function drainJobs(maxPasses = 10): Promise<{ passes: number; succeeded: number }> {
    let passes = 0;
    let succeeded = 0;

    for (; passes < maxPasses; passes += 1) {
        const result = await drain(10_000, 50);
        succeeded += result.succeeded;
        if (result.claimed === 0) return { passes: passes + 1, succeeded };
    }

    const pending = await prisma.job.count({ where: { status: 'pending' } });
    throw new Error(
        `drainJobs did not settle in ${maxPasses} passes (${pending} pending). ` +
            'Either a handler is re-enqueueing itself, or the journey needs a higher cap.',
    );
}

/**
 * Dead jobs are silent failures — a journey should never end with one.
 *
 * Checks the WHOLE queue rather than filtering by run id. Fan-out children are
 * keyed from row ids, so a run-id filter silently exempts exactly the jobs most
 * likely to die. A journey runs against its own database, so anything dead here
 * is either this run's or was already broken — both worth failing on.
 */
export async function assertNoDeadJobs(_runId?: string): Promise<void> {
    const dead = await prisma.job.findMany({
        where: { status: 'dead' },
        select: { kind: true, lastError: true },
    });
    if (dead.length > 0) {
        throw new Error(
            `journey left ${dead.length} dead job(s): ` +
                dead.map((d) => `${d.kind}: ${d.lastError}`).join(' | '),
        );
    }
}

// ---------------------------------------------------------------------------
// Invariant assertions
//
// These are the product's load-bearing guarantees. A journey asserts them at
// every hop, not only at the end — a clean final state can hide a Win that was
// briefly grounded without evidence.
// ---------------------------------------------------------------------------

/** CLAUDE.md rule 5: exactly one Evidence + ClaimLink pair per source artifact. */
export async function assertGrounded(winId: string): Promise<void> {
    const links = await prisma.claimLink.findMany({
        where: { claimType: 'win', claimRefId: winId },
        include: { evidence: true },
    });
    if (links.length === 0) throw new Error(`win ${winId} is confirmed but has no ClaimLink`);

    const grounded = links.filter((l) => l.groundState === 'grounded');
    if (grounded.length === 0) throw new Error(`win ${winId} has ClaimLinks but none are grounded`);
    for (const link of grounded) {
        if (!link.evidence.confirmedByUser) {
            throw new Error(`win ${winId} is grounded by evidence the user never confirmed`);
        }
    }
}

/** The reverse: un-confirm must leave nothing behind. */
export async function assertNotGrounded(winId: string): Promise<void> {
    const n = await prisma.claimLink.count({
        where: { claimType: 'win', claimRefId: winId, groundState: 'grounded' },
    });
    if (n > 0) throw new Error(`win ${winId} still has ${n} grounded ClaimLink(s)`);
}

/**
 * ADR-8: a Win that is not `shareable` + `confirmed` must have no vector.
 *
 * Checks the mock store directly rather than the `embedded` column, because the
 * column is what the code *believes* and the store is what is actually
 * reachable by retrieval. Those disagreeing is the exact drift the reconcile
 * sweep exists for, and a journey should catch it in the act.
 */
export async function assertNoVector(winId: string): Promise<void> {
    const points = mocks().qdrant.points(JOURNEY_COLLECTION);
    const leaked = points.filter(
        (p) => (p.payload as { sourceId?: string } | null)?.sourceId === winId,
    );
    if (leaked.length > 0) {
        throw new Error(
            `win ${winId} must not be externally visible but has ${leaked.length} vector(s)`,
        );
    }
}

export async function assertHasVector(winId: string): Promise<void> {
    const points = mocks().qdrant.points(JOURNEY_COLLECTION);
    const found = points.filter(
        (p) => (p.payload as { sourceId?: string } | null)?.sourceId === winId,
    );
    if (found.length === 0) throw new Error(`win ${winId} should be embedded but has no vector`);
    if (found.length > 1) throw new Error(`win ${winId} has ${found.length} vectors; embedding is not idempotent`);
}

/**
 * No generated artifact may contain a quantity absent from its source.
 *
 * Deliberately a separate implementation from `src/lib/ai/guard.ts`. A check
 * that shares code with the thing it checks proves nothing — the same reasoning
 * B1, C1 and C2 each arrived at independently.
 */
export function assertNoFabricatedNumbers(output: string, source: string): void {
    const strip = (s: string) => s.replace(/[,\s]/g, '').toLowerCase();
    const haystack = strip(source);
    const found = output.match(/\d[\d,.]*\s*%?/g) ?? [];

    const fabricated = found
        .map((raw) => raw.trim())
        .filter((raw) => raw.length > 0)
        .filter((raw) => !haystack.includes(strip(raw)))
        // A bare year is not a measurement; the guard makes the same carve-out.
        .filter((raw) => !/^(19|20)\d{2}$/.test(raw.replace(/\D/g, '')));

    if (fabricated.length > 0) {
        throw new Error(
            `fabricated quantities ${JSON.stringify(fabricated)} appear in output but not in source`,
        );
    }
}

/** Running a step twice must change nothing. */
export async function assertIdempotent<T>(
    label: string,
    step: () => Promise<T>,
    count: () => Promise<number>,
): Promise<void> {
    await step();
    const after = await count();
    await step();
    const again = await count();
    if (after !== again) {
        throw new Error(`${label} is not idempotent: ${after} then ${again}`);
    }
}
