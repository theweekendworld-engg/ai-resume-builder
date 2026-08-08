/**
 * J2 — the payoff loop (impl/04 §4).
 *
 * 40 confirmed Wins -> review packet -> themes -> competency mapping ->
 * truthfulness pass -> readiness report -> export.
 *
 * This is the output an employed person pays for; everything else in R1 builds
 * the input. Four properties are load-bearing, and the file is organised around
 * them rather than around the code:
 *
 *   1. **Nothing in a packet exists without a Win behind it.** Every block
 *      carries `sourceWinIds`, every id is in scope, and the truthfulness pass
 *      resolves anything it cannot tie to a Win *down*, never up.
 *   2. **Zero fabricated quantities.** The model here is scripted to *try* —
 *      it derives a percentage from two real figures and invents a user count,
 *      which are the two fabrications real models actually produce. A test
 *      where the model behaves proves nothing about the guard, so this one
 *      misbehaves on purpose and the pass condition is that none of it survives.
 *   3. **3–5 themes, never six.** Six themes reads as "I did a lot of
 *      unrelated things". When the work genuinely does not group, the packet
 *      says so instead of inventing coherence.
 *   4. **A confidential Win never reaches an external artifact** when the user
 *      says so — and never reaches the vector store at all.
 *
 * Real Postgres, real server actions, real workflow steps. Only the model and
 * the vector store are doubled.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Tier, WinCategory, WinSensitivity } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { mocks } from '@/__mocks__';
import { invalidateFlagCache } from '@/lib/flags';
import {
    assertNoDeadJobs,
    assertNoFabricatedNumbers,
    assertNoVector,
    assertPurged,
    defineJourney,
    drainJobs,
    purge,
} from '@/__journeys__/harness';
import type { PacketBlock, PacketContent } from '@/services/reviewPacket';
import { restoreFlags, snapshotFlags, type FlagSnapshot } from '@/lib/flags.test-utils';

beforeAll(async () => {
    __flagSnapshot = await snapshotFlags();
});

/** Restored in `afterAll` — the suite shares a database with development. */
let __flagSnapshot: FlagSnapshot = [];

// `defineJourney` registers the Clerk module mock at module scope, so anything
// that binds `auth()` is imported after it. Type-only imports above are erased
// and therefore cannot bind anything.
const journey = defineJourney({
    name: 'payoff-loop',
    // `openai` for drafting/themes/mapping/composition, `qdrant` because
    // confirming a Win enqueues a real `embed_win` job and because the
    // confidential Win's *absence* from the store is one of the assertions.
    boundaries: ['openai', 'qdrant'],
});

const { confirmWin, createWinFromText } = await import('@/actions/wins');
const {
    editPacketBlock,
    exportPacket,
    getPacket,
    getPacketScope,
    getReadiness,
    regeneratePacket,
    startPacket,
} = await import('@/actions/packets');

// ─────────────────────────────────────────────────────────────── the period

const PERIOD_START = new Date('2026-01-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-08-01T00:00:00.000Z');

// ───────────────────────────────────────────────────────────────── the wins
//
// Forty of them, and every detail below is chosen so an assertion downstream
// means what it says:
//
//   - **No digit anywhere is a 7.** `assertNoFabricatedNumbers` strips
//     whitespace before it looks for a figure in the source, so a stray `7` in
//     one title next to a `7` in the next would make the string "77" appear in
//     the source by accident and quietly excuse the fabrication the model is
//     scripted to attempt.
//   - **No `grew` Win.** The category priors are the only thing mapping work
//     onto `mentorship`, so leaving the category out is what makes the
//     readiness report's `absent` verdict a real answer rather than a
//     coincidence.
//   - **Three quarters carry an `ImpactMetric`**, which is what puts the
//     evidence share over the `strong` threshold for the competencies that
//     deserve it.

const SUBJECTS = [
    'checkout', 'pricing', 'orders', 'sessions', 'billing',
    'search', 'notifications', 'ingest', 'reporting', 'onboarding',
];
const ASPECTS = ['batching layer', 'retry path', 'cache warmer', 'index plan'];

/** Deliberately excludes `grew`. See the note above. */
const CATEGORY_CYCLE: WinCategory[] = [
    WinCategory.shipped,
    WinCategory.improved,
    WinCategory.fixed,
    WinCategory.led,
    WinCategory.influenced,
    WinCategory.learned,
    WinCategory.saved,
];

const VERB: Record<WinCategory, string> = {
    [WinCategory.shipped]: 'Shipped',
    [WinCategory.improved]: 'Tightened',
    [WinCategory.fixed]: 'Fixed',
    [WinCategory.led]: 'Led the rebuild of',
    [WinCategory.influenced]: 'Changed the decision on',
    [WinCategory.learned]: 'Learned and applied',
    [WinCategory.saved]: 'Took cost out of',
    [WinCategory.grew]: 'Grew',
};

const METRICS = [
    { metric: 'p95 latency', baseline: '800ms', result: '180ms' },
    { metric: 'error rate', baseline: '3.2%', result: '0.4%' },
    { metric: 'memory use', baseline: '1.2GB', result: '640MB' },
    { metric: 'cold start', baseline: '900ms', result: '250ms' },
    { metric: 'build time', baseline: '6 min', result: '4 min' },
];

const CONFIDENTIAL_INDEX = 20;
const CONFIDENTIAL_TITLE = 'Unreleased pricing experiment for the enterprise tier';
/** The one Win whose narrative states a scope, so a scope line can be legitimate. */
const MARKETS_INDEX = 3;

type Seed = {
    title: string;
    narrative: string;
    category: WinCategory;
    occurredAt: Date;
    sensitivity: WinSensitivity;
    impact: { metric: string; baseline: string; result: string } | null;
};

function seedAt(index: number): Seed {
    const category = CATEGORY_CYCLE[index % CATEGORY_CYCLE.length];
    const subject = SUBJECTS[index % SUBJECTS.length];
    const aspect = ASPECTS[Math.floor(index / SUBJECTS.length)];
    const confidential = index === CONFIDENTIAL_INDEX;

    return {
        title: confidential ? CONFIDENTIAL_TITLE : `${VERB[category]} the ${subject} ${aspect}`,
        narrative: confidential
            ? 'Ran the experiment behind a flag for a single design partner.'
            : index === MARKETS_INDEX
                ? `Reworked the ${subject} ${aspect} end to end. Rolled it out to 12 markets.`
                : `Reworked the ${subject} ${aspect} end to end.`,
        category,
        // Four days apart from 1 Feb, so all forty land inside the period and
        // the ordering the packet renders is stable across runs.
        occurredAt: new Date(Date.UTC(2026, 1, 1 + index * 4)),
        sensitivity: confidential ? WinSensitivity.confidential : WinSensitivity.shareable,
        impact: index % 4 === 0 ? null : METRICS[index % METRICS.length],
    };
}

const SEEDS: Seed[] = Array.from({ length: 40 }, (_unused, index) => seedAt(index));

/**
 * Everything the model was allowed to draw a figure from, rebuilt here rather
 * than imported from `guardSourceText`. A check that shares its source
 * definition with the thing it checks proves less than one that does not.
 */
const SOURCE_TEXT = SEEDS.map((seed) =>
    [
        seed.title,
        seed.narrative,
        seed.impact ? `${seed.impact.metric} ${seed.impact.baseline} ${seed.impact.result}` : '',
    ]
        .filter(Boolean)
        .join(' '),
).join('\n');

/** Populated by hop 1; the theme script partitions these. */
const winIds: string[] = [];
let packetId = '';

// ─────────────────────────────────────────────────────────────── arrangement

/**
 * Flag and subscription are the state of the world before the journey starts.
 * The flag is an admin surface and the subscription is J4's loop; arranging
 * both directly keeps this file about the packet.
 */
async function arrangeAccess(userId: string): Promise<void> {
    const existing = await prisma.featureFlag.findUnique({
        where: { key: 'review_packet' },
        select: { allowUserIds: true },
    });
    const allow = Array.isArray(existing?.allowUserIds)
        ? existing.allowUserIds.filter((entry): entry is string => typeof entry === 'string')
        : [];

    await prisma.featureFlag.upsert({
        where: { key: 'review_packet' },
        create: {
            key: 'review_packet',
            enabled: false,
            allowUserIds: [userId],
            description: 'Career OS: review_packet',
        },
        update: { allowUserIds: [...new Set([...allow, userId])] },
    });
    invalidateFlagCache();

    await prisma.subscription.create({
        data: {
            userId,
            stripeCustomerId: `cus_${journey.runId}`,
            tier: Tier.always_on,
            status: 'active',
            currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        },
    });
}

async function releaseFlag(userId: string): Promise<void> {
    const existing = await prisma.featureFlag.findUnique({
        where: { key: 'review_packet' },
        select: { allowUserIds: true },
    });
    if (!existing) return;
    const allow = Array.isArray(existing.allowUserIds)
        ? existing.allowUserIds.filter((entry): entry is string => typeof entry === 'string')
        : [];
    await prisma.featureFlag.update({
        where: { key: 'review_packet' },
        data: { allowUserIds: allow.filter((entry) => entry !== userId) },
    });
    invalidateFlagCache();
}

// ─────────────────────────────────────────────────────────── model scripting

/**
 * The theme grouping the model is asked for: four themes, outcome-framed,
 * partitioning all forty Wins. Digit-free on purpose — the fabrication under
 * test belongs to the composition step, and a number here would confound it.
 */
const THEME_TITLES = [
    'Made checkout reliable at peak',
    'Cut what the platform costs to run',
    'Raised the bar on how the team decides',
    'Turned undefined problems into shipped ones',
];

const THEME_OUTCOMES = [
    'The checkout path is measurably faster and no longer the top source of failures.',
    'The same workload now runs on materially less memory and less build time.',
    'The team changed how it makes calls on the pricing and billing surfaces.',
    'Work that arrived undefined left as something running in production.',
];

function scriptThemes(count = 4): void {
    mocks().openai.onObject('You group a person', () => {
        const perTheme = Math.ceil(winIds.length / count);
        return {
            object: {
                themes: Array.from({ length: count }, (_unused, index) => ({
                    title: THEME_TITLES[index % THEME_TITLES.length],
                    outcomeSentence: THEME_OUTCOMES[index % THEME_OUTCOMES.length],
                    winIds: winIds.slice(index * perTheme, (index + 1) * perTheme),
                    scope: null,
                    strength: index === 0 ? 'headline' : 'supporting',
                })),
                unthemed: [],
                coherenceNote: null,
            },
        };
    });
}

/** The derived percentage and the invented user count, in one response. */
const FABRICATED_OUTCOME =
    'Cut checkout p95 by 77%, from 800ms to 180ms, across the whole quarter.';
const FABRICATED_SCOPE = 'for 2M weekly users';

const CLEAN_SUMMARY =
    'I spent this period on the paths that carry money: checkout, pricing and billing. ' +
    'The work was measured rather than asserted, and the numbers are in the log. ' +
    'The remaining gap is the part of the record that is about other people.';

// No written quantity anywhere in here on purpose: the guard treats "six
// months" and "two engineers" as figures, and a legitimate one would be
// stripped alongside the fabrication and muddy what this hop proves.
const CLEAN_GROWTH =
    'Mentorship is the competency with nothing behind it this period. The record needs ' +
    'engineers I have deliberately grown, logged as it happens rather than reconstructed ' +
    'later from a commit history that cannot show it.';

function scriptComposition(): void {
    mocks().openai.onObject('You write a performance review packet', {
        object: {
            summary: CLEAN_SUMMARY,
            themeOutcomes: [
                // Theme 0 is where the model misbehaves: a percentage derived
                // from two figures that ARE in the log, plus a scope that is not.
                { index: 0, outcomeSentence: FABRICATED_OUTCOME, impact: FABRICATED_SCOPE },
                {
                    index: 1,
                    outcomeSentence: 'Memory use came down from 1.2GB to 640MB on the same workload.',
                    impact: null,
                },
                {
                    index: 2,
                    outcomeSentence: 'The pricing rollout reached 12 markets on the agreed plan.',
                    impact: '12 markets',
                },
                {
                    index: 3,
                    outcomeSentence: 'Undefined ingest and reporting work left as running systems.',
                    impact: null,
                },
            ],
            growth: CLEAN_GROWTH,
        },
    });
}

// ────────────────────────────────────────────────────────────── the pipeline

/**
 * `startPacket` hands the run to the workflow and returns; the generation
 * screen polls. This does the same thing the screen does rather than reaching
 * into the steps, which is the only way the journey exercises the real
 * start-to-finish path.
 */
async function awaitPacket(id: string): Promise<PacketContent> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
        const view = await getPacket(id);
        if (!view.success) throw new Error(`getPacket: ${view.error}`);
        if (view.data.status === 'failed') {
            const stage = view.data.progress?.stages.find((entry) => entry.status === 'error');
            throw new Error(`packet generation failed at ${stage?.id}: ${stage?.result}`);
        }
        if (view.data.status === 'ready' && view.data.content) return view.data.content;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('packet never left `generating`');
}

/** Every block a reader actually sees, in one list. */
function allBlocks(content: PacketContent): PacketBlock[] {
    const blocks: PacketBlock[] = [content.summary, content.growth];
    for (const theme of content.themes) {
        blocks.push(theme.outcome);
        if (theme.impact) blocks.push(theme.impact);
        blocks.push(...theme.bullets);
    }
    return blocks;
}

/**
 * Everything the model wrote, as opposed to everything copied from a Win.
 *
 * `coherenceNote` is deliberately absent: on the fallback path it is
 * app-computed copy that legitimately states a count of categories, which is a
 * fact about the log rather than a figure a model produced. It gets asserted
 * literally at its own hop instead.
 */
function generatedProse(content: PacketContent): string[] {
    return [
        content.summary.text,
        content.growth.text,
        ...content.themes.flatMap((theme) => [
            theme.title,
            theme.outcome.text,
            theme.impact?.text ?? '',
        ]),
    ].filter((text) => text.trim().length > 0);
}

// ═════════════════════════════════════════════════════════════════ the loop

describe('J2 — the payoff loop', () => {
    test('hop 1 — forty confirmed wins go in, and the scope screen counts them', async () => {
        await arrangeAccess(journey.userId);
        journey.clerk.signIn(journey.userId);

        for (const seed of SEEDS) {
            const created = await createWinFromText({
                draft: {
                    title: seed.title,
                    narrative: seed.narrative,
                    category: seed.category,
                    quantified: seed.impact !== null,
                    impact: seed.impact,
                },
                occurredAt: seed.occurredAt,
                sensitivity: seed.sensitivity,
            });
            if (!created.success) throw new Error(`createWinFromText: ${created.error}`);

            const confirmed = await confirmWin(created.data.id);
            if (!confirmed.success) throw new Error(`confirmWin: ${confirmed.error}`);
            winIds.push(created.data.id);
        }

        expect(winIds).toHaveLength(40);

        // Confirming enqueues the embed; run it the way production does.
        await drainJobs();
        await assertNoDeadJobs(journey.runId);

        // ADR-8 / rule 3, at the earliest possible hop: the confidential Win is
        // confirmed, and it still has no vector. Sensitivity is a query concern.
        const confidentialId = winIds[CONFIDENTIAL_INDEX];
        await assertNoVector(confidentialId);

        const scope = await getPacketScope({ periodStart: PERIOD_START, periodEnd: PERIOD_END });
        expect(scope.success).toBe(true);
        if (!scope.success) return;
        expect(scope.data.confirmedWins).toBe(40);
        expect(scope.data.withNumbers).toBe(SEEDS.filter((seed) => seed.impact !== null).length);
        expect(scope.data.thin).toBe(false);
        // A paying user may pick any packet type; the free tier's single
        // lifetime brag doc is J4's paywall, not this loop's.
        expect(scope.data.allowedTypes).toContain('performance_review');
    });

    // ═════════════════════════ 2. themes, provenance, and the numeric guard

    test('hop 2 — the packet has 3–5 themes, every sentence traces to a win, and the fabrication does not survive', async () => {
        scriptThemes(4);
        scriptComposition();

        const started = await startPacket({
            periodStart: PERIOD_START,
            periodEnd: PERIOD_END,
            type: 'performance_review',
            audience: 'manager',
        });
        expect(started.success).toBe(true);
        if (!started.success) return;
        packetId = started.data.packetId;

        const content = await awaitPacket(packetId);

        // ── 3–5 themes, and every win accounted for
        expect(content.themes.length).toBeGreaterThanOrEqual(3);
        expect(content.themes.length).toBeLessThanOrEqual(5);
        expect(content.coherenceNote).toBeNull();
        expect(content.unthemedWinIds).toEqual([]);
        expect([...content.appendix.winIds].sort()).toEqual([...winIds].sort());

        // ── nothing exists without a win behind it
        const scopeIds = new Set(winIds);
        const blocks = allBlocks(content).filter((block) => block.text.trim().length > 0);
        expect(blocks.length).toBeGreaterThan(40);
        for (const block of blocks) {
            expect(block.sourceWinIds.length).toBeGreaterThan(0);
            for (const id of block.sourceWinIds) expect(scopeIds.has(id)).toBe(true);
            // Fail closed: the truthfulness pass resolves down, never up, so a
            // `grounded` block here is one it positively tied to a Win.
            expect(block.ground).toBe('grounded');
            expect(block.warning).toBeNull();
        }
        expect(content.warnings).toEqual([]);

        // ── the guard engaged: two calls, the second one corrective
        const composeCalls = mocks().openai.objectCalls.filter((call) =>
            call.system.includes('You write a performance review packet'),
        );
        expect(composeCalls).toHaveLength(2);
        expect(composeCalls[1].prompt).toContain('do not appear in the source material');
        expect(composeCalls[1].prompt).toContain('77%');

        // ── and the fabrication is gone, not softened.
        //
        // Scanned over the prose rather than `JSON.stringify(content)`: cuids
        // are base-36 and one of forty will contain "77" sooner or later, which
        // would turn this into a flake instead of an assertion.
        const prose = [
            ...generatedProse(content),
            ...blocks.map((block) => block.text),
        ].join('\n');
        expect(prose).not.toContain('77');
        expect(prose).not.toContain('2M');
        expect(prose).not.toContain(FABRICATED_OUTCOME);
        expect(prose).not.toContain(FABRICATED_SCOPE);
        // Rejected rather than repaired: theme 0 falls back to the sentence the
        // grouping step produced, which was grounded to begin with.
        expect(content.themes[0].outcome.text).toBe(THEME_OUTCOMES[0]);
        // The invented scope leaves no block at all, not an empty one.
        expect(content.themes[0].impact).toBeNull();
        // A scope the log *does* state survives, so this is a guard and not a
        // blanket ban on impact lines.
        expect(content.themes[2].impact?.text).toBe('12 markets');
        // The blocks that were never in question came through untouched.
        expect(content.summary.text).toBe(CLEAN_SUMMARY);
        expect(content.growth.text).toBe(CLEAN_GROWTH);

        // ── zero fabricated quantities, checked independently of the guard
        for (const text of generatedProse(content)) {
            assertNoFabricatedNumbers(text, SOURCE_TEXT);
        }
        for (const theme of content.themes) {
            for (const bullet of theme.bullets) {
                assertNoFabricatedNumbers(bullet.text, SOURCE_TEXT);
            }
        }

        // ── the truthfulness pass is a visible stage, not plumbing
        const verify = content.progress?.stages.find((stage) => stage.id === 'verify');
        expect(verify?.status).toBe('done');
        expect(verify?.result).toBe('every claim traced to a win');

        // ── the competency section names the framework's own columns
        expect(content.competencies.map((item) => item.key)).toContain('mentorship');

        await assertNoDeadJobs(journey.runId);
    });

    // ══════════════════════════════════════════════════ 3. readiness report

    test('hop 3 — the readiness report calls a competency with no mapped wins absent, with no hedging and no score', async () => {
        const readiness = await getReadiness({
            periodStart: PERIOD_START,
            periodEnd: PERIOD_END,
            targetLevel: 'Staff',
        });
        expect(readiness.success).toBe(true);
        if (!readiness.success) return;
        const report = readiness.data;

        expect(report.winCount).toBe(40);
        expect(report.targetLevelName).toBe('Staff');

        const mentorship = report.competencies.find((item) => item.key === 'mentorship');
        expect(mentorship).toBeDefined();
        expect(mentorship?.coverage).toBe(0);
        expect(mentorship?.quantifiedCount).toBe(0);
        expect(mentorship?.winIds).toEqual([]);
        expect(mentorship?.verdict).toBe('absent');
        expect(mentorship?.dots).toBe(0);
        // No hedging: the sentence states the absence and stops.
        expect(mentorship?.rationale).toBe('No evidence logged for mentorship in this period.');

        // The honest read names the gap and does not soften it.
        const prose = [...report.honestRead, ...report.whatWouldCloseIt].join('\n');
        expect(prose).toContain('Your log has nothing under mentorship for this period.');
        expect(prose).toContain('That is the gap that decides this.');
        expect(report.whatWouldCloseIt).toContain(
            'Any mentorship you are already doing but have not logged.',
        );

        for (const hedge of ['might', 'perhaps', 'possibly', 'somewhat', 'roughly', 'seems', 'on track']) {
            expect(prose.toLowerCase()).not.toContain(hedge);
        }

        // No score out of 100. A number invites optimising the number.
        const serialized = JSON.stringify(report);
        expect(serialized).not.toMatch(/\/\s*100\b/);
        expect(serialized.toLowerCase()).not.toContain('score');

        // Under-claiming is correct: at least one competency really is strong,
        // so `absent` is a verdict the report is willing to distinguish.
        expect(report.competencies.some((item) => item.verdict === 'strong')).toBe(true);
    });

    // ══════════════════════════════════════════════════════════ 4. export

    test('hop 4 — markdown export survives Google Docs, and a confidential win leaves when the user says so', async () => {
        const excluded = await exportPacket(packetId, 'markdown', { includeConfidential: false });
        expect(excluded.success).toBe(true);
        if (!excluded.success) return;
        const body = excluded.data.body;

        // ── the confidential win is gone, end to end
        expect(body).not.toContain(CONFIDENTIAL_TITLE);
        expect(body).not.toContain('single design partner');
        expect(body).not.toContain('🔒');
        // Its theme survives on the strength of its other members, so the
        // absence is an exclusion rather than a collapsed section.
        expect(body).toContain(THEME_TITLES[2]);

        // ── structure Google Docs and Lattice keep: headings, bullets, bold
        expect(body).toContain('# Performance review');
        expect(body).toContain('## Highlights');
        expect(body).toContain('## Appendix — full win list');
        expect(body.split('\n').some((line) => line.startsWith('- '))).toBe(true);
        // ── and nothing they mangle: no tables, no HTML, no reference links
        for (const line of body.split('\n')) {
            expect(line.trimStart().startsWith('|')).toBe(false);
            expect(line).not.toMatch(/^\[[^\]]+\]:\s/);
        }
        expect(body).not.toMatch(/<\/?[a-zA-Z][^>]*>/);
        expect(body).not.toContain('<table');
        expect(body).not.toContain('&nbsp;');

        // ── still zero fabricated quantities after rendering
        expect(body).not.toContain('77%');
        expect(body).not.toContain('2M weekly users');

        // ── the other half of the choice: included, and marked
        const included = await exportPacket(packetId, 'markdown', { includeConfidential: true });
        expect(included.success).toBe(true);
        if (!included.success) return;
        expect(included.data.body).toContain(CONFIDENTIAL_TITLE);
        expect(included.data.body).toContain('🔒');

        // The choice is remembered per packet, in the order it was made.
        const row = await prisma.reviewPacket.findUnique({
            where: { id: packetId },
            select: { exports: true },
        });
        const history = row?.exports as { format: string; includeConfidential: boolean }[];
        expect(history).toHaveLength(2);
        expect(history[0]).toMatchObject({ format: 'markdown', includeConfidential: false });
        expect(history[1]).toMatchObject({ format: 'markdown', includeConfidential: true });
    });

    // ═══════════════════════════════════════════════ 5. regenerate + edits

    test('hop 5 — regenerating preserves the user’s edits by block key', async () => {
        const MY_WORDS =
            'I own the checkout path. It is faster and it fails less, and both are in the log.';

        const edited = await editPacketBlock(packetId, 'summary', MY_WORDS);
        expect(edited.success).toBe(true);
        if (!edited.success) return;
        expect(edited.data.content?.summary.text).toBe(MY_WORDS);
        // An edited block keeps its provenance — the sources belong to the
        // block, not to the sentence.
        expect(edited.data.content?.summary.sourceWinIds).toHaveLength(40);

        scriptThemes(4);
        scriptComposition();

        const again = await regeneratePacket(packetId, { keepEdits: true });
        expect(again.success).toBe(true);
        if (!again.success) return;

        const content = await awaitPacket(packetId);
        expect(content.summary.text).toBe(MY_WORDS);
        // Everything the user did NOT touch was genuinely regenerated.
        expect(content.growth.text).toBe(CLEAN_GROWTH);
        expect(content.themes[0].outcome.text).toBe(THEME_OUTCOMES[0]);
        // Regenerating a packet the user already paid for is not a second packet.
        const quota = await prisma.usageQuota.findFirst({
            where: { userId: journey.userId, action: 'review_packet' },
            select: { used: true },
        });
        expect(quota?.used).toBe(1);

        await assertNoDeadJobs(journey.runId);
    });

    // ════════════════════════════════════════════════════ 6. never six themes

    test('hop 6 — a model that returns six themes never produces a six-theme packet', async () => {
        // Six violates the schema's `.max(5)`. Validation fails, the corrective
        // retry gets the same answer, and PRD 03 §10 says the packet falls back
        // to deterministic category grouping rather than failing.
        scriptThemes(6);
        scriptComposition();

        const again = await regeneratePacket(packetId, { keepEdits: false });
        expect(again.success).toBe(true);
        if (!again.success) return;

        const content = await awaitPacket(packetId);

        expect(content.themes.length).toBeLessThanOrEqual(5);
        expect(content.themes.length).toBeGreaterThanOrEqual(3);
        // The wins span seven categories, which genuinely does not group into
        // five. The packet says so rather than inventing coherence.
        expect(content.coherenceNote).toBe(
            'Your work this period was spread across 7 areas — that can read as unfocused. ' +
                'Consider leading with your three strongest.',
        );
        expect(content.unthemedWinIds.length).toBeGreaterThan(0);
        // Every win is still reachable, themed or not.
        expect(
            new Set([
                ...content.themes.flatMap((theme) => theme.winIds),
                ...content.unthemedWinIds,
            ]).size,
        ).toBe(40);

        // Falling back must not smuggle a number in either.
        for (const text of generatedProse(content)) {
            assertNoFabricatedNumbers(text, SOURCE_TEXT);
        }

        // "start fresh" really did discard the edit.
        expect(content.summary.text).toBe(CLEAN_SUMMARY);
    });

    // ══════════════════════════════════════════════════════════ teardown

    test('hop 7 — the journey leaves nothing behind', async () => {
        await assertNoDeadJobs(journey.runId);

        // `purge` matches `Job` rows on the run id, and an `embed_win` key is
        // `embed_win:<winId>:<updatedAt>` — no run id in it. So these are swept
        // here, by the ids this journey created, rather than left to pile up.
        const byWin = { OR: winIds.map((id) => ({ dedupeKey: { contains: id } })) };
        expect(await prisma.job.count({ where: { ...byWin, status: 'dead' } })).toBe(0);
        await prisma.job.deleteMany({ where: byWin });

        await releaseFlag(journey.userId);
        await purge(journey.runId);
        expect(await assertPurged(journey.runId)).toEqual({});
    });
});


afterAll(async () => {
    await restoreFlags(__flagSnapshot);
});
