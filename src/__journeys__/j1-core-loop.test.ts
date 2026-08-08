/**
 * J1 — THE CORE LOOP. docs/impl/04-test-strategy.md §4.
 *
 *   connect GitHub → sync → CaptureSignals → drafted Wins → weekly digest sends
 *     → the user taps confirm in the email (magic link, no session)
 *     → Evidence + ClaimLink written → Win embedded → appears in the log
 *
 * This is the product. It spans C1's capture, D1's ritual and B1's graph, and
 * no single-feature suite crosses any one of those seams.
 *
 * Three things about how it is written, all of them load-bearing:
 *
 * 1. **It drives the product.** `connectGithub`, `saveRepoSelection`,
 *    `listWins` and `undoFromDigestLink` are the same server actions the app
 *    calls; the sync, the drafting, the digest and the embed all run as real
 *    jobs through `drainJobs()`. Prisma appears only to ASSERT outcomes and to
 *    ARRANGE the three rows with no product surface in this loop: the feature
 *    flags, the profile email `sendEmail` reads, and the digest slot.
 *
 * 2. **The invariants are asserted at every hop.** A drafted Win is checked to
 *    be ungrounded and unembedded before the confirm, not merely confirmed to
 *    be grounded after it — a green final state hides a Win that was briefly
 *    grounded without evidence.
 *
 * 3. **The queue is real.** Nothing calls a handler directly. Fan-out
 *    (capture_sync dispatch → per-source child → draft_wins; weekly_digest
 *    dispatch → per-user child), dedupe keys and idempotency are therefore
 *    genuinely exercised rather than bypassed.
 *
 * Everything below `installClerkMock()` is imported dynamically. Clerk is
 * replaced with `mock.module`, which binds at import time, so a static import
 * of anything that transitively reaches `@clerk/nextjs/server` would capture
 * the real module.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    CaptureRunStatus,
    CaptureSourceKind,
    CaptureSourceStatus,
    WinSensitivity,
    WinSource,
    WinStatus,
    type CaptureSignal,
} from '@prisma/client';
import { installClerkMock } from '@/__mocks__/clerk';
import type {
    IssueDetail,
    PullDetail,
    ReviewSummary,
    SearchIssueItem,
} from '@/lib/capture/github/client';
import type { CaptureDraft } from '@/lib/capture/drafting';
import { restoreFlags, snapshotFlags, type FlagSnapshot } from '@/lib/flags.test-utils';

/** Restored in `afterAll` — the suite shares a database with development. */
let __flagSnapshot: FlagSnapshot = [];

installClerkMock();

const {
    assertGrounded,
    assertHasVector,
    assertNoDeadJobs,
    assertNoFabricatedNumbers,
    assertNoVector,
    assertNotGrounded,
    assertPurged,
    defineJourney,
    drainJobs,
    purge,
    JOURNEY_COLLECTION,
} = await import('./harness');

const journey = defineJourney({
    name: 'core-loop',
    // Only what this loop touches. These seams are module-level bindings shared
    // across the whole Bun process; installing stripe or telegram here would
    // repoint a boundary this file never uses.
    boundaries: ['email', 'qdrant', 'openai'],
});

const { mocks } = await import('@/__mocks__');
const { prisma } = await import('@/lib/prisma');
const { config } = await import('@/lib/config');
const { connectGithub, saveRepoSelection } = await import('@/actions/capture');
const { listWins } = await import('@/actions/wins');
const { undoFromDigestLink } = await import('@/actions/digest');
const { generateEmbedding } = await import('@/actions/embed');
const { buildDedupeKey, enqueue } = await import('@/lib/jobs/runner');
const { GITHUB_CONSENT_VERSION } = await import('@/lib/capture/consent');
const { createGithubAdapter } = await import('@/lib/capture/github/adapter');
const captureRegistry = await import('@/lib/capture/registry');
const { invalidateFlagCache } = await import('@/lib/flags');
const { weekStartFor } = await import('@/lib/time');
const { qdrantExternalFilter } = await import('@/lib/graph/visibility');
const qdrantModule = await import('@/lib/qdrantClient');
const { applyDigestAction, resolveWinToken, verifyWinToken } = await import('@/lib/winTokens');
const MagicLinkPage = (await import('@/app/w/[token]/page')).default;

// ═══════════════════════════════════════════════════════════════ the corpus
//
// Wire-shaped, not signal-shaped: the fixtures below are what GitHub's own
// endpoints return, so the real adapter's queries, pagination, budget, noise
// layers, grouping and confidence formula all run for real on the way in. A
// `RawSignal` fixture would skip every one of them.

const DAY_MS = 86_400_000;
const NOW = new Date();
const REPO = 'acme/api';
const LOGIN = 'maya-dev';

function isoDaysAgo(days: number): string {
    return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

type PrSpec = {
    number: number;
    title: string;
    body: string;
    labels: string[];
    files: string[];
    /** `pull.reviewComments`; ≥3 is the §4.3 "reviewed" confidence bump. */
    reviewComments: number;
    daysAgo: number;
    authorLogin?: string;
    authorType?: 'User' | 'Bot';
};

function searchItem(spec: PrSpec): SearchIssueItem {
    return {
        nodeId: `PR_node_${spec.number}`,
        number: spec.number,
        title: spec.title,
        body: spec.body,
        htmlUrl: `https://github.com/${REPO}/pull/${spec.number}`,
        repo: REPO,
        labels: spec.labels,
        authorLogin: spec.authorLogin ?? LOGIN,
        authorType: spec.authorType ?? 'User',
        createdAt: isoDaysAgo(spec.daysAgo + 3),
        closedAt: isoDaysAgo(spec.daysAgo),
        pullRequestMergedAt: isoDaysAgo(spec.daysAgo),
        isPullRequest: true,
        commentCount: spec.reviewComments,
    };
}

function pullDetail(spec: PrSpec): PullDetail {
    return {
        nodeId: `PR_node_${spec.number}`,
        number: spec.number,
        title: spec.title,
        body: spec.body,
        htmlUrl: `https://github.com/${REPO}/pull/${spec.number}`,
        repo: REPO,
        repoPrivate: true,
        labels: spec.labels,
        authorLogin: spec.authorLogin ?? LOGIN,
        authorType: spec.authorType ?? 'User',
        branch: `feature/pr-${spec.number}`,
        createdAt: isoDaysAgo(spec.daysAgo + 3),
        mergedAt: isoDaysAgo(spec.daysAgo),
        merged: true,
        additions: 120,
        deletions: 30,
        changedFiles: spec.files.length,
        reviewComments: spec.reviewComments,
        comments: 0,
    };
}

/**
 * Seven draftable artefacts plus one bot PR.
 *
 * The confidence scores are deliberately distinct and deliberately spread
 * across the §6.5 top-five cut: 1.00 / 0.95 / 0.85 / 0.75 / 0.70 make the
 * digest, 0.60 and 0.50 land in "Needs review". Getting that boundary from the
 * real `scoreConfidence` — rather than by writing five Wins — is what makes
 * "the digest contains at most five" mean something.
 */
const W1: PrSpec = {
    // long body + linked issue + number + reviewed + meaningful label → 1.00
    number: 501,
    title: 'Cut checkout latency for repeat customers',
    body:
        'Repeat customers hit a cold cache on every visit, so the checkout summary was recomputed ' +
        'from scratch each time. This change memoises the summary per session and warms it on ' +
        'sign-in. Measured against the staging replay set, p99 dropped from 900ms to 210ms. ' +
        'Closes #77.',
    labels: ['performance'],
    files: ['src/checkout/summary.ts', 'src/checkout/cache.ts'],
    reviewComments: 4,
    daysAgo: 3,
};

const W2: PrSpec = {
    // long body + number + reviewed + meaningful label → 0.95. Drafted
    // `confidential`, so it must never reach the vector store.
    number: 502,
    title: 'Contained a leaked service credential in the gateway',
    body:
        'A service credential was committed to the gateway package and picked up by a scanner ' +
        'before anyone noticed. This change rotates the credential, revokes the old value, and ' +
        'adds a pre-receive check so the same class of mistake cannot land again. The response ' +
        'ran for 45 minutes end to end.',
    labels: ['security'],
    files: ['src/gateway/tokens.ts', 'src/gateway/hooks.ts'],
    reviewComments: 5,
    daysAgo: 5,
};

const W3: PrSpec = {
    // long body + number + meaningful label → 0.85. The adversarial draft.
    number: 503,
    title: 'Reworked the ingest retry policy',
    body:
        'Ingest workers retried a poisoned message forever, which kept a shard busy and starved ' +
        'everything queued behind it. Retries now cap at 5 attempts with exponential backoff, and ' +
        'anything that still fails lands in a dead-letter queue. Operators can replay the dead ' +
        'letters by hand.',
    labels: ['reliability'],
    files: ['src/ingest/retry.ts', 'src/ingest/worker.ts'],
    reviewComments: 1,
    daysAgo: 7,
};

const W4: PrSpec = {
    // long body + number → 0.75
    number: 504,
    title: 'Moved the audit log writer off the request path',
    body:
        'Writing the audit log inline added a database round trip to every mutating request. The ' +
        'writer now publishes to a queue and a consumer batches inserts every 2 seconds. ' +
        'Behaviour is unchanged for readers and the retention job is untouched.',
    labels: ['needs triage'],
    files: ['src/audit/writer.ts', 'src/audit/consumer.ts'],
    reviewComments: 0,
    daysAgo: 9,
};

const W5: PrSpec = {
    // long body + meaningful label, no quantity anywhere → 0.70
    number: 505,
    title: 'Made the settings pages usable with a screen reader',
    body:
        'The settings pages announced nothing when a panel opened, so a screen reader user had no ' +
        'way to tell that the form had changed at all. Every panel now moves focus, names itself, ' +
        'and reports validation errors in a live region that assistive technology can read.',
    labels: ['accessibility'],
    files: ['src/settings/panels.tsx', 'src/settings/form.tsx'],
    reviewComments: 0,
    daysAgo: 11,
};

const W6: PrSpec = {
    // meaningful label only, short body, no quantity → 0.50 (below the cut)
    number: 506,
    title: 'Added an idempotency key to the payments endpoint',
    body:
        'Callers could retry a charge and be billed again. The endpoint now accepts an ' +
        'idempotency key and replays the stored response.',
    labels: ['api'],
    files: ['src/payments/charge.ts'],
    reviewComments: 0,
    daysAgo: 13,
};

/** The PR under review. Authored by someone else; the Win is the review. */
const REVIEWED: PrSpec = {
    number: 520,
    title: 'Introduce a shared cache client',
    body: 'Adds a shared cache client so services stop hand-rolling their own.',
    labels: [],
    files: [],
    reviewComments: 0,
    daysAgo: 6,
    authorLogin: 'sam-eng',
};

/** §12's binary gate: zero bot PRs may ever produce a draft. */
const BOT: PrSpec = {
    number: 599,
    title: 'Bump lodash from 4.17.20 to 4.17.21',
    body: 'Bumps lodash.',
    labels: [],
    files: [],
    reviewComments: 0,
    daysAgo: 4,
    authorLogin: 'dependabot[bot]',
    authorType: 'Bot',
};

/** The review that becomes W7 — `CHANGES_REQUESTED`, so §6.3 keeps it. */
const MY_REVIEW: ReviewSummary = {
    id: 9001,
    authorLogin: LOGIN,
    state: 'CHANGES_REQUESTED',
    body:
        'The shared client swallows connection errors and returns a miss, which means a cache ' +
        'outage looks exactly like a cold cache and the callers behind it will hammer the ' +
        'database without anyone noticing. Please surface the error and let each caller decide.',
    submittedAt: isoDaysAgo(REVIEWED.daysAgo),
};

const LINKED_ISSUE: IssueDetail = {
    nodeId: 'ISSUE_node_77',
    number: 77,
    title: 'Checkout summary is slow for returning customers',
    body:
        'Returning customers wait a long time for the checkout summary to appear. Support has ' +
        'had complaints every week since the pricing change.',
    htmlUrl: `https://github.com/${REPO}/issues/77`,
    repo: REPO,
    labels: ['performance'],
    closedAt: isoDaysAgo(3),
    closedByLogin: LOGIN,
};

const MERGED_SPECS = [W1, W2, W3, W4, W5, W6];

function loadCorpus(): void {
    const pulls: Record<string, PullDetail> = {};
    const files: Record<string, string[]> = {};
    for (const spec of [...MERGED_SPECS, BOT, REVIEWED]) {
        pulls[`${REPO}#${spec.number}`] = pullDetail(spec);
        files[`${REPO}#${spec.number}`] = spec.files;
    }

    mocks().github.load({
        // Issues search answers nothing: the linked issue is resolved through
        // `getIssue`, which is the path that costs a request.
        issues: [],
        merged: [...MERGED_SPECS, BOT].map(searchItem),
        reviewed: [searchItem(REVIEWED)],
        pulls,
        files,
        reviews: { [`${REPO}#${REVIEWED.number}`]: [MY_REVIEW] },
        issueDetails: { [`${REPO}#${LINKED_ISSUE.number}`]: LINKED_ISSUE },
    });
}

// ═══════════════════════════════════════════════════════════════ the drafter
//
// Scripted at the PROVIDER boundary, so `generateStructured` runs for real:
// zod validation, the numeric guard, its corrective retry, the strip, the cost
// log and `sanitizeCaptureDraft` all execute on whatever these return.

const CORRECTION_MARKER = 'Your previous response contained quantities';

function draft(partial: Partial<CaptureDraft> & Pick<CaptureDraft, 'title' | 'narrative'>): CaptureDraft {
    return {
        category: 'improved',
        skills: [],
        collaborators: [],
        suggestedSensitivity: 'shareable',
        quantified: false,
        impact: null,
        quantifyPrompt: 'How much better?',
        shouldDraft: true,
        dismissReason: null,
        ...partial,
    };
}

function scriptDrafter(): void {
    const openai = mocks().openai;

    openai.onObject(W1.title, () =>
        draft({
            title: 'Cut checkout latency for repeat customers',
            narrative:
                'Repeat customers were recomputing the checkout summary on every visit. Memoising it ' +
                'per session and warming it on sign-in took p99 from 900ms to 210ms on the staging ' +
                'replay set.',
            category: 'improved',
            skills: ['Performance engineering', 'TypeScript'],
            quantified: true,
            impact: {
                metric: 'checkout p99 latency',
                baseline: '900ms',
                result: '210ms',
                delta: null,
                scope: null,
                timeframe: null,
            },
            quantifyPrompt: null,
        }),
    );

    openai.onObject(W2.title, () =>
        draft({
            title: 'Contained a leaked service credential in the gateway',
            narrative:
                'A service credential reached the gateway package and was picked up by a scanner. ' +
                'Rotated the credential, revoked the old value, and added a pre-receive check so the ' +
                'same class of mistake cannot land again. The response ran for 45 minutes end to end.',
            category: 'fixed',
            skills: ['Application security'],
            suggestedSensitivity: 'confidential',
            quantifyPrompt: 'How long was the exposure?',
        }),
    );

    // The adversarial one. First answer invents "40%", which appears nowhere in
    // the PR; the guard's corrective retry gets the honest version. A drafter
    // that can never fabricate would make the no-fabrication assertion vacuous.
    openai.onObject(W3.title, ({ prompt }) =>
        draft({
            title: 'Reworked the ingest retry policy',
            narrative: prompt.includes(CORRECTION_MARKER)
                ? 'Ingest workers retried a poisoned message forever and starved the shard behind it. ' +
                  'Retries now cap at 5 attempts with exponential backoff, and anything that still ' +
                  'fails lands in a dead-letter queue operators can replay.'
                : 'Ingest workers retried a poisoned message forever and starved the shard behind it. ' +
                  'Retries now cap at 5 attempts with exponential backoff, which cut ingest failures ' +
                  'by 40%.',
            skills: ['Distributed systems'],
            quantifyPrompt: 'How many retries now?',
        }),
    );

    openai.onObject(W4.title, () =>
        draft({
            title: 'Moved the audit log writer off the request path',
            narrative:
                'Audit writes added a database round trip to every mutating request. The writer now ' +
                'publishes to a queue and a consumer batches inserts every 2 seconds, leaving reader ' +
                'behaviour unchanged.',
            skills: ['Distributed systems'],
            quantifyPrompt: 'How much faster?',
        }),
    );

    openai.onObject(W5.title, () =>
        draft({
            title: 'Made the settings pages usable with a screen reader',
            narrative:
                'Settings panels announced nothing to assistive technology when they opened. Each ' +
                'panel now moves focus, names itself, and reports validation errors in a live region.',
            skills: ['Accessibility'],
            quantifyPrompt: 'Which pages changed?',
        }),
    );

    openai.onObject(W6.title, () =>
        draft({
            title: 'Added an idempotency key to the payments endpoint',
            narrative:
                'Callers could retry a charge and be billed again. The endpoint now accepts an ' +
                'idempotency key and replays the stored response rather than creating another charge.',
            category: 'shipped',
            skills: ['API design'],
            quantifyPrompt: 'How many callers retry?',
        }),
    );

    openai.onObject(REVIEWED.title, () =>
        draft({
            title: 'Blocked a shared cache client that hid outages',
            narrative:
                'Reviewed the shared cache client and showed that swallowing connection errors makes ' +
                'a cache outage indistinguishable from a cold cache, then asked for the error to ' +
                'surface so each caller can decide what to do.',
            category: 'influenced',
            skills: ['Distributed systems'],
            quantifyPrompt: 'Which teams changed course?',
        }),
    );
}

// ═══════════════════════════════════════════════════════════════ helpers

const FLAG_KEYS = ['github_capture', 'weekly_digest'] as const;
/**
 * Row ids that end up inside a handler-minted `dedupeKey`. `purge` matches job
 * rows on the run id, and a child job's key is built from the parent row's id,
 * so those keys have to be collected as the journey discovers them or the Job
 * table keeps a row per run forever.
 */
const jobKeyFragments: string[] = [];

/** A second identity for this run. Run-id prefixed, so `purge` reaches it. */
function newUser(label: string): string {
    return `${journey.runId}:${label}`;
}

async function enableFlags(userIds: string[]): Promise<void> {
    for (const key of FLAG_KEYS) {
        await prisma.featureFlag.upsert({
            where: { key },
            create: { key, enabled: true, rolloutPercent: 0, allowUserIds: userIds },
            update: { enabled: true, rolloutPercent: 0, allowUserIds: userIds },
        });
    }
    invalidateFlagCache();
}

/** Clerk's view of a user who linked GitHub with the `repo` scope. */
function linkGithubIdentity(userId: string): void {
    journey.clerk.setUser(userId, {
        externalAccounts: [{ provider: 'oauth_github', username: LOGIN }],
        oauthTokens: { github: { token: 'gho_test_token', scopes: ['repo'] } },
    });
}

/**
 * `sendEmail` reads the recipient off `UserProfile`, and the scheduler reads the
 * slot off `EmailPreference`. Neither has a product surface inside this loop, so
 * both are arranged directly. Arrange only — nothing here is ever asserted on.
 */
async function seedProfileAndPreferences(userId: string, email: string): Promise<void> {
    await prisma.userProfile.upsert({
        where: { userId },
        create: { userId, email, fullName: 'Maya Dev' },
        update: { email },
    });
    await prisma.emailPreference.upsert({
        where: { userId },
        create: { userId, unsubscribeToken: `unsub-${userId}`, timezone: 'Etc/UTC' },
        update: { timezone: 'Etc/UTC' },
    });
    await alignDigestSlot(userId);
}

/**
 * Put the user's digest slot on this very hour, in UTC, so the derived
 * scheduler (ADR-3) finds them due right now. Re-applied immediately before the
 * dispatch: nothing stores a next-run, so a test that crossed an hour boundary
 * between arrange and act would simply not be due.
 */
async function alignDigestSlot(userId: string): Promise<void> {
    const now = new Date();
    await prisma.emailPreference.update({
        where: { userId },
        data: { digestDay: ((now.getUTCDay() + 6) % 7) + 1, digestHour: now.getUTCHours() },
    });
}

/**
 * The §4.2 grounding source, rebuilt from the persisted signals.
 *
 * Deliberately re-derived here rather than imported from `drafting.ts`: a
 * no-fabrication check that shares its source-text builder with the code it is
 * checking proves nothing about either.
 */
function groundingSourceOf(rows: readonly CaptureSignal[]): string {
    const parts: string[] = [];
    for (const row of rows) {
        parts.push(row.title, row.body);
        const meta = (row.metadata ?? {}) as {
            linkedIssue?: { title?: string; body?: string } | null;
            role?: string;
            reviewBody?: string;
        };
        if (meta.linkedIssue) parts.push(meta.linkedIssue.title ?? '', meta.linkedIssue.body ?? '');
        if (meta.role === 'reviewer' && meta.reviewBody) parts.push(meta.reviewBody);
    }
    return parts.filter((part) => part && part.trim()).join('\n\n');
}

/** Every `/w/<token>` in the delivered mail, verified and decoded. */
function tokensIn(body: string): Array<{ token: string; winId: string; action: string }> {
    const out: Array<{ token: string; winId: string; action: string }> = [];
    const seen = new Set<string>();
    for (const match of body.matchAll(/\/w\/([A-Za-z0-9_.%-]+)/g)) {
        const token = decodeURIComponent(match[1]);
        if (seen.has(token)) continue;
        seen.add(token);
        const payload = verifyWinToken(token);
        if (payload) out.push({ token, winId: payload.winId, action: payload.action });
    }
    return out;
}

function confirmTokenFor(body: string, winId: string): string {
    const found = tokensIn(body).find((entry) => entry.winId === winId && entry.action === 'confirm');
    if (!found) throw new Error(`no confirm token for win ${winId} in the delivered email`);
    return found.token;
}

type PageResult = { props: { headline: string; children: unknown } };

/** Tap the link the way a logged-out reader does: the real route, no session. */
async function tapMagicLink(token: string): Promise<{ headline: string; body: string }> {
    const element = (await MagicLinkPage({
        params: Promise.resolve({ token }),
        searchParams: Promise.resolve({}),
    })) as unknown as PageResult;
    return { headline: element.props.headline, body: elementText(element.props.children) };
}

function elementText(node: unknown): string {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(elementText).join(' ');
    if (typeof node === 'object' && 'props' in node) {
        const props = (node as { props?: { children?: unknown } }).props;
        return elementText(props?.children);
    }
    return '';
}

async function countGraph(winId: string): Promise<{ evidence: number; links: number; events: number }> {
    const links = await prisma.claimLink.findMany({
        where: { claimType: 'win', claimRefId: winId },
        select: { evidenceId: true },
    });
    return {
        links: links.length,
        evidence: await prisma.evidence.count({ where: { id: { in: links.map((l) => l.evidenceId) } } }),
        events: await prisma.funnelEvent.count({
            where: { type: 'digest_action', payload: { path: ['winId'], equals: winId } },
        }),
    };
}

/**
 * `assertNoDeadJobs` only sees jobs whose dedupe key carries the run id, and
 * the keys a handler mints for its own children are built from row ids. So the
 * queue is also checked wholesale: after a drain, every job this run created
 * must have SUCCEEDED. A handler that failed once sits in backoff as `pending`
 * rather than `dead`, and would otherwise pass unnoticed.
 */
async function assertQueueHealthy(since: Date): Promise<void> {
    const unfinished = await prisma.job.findMany({
        where: { createdAt: { gte: since }, status: { not: 'succeeded' } },
        select: { kind: true, status: true, attempts: true, lastError: true },
    });
    if (unfinished.length > 0) {
        throw new Error(
            `queue did not settle clean: ${unfinished
                .map((job) => `${job.kind}[${job.status}, ${job.attempts} attempt(s)]: ${job.lastError}`)
                .join(' | ')}`,
        );
    }
}

const startedAt = new Date();

beforeAll(async () => {
    __flagSnapshot = await snapshotFlags();
    // The one place the MockGithubApi is handed over: the real adapter, with a
    // fake client underneath, so `pull` — queries, pagination, the request
    // budget, the cursor watermark — is the code actually under test.
    captureRegistry.__testing.set(
        CaptureSourceKind.github,
        createGithubAdapter({ createApi: () => mocks().github }),
    );
});

afterAll(async () => {
    captureRegistry.__testing.reset();
    for (const fragment of jobKeyFragments) {
        await prisma.job.deleteMany({ where: { dedupeKey: { contains: fragment } } });
    }
    await prisma.featureFlag.deleteMany({ where: { key: { in: [...FLAG_KEYS] } } });
    invalidateFlagCache();


    // LAST. Some of these files also delete or disable flags in their own
    // cleanup, and a restore placed first was simply undone by the lines
    // after it — `j1` restored the table and then deleted the same rows.
    await restoreFlags(__flagSnapshot);
});

// ═══════════════════════════════════════════════════════════════ J1

describe('J1 — the core loop', () => {
    test('connect → sync → draft → digest → magic-link confirm → grounded → embedded → logged', async () => {
        const userId = journey.userId;
        journey.clerk.signIn(userId);
        linkGithubIdentity(userId);
        await enableFlags([userId]);
        await seedProfileAndPreferences(userId, 'maya@example.com');
        loadCorpus();
        scriptDrafter();

        // ── HOP 1. Connect ───────────────────────────────────────────────
        const connected = await connectGithub({ mode: 'full' });
        expect(connected.success).toBe(true);
        if (!connected.success) return;

        const source = await prisma.captureSource.findUniqueOrThrow({
            where: { userId_kind: { userId, kind: CaptureSourceKind.github } },
        });
        jobKeyFragments.push(connected.data.sourceId);
        expect(source.id).toBe(connected.data.sourceId);
        expect(source.status).toBe(CaptureSourceStatus.active);
        expect(source.externalAccountId).toBe(LOGIN);
        // The consent version is the whole point of the record: it answers
        // "what exactly did this user agree to, and when".
        expect(source.consentCopyVersion).toBe(GITHUB_CONSENT_VERSION);
        expect(source.consentGrantedAt).not.toBeNull();
        // Connecting must not start a scan — the repo picker is mandatory.
        expect(await prisma.captureSignal.count({ where: { userId } })).toBe(0);

        // ── HOP 2. Sync ──────────────────────────────────────────────────
        const saved = await saveRepoSelection([REPO]);
        expect(saved.success).toBe(true);
        if (!saved.success) return;
        expect(saved.data.initial).toBe(true);

        await drainJobs();

        const run = await prisma.captureRun.findFirstOrThrow({
            where: { sourceId: source.id },
            orderBy: { startedAt: 'desc' },
        });
        expect(run.status).toBe(CaptureRunStatus.success);

        const signalsAfterFirst = await prisma.captureSignal.findMany({
            where: { userId },
            orderBy: { externalId: 'asc' },
        });
        // Six merged PRs plus one review. The bot PR is dropped before storage.
        expect(signalsAfterFirst).toHaveLength(7);
        expect(signalsAfterFirst.filter((s) => s.isNoise)).toHaveLength(0);
        expect(signalsAfterFirst.some((s) => s.externalId === `PR_node_${BOT.number}`)).toBe(false);
        // A bot PR must not even cost us a request (§6.1).
        expect(mocks().github.calls).not.toContain(`getPullRequest:${REPO}#${BOT.number}`);

        const winsAfterFirst = await prisma.win.findMany({ where: { userId } });
        expect(winsAfterFirst).toHaveLength(7);

        // ── Sync again. The unique constraints are the idempotency. ──────
        // Driven through the scheduled dispatch, which is the real cron path:
        // one parent job fans out one child per due source.
        await enqueue(
            'capture_sync',
            {},
            { dedupeKey: buildDedupeKey('capture_sync', ['j1-resync', journey.runId]) },
        );
        await drainJobs();

        const signalsAfterSecond = await prisma.captureSignal.findMany({
            where: { userId },
            select: { externalId: true, sourceId: true },
        });
        const winsAfterSecond = await prisma.win.count({ where: { userId } });
        expect(signalsAfterSecond).toHaveLength(7);
        // `@@unique([sourceId, externalId])` is the whole idempotency story.
        expect(new Set(signalsAfterSecond.map((s) => `${s.sourceId}|${s.externalId}`)).size).toBe(7);
        expect(winsAfterSecond).toBe(7);
        expect(await prisma.win.count({ where: { userId, signalId: null } })).toBe(0);

        // ── HOP 3. Draft ─────────────────────────────────────────────────
        const drafts = await prisma.win.findMany({ where: { userId } });
        for (const win of drafts) jobKeyFragments.push(win.id);
        for (const captureRun of await prisma.captureRun.findMany({ where: { userId }, select: { id: true } })) {
            jobKeyFragments.push(captureRun.id);
        }
        expect(drafts.every((win) => win.status === WinStatus.draft)).toBe(true);
        expect(drafts.every((win) => win.source === WinSource.github)).toBe(true);
        expect(drafts.every((win) => win.embedded === false)).toBe(true);

        const signalsByWin = new Map<string, CaptureSignal[]>();
        for (const signal of await prisma.captureSignal.findMany({ where: { userId } })) {
            if (!signal.winId) continue;
            const bucket = signalsByWin.get(signal.winId) ?? [];
            bucket.push(signal);
            signalsByWin.set(signal.winId, bucket);
        }

        for (const win of drafts) {
            const rows = signalsByWin.get(win.id) ?? [];
            expect(rows.length).toBeGreaterThan(0);
            const sourceText = groundingSourceOf(rows);
            const impact = await prisma.impactMetric.findFirst({
                where: { subjectType: 'win', subjectId: win.id },
            });
            const generated = [
                win.title,
                win.narrative,
                impact?.metric ?? '',
                impact?.baseline ?? '',
                impact?.result ?? '',
                impact?.delta ?? '',
            ].join('\n');
            // §12's launch gate, per Win, on the assembled record.
            assertNoFabricatedNumbers(generated, sourceText);
            // A draft is not a claim. It must be neither grounded nor visible.
            await assertNotGrounded(win.id);
            await assertNoVector(win.id);
        }

        // The guard actually fired on W3: two model round-trips, not one.
        const w3 = drafts.find((win) => win.title === 'Reworked the ingest retry policy');
        expect(w3).toBeDefined();
        expect(w3?.narrative).not.toContain('40%');
        // Counted by DISTINCT input, not by call.
        //
        // The claim is "the drafter was asked twice about this Win — once
        // plainly, once with the correction prompt appended". Counting raw
        // calls also counts repeats of those same two inputs, and that made
        // this line fail about one full-suite run in six with 4 instead of 2.
        // It only ever reproduced under the whole suite, never in a subset,
        // which points at the job being retried under load rather than at
        // anything the guard did. A rerun of the same work is not a third
        // question, so the fingerprint — a stable digest of the model input —
        // is what the assertion should be over.
        const w3Fingerprints = new Set(
            mocks()
                .openai.objectCalls.filter((call) => call.prompt.includes(W3.title))
                .map((call) => call.fingerprint),
        );
        expect(w3Fingerprints.size).toBe(2);
        // …and the gate that cleared every Win is one that can fail: the figure
        // the drafter reached for on its first attempt is not in the PR.
        const w3Source = groundingSourceOf(signalsByWin.get(w3?.id ?? '') ?? []);
        expect(() => assertNoFabricatedNumbers('cut ingest failures by 40%', w3Source)).toThrow(
            /fabricated/,
        );

        const shareableWin = drafts.find((win) => win.title === 'Cut checkout latency for repeat customers');
        const confidentialWin = drafts.find((win) => win.sensitivity === WinSensitivity.confidential);
        expect(shareableWin).toBeDefined();
        expect(confidentialWin).toBeDefined();
        if (!shareableWin || !confidentialWin) return;
        expect(shareableWin.sensitivity).toBe(WinSensitivity.shareable);
        expect(confidentialWin.title).toBe('Contained a leaked service credential in the gateway');

        // ── HOP 4. Digest ────────────────────────────────────────────────
        // The hourly dispatch decides who is due; it never sends inline.
        await alignDigestSlot(userId);
        await enqueue(
            'weekly_digest',
            {},
            { dedupeKey: buildDedupeKey('weekly_digest', ['j1-dispatch', journey.runId]) },
        );
        await drainJobs();

        const digest = await prisma.weeklyDigest.findUniqueOrThrow({
            where: { userId_weekStart: { userId, weekStart: weekStartFor('Etc/UTC') } },
        });
        expect(digest.sentAt).not.toBeNull();
        expect(digest.skipped).toBe(false);

        const digestWinIds = (digest.winIds as string[]) ?? [];
        // "up to 5 drafted Wins" — the cut is made once, in `selectDigestDrafts`.
        expect(digestWinIds).toHaveLength(5);
        expect(digestWinIds).toContain(shareableWin.id);
        expect(digestWinIds).toContain(confidentialWin.id);

        // The rendered mail, not an input object: preferences, plain text and
        // the RFC 8058 headers all ran on the way here.
        const sent = mocks().email.sent;
        expect(sent).toHaveLength(1);
        const mail = sent[0];
        expect(mail.to).toEqual(['maya@example.com']);
        expect(mail.subject).toBe('5 things you did this week');
        expect(mail.text).toContain('+2 more');
        expect(mail.text).toContain('Unsubscribe:');
        expect(mail.html).not.toContain('<img');
        expect(mail.headers['List-Unsubscribe']).toContain('/api/email/unsubscribe');
        expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
        expect(mail.idempotencyKey).toBe(`weekly_digest:${digest.id}`);
        expect(await prisma.emailSend.count({ where: { userId, template: 'weekly_digest' } })).toBe(1);

        // ── HOP 5. Confirm, from the inbox, with no session ──────────────
        const body = `${mail.text}\n${mail.html}`;
        const confirmToken = confirmTokenFor(body, shareableWin.id);
        const confidentialToken = confirmTokenFor(body, confidentialWin.id);

        journey.clerk.signOut();
        expect(journey.clerk.userId).toBeNull();

        const tapped = await tapMagicLink(confirmToken);
        expect(tapped.headline).toBe('✓  Logged');
        expect(tapped.body).toContain(shareableWin.title);

        expect(
            (await prisma.win.findUniqueOrThrow({ where: { id: shareableWin.id } })).status,
        ).toBe(WinStatus.confirmed);
        await assertGrounded(shareableWin.id);
        expect(await countGraph(shareableWin.id)).toEqual({ evidence: 1, links: 1, events: 1 });

        // The same tap for the confidential Win — still logged out.
        expect((await tapMagicLink(confidentialToken)).headline).toBe('✓  Logged');
        await assertGrounded(confidentialWin.id);

        // ── HOP 6. Embed ─────────────────────────────────────────────────
        await drainJobs();
        await assertHasVector(shareableWin.id);
        // ADR-8: a confidential Win is never embedded, at any point in the loop.
        await assertNoVector(confidentialWin.id);
        expect(
            (await prisma.win.findUniqueOrThrow({ where: { id: confidentialWin.id } })).embedded,
        ).toBe(false);

        // Idempotent by construction: the point id is derived from the Win id,
        // so a second run converges on the same point rather than a second one.
        await enqueue(
            'embed_win',
            { winId: shareableWin.id },
            { dedupeKey: buildDedupeKey('embed_win', ['j1-again', journey.runId]) },
        );
        await drainJobs();
        await assertHasVector(shareableWin.id);

        // …and it never reaches external retrieval.
        const probe = await generateEmbedding({
            text: 'checkout latency work',
            userId,
            operation: 'embedding_generate',
        });
        const external = await qdrantModule.qdrantClient.search(JOURNEY_COLLECTION, {
            vector: probe,
            limit: 50,
            filter: qdrantExternalFilter(userId),
        });
        const externalIds = external.map((hit) => (hit.payload as { sourceId?: string })?.sourceId);
        expect(externalIds).toContain(shareableWin.id);
        expect(externalIds).not.toContain(confidentialWin.id);
        expect(probe).toHaveLength(config.openai.embedding.size);

        // ── HOP 7. The log ───────────────────────────────────────────────
        journey.clerk.signIn(userId);
        const log = await listWins({ status: [WinStatus.confirmed] });
        expect(log.success).toBe(true);
        if (!log.success) return;
        expect(log.data.total).toBe(2);
        const logged = log.data.items.find((item) => item.id === shareableWin.id);
        expect(logged).toBeDefined();
        expect(logged?.status).toBe(WinStatus.confirmed);

        // ── Replay. Tapping the same link twice changes nothing. ─────────
        journey.clerk.signOut();
        const replay = await tapMagicLink(confirmToken);
        expect(replay.headline).toBe('✓  Logged');
        expect(replay.body).toContain('You already logged this one.');

        const resolved = await resolveWinToken(confirmToken);
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;
        const applied = await applyDigestAction(resolved.resolved, { surface: 'email' });
        expect(applied.outcome).toBe('already_done');

        expect(await countGraph(shareableWin.id)).toEqual({ evidence: 1, links: 1, events: 1 });
        await assertHasVector(shareableWin.id);
        await drainJobs();
        await assertHasVector(shareableWin.id);

        // ── Un-confirm reverses everything (CLAUDE.md rule 5). ───────────
        const undone = await undoFromDigestLink(confirmToken);
        expect(undone).toEqual({ status: 'undone' });

        expect(
            (await prisma.win.findUniqueOrThrow({ where: { id: shareableWin.id } })).status,
        ).toBe(WinStatus.draft);
        await assertNotGrounded(shareableWin.id);
        await assertNoVector(shareableWin.id);
        expect((await countGraph(shareableWin.id)).evidence).toBe(0);
        // Nothing in the queue resurrects it.
        await drainJobs();
        await assertNoVector(shareableWin.id);
        // The confidential Win never had a vector to lose.
        await assertNoVector(confidentialWin.id);

        journey.clerk.signIn(userId);
        await assertQueueHealthy(startedAt);
    }, 60_000);

    test('a quiet week sends no email at all', async () => {
        const quietId = newUser('quiet');
        journey.clerk.signIn(quietId);
        await enableFlags([journey.userId, quietId]);
        await seedProfileAndPreferences(quietId, 'quiet@example.com');

        const weekStart = weekStartFor('Etc/UTC');
        await enqueue(
            'weekly_digest',
            { userId: quietId, weekStart: weekStart.toISOString() },
            { dedupeKey: buildDedupeKey('weekly_digest', ['j1-quiet', quietId]) },
        );
        await drainJobs();

        expect(mocks().email.sent).toHaveLength(0);
        expect(await prisma.emailSend.count({ where: { userId: quietId } })).toBe(0);

        const row = await prisma.weeklyDigest.findUniqueOrThrow({
            where: { userId_weekStart: { userId: quietId, weekStart } },
        });
        // The week is recorded as skipped, so the three-empty-week nudge can
        // count — but nothing was sent.
        expect(row.skipped).toBe(true);
        expect(row.sentAt).toBeNull();
    }, 30_000);

    test('no job died and nothing leaked', async () => {
        await assertQueueHealthy(startedAt);
        await assertNoDeadJobs(journey.runId);

        await purge(journey.runId);
        expect(await assertPurged(journey.runId)).toEqual({});
    }, 30_000);
});
