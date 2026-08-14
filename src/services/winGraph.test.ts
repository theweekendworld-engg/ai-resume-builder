/**
 * THESIS TEST 1 (PRD 08 §10, ADR-10, CLAUDE.md rule 5).
 *
 *   Confirming a Win creates exactly one Evidence(confirmedByUser=true) and
 *   exactly one ClaimLink(claimType='win', groundState='grounded') per source
 *   artifact — and un-confirming reverses ALL of it, including the Qdrant point.
 *
 * That single transaction is simultaneously the retention loop and the moat.
 * If this file goes red, the product thesis is broken, not the test.
 *
 * Runs against the real local Postgres and the real local Qdrant. Only the
 * embedding vector is faked (no model call in a unit test).
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import {
    EvidenceKind,
    GroundState,
    WinCategory,
    WinSensitivity,
    WinSource,
    WinStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    WIN_CLAIM_TYPE,
    EVIDENCE_KIND_BY_SOURCE,
    UNAVAILABLE_SOURCE_PREFIX,
    archiveWin,
    bulkConfirm,
    confirmWin,
    decodeWinCursor,
    deleteWin,
    describeEvidence,
    dismissWin,
    encodeWinCursor,
    getLogSummary,
    getWinView,
    historyCutoff,
    listEmployers,
    listWins,
    parseExperienceDate,
    resolveEmployerIdFrom,
    setWinImpact,
    unarchiveWin,
    unconfirmWin,
    updateWin,
    userSourceRef,
    WIN_HISTORY_DAYS_BY_TIER,
} from '@/services/winGraph';
import { embedWinHandler, __testing as embedTesting } from '@/lib/jobs/handlers/embedWin';
import {
    cleanupTestUser,
    fakeEmbedding,
    fakeJobContext,
    makeExperience,
    makeWin,
    newTestUserId,
    qdrantPointsForUser,
} from '@/services/winFixtures.test-utils';

const users: string[] = [];

function user(label: string): string {
    const id = newTestUserId(label);
    users.push(id);
    return id;
}

beforeAll(() => {
    embedTesting.setEmbedder(async (text: string) => fakeEmbedding(text));
});

afterAll(async () => {
    embedTesting.reset();
});

afterEach(async () => {
    while (users.length > 0) {
        const id = users.pop();
        if (id) await cleanupTestUser(id);
    }
});

async function runEmbedJob(winId: string) {
    return embedWinHandler({ winId }, fakeJobContext());
}

// ═══════════════════════════════════════════════════ the round trip

describe('THESIS 1 — confirm writes the evidence pair; un-confirm reverses all of it', () => {
    test('confirm creates exactly one Evidence + one ClaimLink per source artifact', async () => {
        const userId = user('confirm');
        const win = await makeWin({ userId, source: WinSource.github, sourceRef: 'https://github.com/acme/api/pull/482' });

        const result = await confirmWin({ userId, winId: win.id });
        expect(result.success).toBe(true);

        const evidence = await prisma.evidence.findMany({ where: { userId } });
        expect(evidence).toHaveLength(1);
        expect(evidence[0].confirmedByUser).toBe(true);
        expect(evidence[0].kind).toBe(EvidenceKind.repo);
        expect(evidence[0].sourceRef).toBe('https://github.com/acme/api/pull/482');
        expect(evidence[0].excerpt.length).toBeGreaterThan(0);

        const links = await prisma.claimLink.findMany({ where: { userId } });
        expect(links).toHaveLength(1);
        expect(links[0].claimType).toBe(WIN_CLAIM_TYPE);
        expect(links[0].claimRefId).toBe(win.id);
        expect(links[0].evidenceId).toBe(evidence[0].id);
        expect(links[0].groundState).toBe(GroundState.grounded);

        const stored = await prisma.win.findUniqueOrThrow({ where: { id: win.id } });
        expect(stored.status).toBe(WinStatus.confirmed);
        expect(stored.confirmedAt).not.toBeNull();

        if (result.success) {
            expect(result.data.groundState).toBe('grounded');
            expect(result.data.evidence).toHaveLength(1);
        }
    });

    test('confirm is idempotent — a second confirm does not duplicate the pair', async () => {
        const userId = user('idem');
        const win = await makeWin({ userId });

        await confirmWin({ userId, winId: win.id });
        const first = await prisma.win.findUniqueOrThrow({ where: { id: win.id } });
        await confirmWin({ userId, winId: win.id });

        expect(await prisma.evidence.count({ where: { userId } })).toBe(1);
        expect(await prisma.claimLink.count({ where: { userId } })).toBe(1);

        const second = await prisma.win.findUniqueOrThrow({ where: { id: win.id } });
        expect(second.confirmedAt?.toISOString()).toBe(first.confirmedAt?.toISOString());
    });

    test('un-confirm removes the Evidence, the ClaimLink AND the Qdrant point', async () => {
        const userId = user('unconfirm');
        const win = await makeWin({ userId });

        await confirmWin({ userId, winId: win.id });
        await runEmbedJob(win.id);

        const embedded = await prisma.win.findUniqueOrThrow({ where: { id: win.id } });
        expect(embedded.embedded).toBe(true);
        expect(embedded.qdrantPointId).not.toBeNull();

        const before = await qdrantPointsForUser(userId);
        expect(before).toHaveLength(1);
        expect(before[0].id).toBe(embedded.qdrantPointId ?? '');

        const result = await unconfirmWin({ userId, winId: win.id });
        expect(result.success).toBe(true);

        // Postgres side reversed …
        expect(await prisma.evidence.count({ where: { userId } })).toBe(0);
        expect(await prisma.claimLink.count({ where: { userId } })).toBe(0);
        const after = await prisma.win.findUniqueOrThrow({ where: { id: win.id } });
        expect(after.status).toBe(WinStatus.draft);
        expect(after.confirmedAt).toBeNull();
        expect(after.embedded).toBe(false);
        expect(after.qdrantPointId).toBeNull();

        // … and the vector side, synchronously, before the call returned.
        expect(await qdrantPointsForUser(userId)).toHaveLength(0);
    });

    test('confirm → un-confirm → confirm still yields exactly one pair', async () => {
        const userId = user('cycle');
        const win = await makeWin({ userId });

        await confirmWin({ userId, winId: win.id });
        await unconfirmWin({ userId, winId: win.id });
        await confirmWin({ userId, winId: win.id });

        expect(await prisma.evidence.count({ where: { userId } })).toBe(1);
        expect(await prisma.claimLink.count({ where: { userId } })).toBe(1);
    });

    test('un-confirming a win that was never confirmed is a no-op, not an error', async () => {
        const userId = user('noop-unconfirm');
        const win = await makeWin({ userId });
        const result = await unconfirmWin({ userId, winId: win.id });
        expect(result.success).toBe(true);
        expect(await prisma.evidence.count({ where: { userId } })).toBe(0);
    });

    test('every WinSource maps to an EvidenceKind (PRD 01 §7.1)', () => {
        expect(EVIDENCE_KIND_BY_SOURCE).toEqual({
            github: EvidenceKind.repo,
            manual: EvidenceKind.metric_confirmed,
            ambient: EvidenceKind.metric_confirmed,
            calendar: EvidenceKind.document,
            linear: EvidenceKind.document,
            jira: EvidenceKind.document,
            backfill: EvidenceKind.interview_assertion,
            import: EvidenceKind.import,
        });
        for (const source of Object.values(WinSource)) {
            expect(EVIDENCE_KIND_BY_SOURCE[source]).toBeDefined();
        }
    });

    test('confirm enqueues the embed job only for shareable wins', async () => {
        const shareableUser = user('enqueue-shareable');
        const confidentialUser = user('enqueue-confidential');

        const shareable = await makeWin({ userId: shareableUser });
        const confidential = await makeWin({
            userId: confidentialUser,
            sensitivity: WinSensitivity.confidential,
        });

        await confirmWin({ userId: shareableUser, winId: shareable.id });
        await confirmWin({ userId: confidentialUser, winId: confidential.id });

        const shareableJobs = await prisma.job.count({
            where: { kind: 'embed_win', dedupeKey: { startsWith: `embed-win:${shareable.id}` } },
        });
        const confidentialJobs = await prisma.job.count({
            where: { kind: 'embed_win', dedupeKey: { startsWith: `embed-win:${confidential.id}` } },
        });

        expect(shareableJobs).toBe(1);
        expect(confidentialJobs).toBe(0);
    });
});

// ═══════════════════════════════════════════════════ sensitivity downgrade

describe('sensitivity downgrade (PRD 01 §12)', () => {
    test('downgrading an embedded win deletes the Qdrant point synchronously', async () => {
        const userId = user('downgrade');
        const win = await makeWin({ userId });

        await confirmWin({ userId, winId: win.id });
        await runEmbedJob(win.id);
        expect(await qdrantPointsForUser(userId)).toHaveLength(1);

        const result = await updateWin({
            userId,
            winId: win.id,
            patch: { sensitivity: WinSensitivity.confidential },
        });
        expect(result.success).toBe(true);

        // No job, no eventual consistency: gone by the time the call returned.
        expect(await qdrantPointsForUser(userId)).toHaveLength(0);
        const after = await prisma.win.findUniqueOrThrow({ where: { id: win.id } });
        expect(after.embedded).toBe(false);
        expect(after.qdrantPointId).toBeNull();
    });

    test('re-upgrading to shareable re-enqueues an embed', async () => {
        const userId = user('upgrade');
        const win = await makeWin({ userId, sensitivity: WinSensitivity.internal_only });
        await confirmWin({ userId, winId: win.id });

        await updateWin({ userId, winId: win.id, patch: { sensitivity: WinSensitivity.shareable } });

        const jobs = await prisma.job.count({
            where: { kind: 'embed_win', dedupeKey: { startsWith: `embed-win:${win.id}` } },
        });
        expect(jobs).toBeGreaterThan(0);
    });
});

// ═══════════════════════════════════════════════════ employer attribution

describe('employer attribution resolves by date, never guesses (PRD 01 §4.5, §12)', () => {
    test('picks the experience whose range contains occurredAt', async () => {
        const userId = user('employer');
        const acme = await makeExperience({ userId, company: 'Acme', startDate: '2025-01-01', endDate: '2026-12-31' });
        await makeExperience({ userId, company: 'Older', startDate: '2020-01-01', endDate: '2024-12-31' });

        const win = await makeWin({ userId, occurredAt: new Date('2026-07-14T00:00:00.000Z') });
        expect(win.employerId).toBe(acme.id);
    });

    test('an open-ended current role covers dates up to now', () => {
        const resolved = resolveEmployerIdFrom(
            [{ id: 'exp-current', startDate: '2025-01', endDate: '', current: true }],
            new Date('2026-07-14T00:00:00.000Z'),
        );
        expect(resolved).toBe('exp-current');
    });

    test('overlapping roles resolve to null — we ask, we do not guess', () => {
        const resolved = resolveEmployerIdFrom(
            [
                { id: 'ft', startDate: '2025-01-01', endDate: '2026-12-31', current: false },
                { id: 'contract', startDate: '2026-01-01', endDate: '2026-09-01', current: false },
            ],
            new Date('2026-07-14T00:00:00.000Z'),
        );
        expect(resolved).toBeNull();
    });

    test('a date before any experience resolves to null and never blocks the save', async () => {
        const userId = user('employer-gap');
        await makeExperience({ userId, company: 'Acme', startDate: '2025-01-01', endDate: '2026-12-31' });
        const win = await makeWin({ userId, occurredAt: new Date('2019-03-01T00:00:00.000Z') });
        expect(win.employerId).toBeNull();
    });

    test('parses the loose date shapes UserExperience actually stores', () => {
        expect(parseExperienceDate('2025-03', 'start')?.toISOString()).toBe('2025-03-01T00:00:00.000Z');
        expect(parseExperienceDate('2025-03-17', 'start')?.toISOString()).toBe('2025-03-17T00:00:00.000Z');
        expect(parseExperienceDate('2025', 'start')?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
        expect(parseExperienceDate('2025-03', 'end')?.toISOString()).toBe('2025-03-31T23:59:59.999Z');
        expect(parseExperienceDate('', 'end')).toBeNull();
        expect(parseExperienceDate('Present', 'end')).toBeNull();
    });
});

// ═══════════════════════════════════════════════════ list + summary

describe('listWins', () => {
    test('cursor pagination walks (occurredAt, id) without gaps or repeats', async () => {
        const userId = user('paging');
        const made: string[] = [];
        const base = Date.now() - 30 * 86_400_000;
        for (let index = 0; index < 7; index += 1) {
            const win = await makeWin({
                userId,
                title: `Win ${index}`,
                occurredAt: new Date(base + index * 86_400_000),
            });
            made.push(win.id);
        }

        const seen: string[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 10; page += 1) {
            const result = await listWins({ userId, filters: {}, cursor, limit: 3 });
            expect(result.success).toBe(true);
            if (!result.success) break;
            seen.push(...result.data.items.map((item) => item.id));
            expect(result.data.total).toBe(7);
            if (!result.data.nextCursor) break;
            cursor = result.data.nextCursor;
        }

        expect(seen).toHaveLength(7);
        expect(new Set(seen).size).toBe(7);
        expect(new Set(seen)).toEqual(new Set(made));
        // newest first
        expect(seen[0]).toBe(made[6]);
    });

    test('cursor round-trips and rejects garbage', () => {
        const occurredAt = new Date('2026-07-14T10:11:12.000Z');
        const encoded = encodeWinCursor({ occurredAt, id: 'abc' });
        expect(decodeWinCursor(encoded)).toEqual({ occurredAt, id: 'abc' });
        expect(decodeWinCursor('not-a-cursor')).toBeNull();
    });

    test('filters by status, category, employer, range and search', async () => {
        const userId = user('filters');
        const acme = await makeExperience({ userId, company: 'Acme', startDate: '2020-01-01', endDate: '', current: true });
        const now = Date.now();
        const shipped = await makeWin({
            userId,
            title: 'Shipped the webhook retry queue',
            category: WinCategory.shipped,
            occurredAt: new Date(now - 10 * 86_400_000),
        });
        await makeWin({
            userId,
            title: 'Mentored a junior through their first oncall',
            category: WinCategory.grew,
            occurredAt: new Date(now - 30 * 86_400_000),
        });
        await confirmWin({ userId, winId: shipped.id });

        const byStatus = await listWins({ userId, filters: { status: [WinStatus.confirmed] } });
        expect(byStatus.success && byStatus.data.items.map((item) => item.id)).toEqual([shipped.id]);

        const byCategory = await listWins({ userId, filters: { category: [WinCategory.grew] } });
        expect(byCategory.success && byCategory.data.total).toBe(1);

        const byEmployer = await listWins({ userId, filters: { employerId: acme.id } });
        expect(byEmployer.success && byEmployer.data.total).toBe(2);

        const byRange = await listWins({
            userId,
            filters: { from: new Date(now - 15 * 86_400_000), to: new Date(now - 5 * 86_400_000) },
        });
        expect(byRange.success && byRange.data.total).toBe(1);

        const bySearch = await listWins({ userId, filters: { search: 'oncall' } });
        expect(bySearch.success && bySearch.data.total).toBe(1);
    });

    test('free-plan history limit hides older wins but never deletes them', async () => {
        const userId = user('history');
        const now = Date.now();
        const recent = await makeWin({ userId, title: 'Recent', occurredAt: new Date(now - 10 * 86_400_000) });
        const old = await makeWin({ userId, title: 'Ancient', occurredAt: new Date(now - 400 * 86_400_000) });

        const page = await listWins({ userId, filters: {} });
        expect(page.success).toBe(true);
        if (!page.success) return;
        expect(page.data.items.map((item) => item.id)).toEqual([recent.id]);
        expect(page.data.hiddenByPlan).toBe(1);

        // Never deleted — the row is still there and comes back when asked for.
        const unlocked = await listWins({ userId, filters: { includeBeyondHistoryLimit: true } });
        expect(unlocked.success && unlocked.data.items.map((item) => item.id).sort()).toEqual(
            [recent.id, old.id].sort(),
        );
        expect(unlocked.success && unlocked.data.hiddenByPlan).toBe(0);
        expect(await prisma.win.count({ where: { userId } })).toBe(2);
    });

    test('the free history window is 90 rolling days', () => {
        expect(WIN_HISTORY_DAYS_BY_TIER.free).toBe(90);
        const now = new Date('2026-08-01T00:00:00.000Z');
        expect(historyCutoff('free', now)?.toISOString()).toBe('2026-05-03T00:00:00.000Z');
        expect(historyCutoff('pro', now)).toBeNull();
    });
});

describe('dismiss / bulkConfirm / summary', () => {
    test('dismiss retains the row and records the reason', async () => {
        const userId = user('dismiss');
        const win = await makeWin({ userId });
        const result = await dismissWin({ userId, winId: win.id, reason: 'noise' });
        expect(result.success).toBe(true);

        const stored = await prisma.win.findUniqueOrThrow({ where: { id: win.id } });
        expect(stored.status).toBe(WinStatus.dismissed);
        expect(stored.dismissedReason).toBe('noise');
    });

    test('bulkConfirm reports partial success', async () => {
        const userId = user('bulk');
        const a = await makeWin({ userId, title: 'A' });
        const b = await makeWin({ userId, title: 'B' });

        const result = await bulkConfirm({ userId, winIds: [a.id, b.id, 'does-not-exist'] });
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.ok.sort()).toEqual([a.id, b.id].sort());
        expect(result.data.failed).toHaveLength(1);
        expect(result.data.failed[0].winId).toBe('does-not-exist');
        expect(await prisma.claimLink.count({ where: { userId } })).toBe(2);
    });

    test('summary counts, streak, mix and gaps', async () => {
        const userId = user('summary');
        const now = new Date();
        const thisWeek = await makeWin({ userId, title: 'This week', occurredAt: now, category: WinCategory.shipped });
        const lastWeek = await makeWin({
            userId,
            title: 'Last week',
            occurredAt: new Date(now.getTime() - 7 * 86_400_000),
            category: WinCategory.shipped,
        });
        await makeWin({ userId, title: 'A draft', occurredAt: now, category: WinCategory.led });

        await confirmWin({ userId, winId: thisWeek.id });
        await confirmWin({ userId, winId: lastWeek.id });

        const result = await getLogSummary({ userId });
        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.data.totalConfirmed).toBe(2);
        expect(result.data.withEvidence).toBe(2);
        expect(result.data.draftCount).toBe(1);
        expect(result.data.streakWeeks).toBe(2);
        expect(result.data.categoryMix.find((entry) => entry.category === WinCategory.shipped)?.count).toBe(2);
        expect(result.data.gaps).toContain(WinCategory.influenced);
        expect(result.data.recordStart?.getTime()).toBe(
            new Date(lastWeek.occurredAt).getTime(),
        );
    });
});

// ═══════════════════════════════════════════════════ evidence presentation

describe('evidence chips are derived on the server, not parsed in the client', () => {
    test('GitHub URLs become "PR #482" · "patronus/api"', () => {
        expect(describeEvidence({ kind: EvidenceKind.repo, sourceRef: 'https://github.com/patronus/api/pull/482' }))
            .toEqual({ label: 'PR #482', detail: 'patronus/api', url: 'https://github.com/patronus/api/pull/482', available: true });

        expect(describeEvidence({ kind: EvidenceKind.repo, sourceRef: 'https://github.com/patronus/api/issues/17' }))
            .toMatchObject({ label: 'Issue #17', detail: 'patronus/api' });

        expect(describeEvidence({ kind: EvidenceKind.repo, sourceRef: 'https://github.com/patronus/api/commit/9f3a1b2c4d5e' }))
            .toMatchObject({ label: 'Commit 9f3a1b2', detail: 'patronus/api' });

        expect(describeEvidence({ kind: EvidenceKind.repo, sourceRef: 'https://github.com/patronus/api' }))
            .toMatchObject({ label: 'api', detail: 'patronus' });
    });

    test('a non-GitHub URL still gets a usable label', () => {
        expect(describeEvidence({ kind: EvidenceKind.document, sourceRef: 'https://docs.google.com/document/d/abc' }))
            .toMatchObject({ label: 'docs.google.com', detail: null });

        expect(describeEvidence({ kind: EvidenceKind.document, sourceRef: 'https://files.acme.io/reports/q3-latency.pdf' }))
            .toMatchObject({ label: 'q3-latency.pdf', detail: 'files.acme.io' });
    });

    test('a URL-less source is labelled without pretending it has an address', () => {
        const synthetic = describeEvidence({ kind: EvidenceKind.metric_confirmed, sourceRef: 'win:abc123' });
        expect(synthetic).toEqual({ label: 'You logged this', detail: null, url: null, available: true });

        const interview = describeEvidence({ kind: EvidenceKind.interview_assertion, sourceRef: 'win:abc123' });
        expect(interview.label).toBe('You said this');

        // An opaque upstream id: kind copy up front, the id as the detail line.
        const calendar = describeEvidence({ kind: EvidenceKind.document, sourceRef: 'gcal:evt_9182' });
        expect(calendar).toEqual({ label: 'Document', detail: 'gcal:evt_9182', url: null, available: true });
    });

    test('available:false is distinct from url:null — the excerpt survives either way', async () => {
        const userId = user('gone');
        const win = await makeWin({
            userId,
            source: WinSource.github,
            sourceRef: 'https://github.com/patronus/api/pull/482',
        });
        await confirmWin({ userId, winId: win.id });

        // What the connector reconcile will do when the repo disappears.
        await prisma.evidence.updateMany({
            where: { userId },
            data: { sourceRef: `${UNAVAILABLE_SOURCE_PREFIX}https://github.com/patronus/api/pull/482` },
        });

        const view = await getWinView(userId, win.id);
        expect(view.success).toBe(true);
        if (!view.success) return;

        const evidence = view.data.evidence[0];
        expect(evidence.available).toBe(false);
        // Still addressable-looking, still labelled, and the snippet is intact.
        expect(evidence.url).toBe('https://github.com/patronus/api/pull/482');
        expect(evidence.label).toBe('PR #482');
        expect(evidence.excerpt.length).toBeGreaterThan(0);
    });

    test('a live win view carries label, detail and available', async () => {
        const userId = user('chips');
        const win = await makeWin({ userId });
        const confirmed = await confirmWin({ userId, winId: win.id });
        expect(confirmed.success).toBe(true);
        if (!confirmed.success) return;

        expect(confirmed.data.evidence[0]).toMatchObject({
            label: 'You logged this',
            detail: null,
            url: null,
            available: true,
            confirmedByUser: true,
        });
    });
});

// ═══════════════════════════════════════════════════ chip-captured evidence

describe('confirm with evidence typed into the GroundChip', () => {
    test('a typed source becomes a second Evidence(confirmedByUser=true) + ClaimLink', async () => {
        const userId = user('chip-evidence');
        const win = await makeWin({ userId });

        const result = await confirmWin({
            userId,
            winId: win.id,
            userSource: 'The Grafana dashboard screenshot from the incident review',
        });
        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.data.evidence).toHaveLength(2);
        const typed = result.data.evidence.find((entry) =>
            entry.excerpt.startsWith('The Grafana dashboard'),
        );
        expect(typed).toBeDefined();
        expect(typed?.confirmedByUser).toBe(true);
        expect(result.data.groundState).toBe('grounded');

        const links = await prisma.claimLink.findMany({ where: { userId } });
        expect(links).toHaveLength(2);
        expect(links.every((link) => link.groundState === GroundState.grounded)).toBe(true);

        const stored = await prisma.evidence.findFirst({
            where: { userId, sourceRef: userSourceRef(win.id) },
        });
        expect(stored?.kind).toBe(EvidenceKind.metric_confirmed);
    });

    test('a pasted link is stored as addressable url evidence', async () => {
        const userId = user('chip-url');
        const win = await makeWin({ userId });

        const result = await confirmWin({
            userId,
            winId: win.id,
            userSource: 'https://github.com/patronus/api/pull/482',
        });
        expect(result.success).toBe(true);
        if (!result.success) return;

        const linked = result.data.evidence.find((entry) => entry.kind === 'url');
        expect(linked).toMatchObject({
            label: 'PR #482',
            detail: 'patronus/api',
            url: 'https://github.com/patronus/api/pull/482',
            available: true,
        });
    });

    test('confirming twice with the same typed source does not duplicate it', async () => {
        const userId = user('chip-idem');
        const win = await makeWin({ userId });
        await confirmWin({ userId, winId: win.id, userSource: 'the incident ticket' });
        await confirmWin({ userId, winId: win.id, userSource: 'the incident ticket' });

        expect(await prisma.evidence.count({ where: { userId } })).toBe(2);
        expect(await prisma.claimLink.count({ where: { userId } })).toBe(2);
    });

    test('un-confirm still reverses everything, including chip evidence', async () => {
        const userId = user('chip-reverse');
        const win = await makeWin({ userId });
        await confirmWin({ userId, winId: win.id, userSource: 'the incident ticket' });
        expect(await prisma.evidence.count({ where: { userId } })).toBe(2);

        await unconfirmWin({ userId, winId: win.id });
        expect(await prisma.evidence.count({ where: { userId } })).toBe(0);
        expect(await prisma.claimLink.count({ where: { userId } })).toBe(0);
    });
});

// ═══════════════════════════════════════════════════ archive / delete

describe('archive, unarchive, delete', () => {
    test('archive hides from the default view, keeps the evidence, drops the vector', async () => {
        const userId = user('archive');
        const win = await makeWin({ userId });
        await confirmWin({ userId, winId: win.id });
        await runEmbedJob(win.id);
        expect(await qdrantPointsForUser(userId)).toHaveLength(1);

        const result = await archiveWin({ userId, winId: win.id });
        expect(result.success).toBe(true);

        const stored = await prisma.win.findUniqueOrThrow({ where: { id: win.id } });
        expect(stored.status).toBe(WinStatus.archived);
        expect(stored.qdrantPointId).toBeNull();
        // ADR-8: the SQL filter admits only `confirmed`, so the vector must go too.
        expect(await qdrantPointsForUser(userId)).toHaveLength(0);

        // Still in packets and exports — the evidence is untouched.
        expect(await prisma.evidence.count({ where: { userId } })).toBe(1);
        expect(await prisma.claimLink.count({ where: { userId } })).toBe(1);

        const defaultView = await listWins({ userId, filters: {} });
        expect(defaultView.success && defaultView.data.total).toBe(0);

        const explicit = await listWins({ userId, filters: { status: [WinStatus.archived] } });
        expect(explicit.success && explicit.data.total).toBe(1);
    });

    test('unarchive restores confirmed when the evidence is still grounded', async () => {
        const userId = user('unarchive');
        const win = await makeWin({ userId });
        await confirmWin({ userId, winId: win.id });
        await archiveWin({ userId, winId: win.id });

        const result = await unarchiveWin({ userId, winId: win.id });
        expect(result.success && result.data.status).toBe(WinStatus.confirmed);
        expect(result.success && result.data.groundState).toBe('grounded');
    });

    test('unarchive restores draft when there was never any evidence', async () => {
        const userId = user('unarchive-draft');
        const win = await makeWin({ userId });
        await archiveWin({ userId, winId: win.id });

        const result = await unarchiveWin({ userId, winId: win.id });
        expect(result.success && result.data.status).toBe(WinStatus.draft);
    });

    test('archive is idempotent', async () => {
        const userId = user('archive-idem');
        const win = await makeWin({ userId });
        await archiveWin({ userId, winId: win.id });
        const second = await archiveWin({ userId, winId: win.id });
        expect(second.success && second.data.status).toBe(WinStatus.archived);
    });

    test('delete removes the win, its evidence, its links, its metric and its point', async () => {
        const userId = user('delete');
        const win = await makeWin({
            userId,
            impact: { metric: 'checkout p95 latency', baseline: '800ms', result: '180ms' },
        });
        await confirmWin({ userId, winId: win.id });
        await runEmbedJob(win.id);
        expect(await qdrantPointsForUser(userId)).toHaveLength(1);

        const result = await deleteWin({ userId, winId: win.id });
        expect(result.success).toBe(true);

        expect(await prisma.win.count({ where: { id: win.id } })).toBe(0);
        expect(await prisma.evidence.count({ where: { userId } })).toBe(0);
        expect(await prisma.claimLink.count({ where: { userId } })).toBe(0);
        expect(await prisma.impactMetric.count({ where: { userId } })).toBe(0);
        expect(await qdrantPointsForUser(userId)).toHaveLength(0);
    });

    test('delete is distinct from dismiss — a dismissed win is retained', async () => {
        const userId = user('delete-vs-dismiss');
        const dismissed = await makeWin({ userId, title: 'Dependabot bump' });
        const deleted = await makeWin({ userId, title: 'Typed by mistake' });

        await dismissWin({ userId, winId: dismissed.id, reason: 'noise' });
        await deleteWin({ userId, winId: deleted.id });

        expect(await prisma.win.count({ where: { id: dismissed.id } })).toBe(1);
        expect(await prisma.win.count({ where: { id: deleted.id } })).toBe(0);
    });

    test('another user cannot archive or delete your win', async () => {
        const owner = user('del-owner');
        const stranger = user('del-stranger');
        const win = await makeWin({ userId: owner });

        expect((await archiveWin({ userId: stranger, winId: win.id })).success).toBe(false);
        expect((await deleteWin({ userId: stranger, winId: win.id })).success).toBe(false);
        expect(await prisma.win.count({ where: { id: win.id } })).toBe(1);
    });
});

// ═══════════════════════════════════════════════════ impact + employers

describe('setWinImpact', () => {
    test('writes the metric, links it, and clears the quantify prompt', async () => {
        const userId = user('impact');
        const win = await makeWin({ userId });

        const before = await getWinView(userId, win.id);
        expect(before.success && before.data.impact).toBeNull();
        expect(before.success && before.data.quantifyPrompt).not.toBeNull();

        const result = await setWinImpact({
            userId,
            winId: win.id,
            impact: { metric: 'checkout p95 latency', baseline: '800ms', result: '180ms' },
        });
        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.data.impact).toMatchObject({
            metric: 'checkout p95 latency',
            baseline: '800ms',
            result: '180ms',
        });
        expect(result.data.quantifyPrompt).toBeNull();

        const stored = await prisma.win.findUniqueOrThrow({ where: { id: win.id } });
        expect(stored.impactMetricId).toBe(result.data.impact?.id ?? '');
    });

    test('answering twice replaces the metric instead of stacking a second one', async () => {
        const userId = user('impact-twice');
        const win = await makeWin({ userId });

        await setWinImpact({ userId, winId: win.id, impact: { metric: 'latency', result: '180ms' } });
        await setWinImpact({ userId, winId: win.id, impact: { metric: 'latency', result: '150ms' } });

        expect(await prisma.impactMetric.count({ where: { userId } })).toBe(1);
        const view = await getWinView(userId, win.id);
        expect(view.success && view.data.impact?.result).toBe('150ms');
    });
});

describe('listEmployers', () => {
    test('current roles first, then most recent', async () => {
        const userId = user('employers');
        const old = await makeExperience({ userId, company: 'Older', role: 'Junior', startDate: '2018-01', endDate: '2020-06' });
        const middle = await makeExperience({ userId, company: 'Middle', role: 'Senior', startDate: '2020-07', endDate: '2024-12' });
        const now = await makeExperience({ userId, company: 'Acme', role: 'Staff', startDate: '2025-01', endDate: '', current: true });

        const result = await listEmployers({ userId });
        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.data.map((entry) => entry.id)).toEqual([now.id, middle.id, old.id]);
        expect(result.data[0]).toEqual({ id: now.id, name: 'Acme', role: 'Staff', current: true });
        expect(result.data[1].current).toBe(false);
    });

    test('an empty history is an empty list, not an error', async () => {
        const userId = user('employers-empty');
        const result = await listEmployers({ userId });
        expect(result.success && result.data).toEqual([]);
    });
});

describe('cross-user isolation', () => {
    test('a win belonging to another user is never reachable', async () => {
        const owner = user('owner');
        const stranger = user('stranger');
        const win = await makeWin({ userId: owner });

        const confirmed = await confirmWin({ userId: stranger, winId: win.id });
        expect(confirmed.success).toBe(false);
        expect(await prisma.evidence.count({ where: { userId: stranger } })).toBe(0);

        const page = await listWins({ userId: stranger, filters: {} });
        expect(page.success && page.data.total).toBe(0);
    });
});
