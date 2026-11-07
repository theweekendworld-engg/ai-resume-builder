/**
 * The job watch end to end, against the local Postgres. The matcher and the
 * outbound channels are replaced at their seams; everything else is real: the
 * record, the shortlist, the stored posting read, the gate, the JobMatch
 * ledger, claim-then-send, tracking and dismissal.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Channel, JobMatchStatus, WinCategory, WinSensitivity, WinSource, WinStatus } from '@prisma/client';

import { __testing as aiTesting } from '@/lib/ai/structured';
import { restoreFlags, setFlagForTest, snapshotFlags, type FlagSnapshot } from '@/lib/flags.test-utils';
import { prisma } from '@/lib/prisma';
import type { MatchAi } from '@/lib/scout/sections/fit';
import { parsedKeyFor } from '@/lib/watch/score';
import { dismissMatch, listMatches, RECHECK_MIN_SCORE, runWatchForUser, sendMorningAlert, trackMatch, type AlertSenders } from './jobWatch';
import { __testing as providerTesting } from '@/lib/research/providers';
import { __testing as cacheTesting, createMemoryStore } from '@/lib/research/cache';

const RUN = `itest-watch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const USER = `${RUN}-user`;
const NOW = new Date();
let flags: FlagSnapshot;
let sourceId = '';
const postingIds: Record<'strong' | 'weak' | 'offRole', string> = { strong: '', weak: '', offRole: '' };

/** Every message the fake channels were asked to send. */
let sent: Array<{ channel: string; text: string }> = [];
const senders: AlertSenders = {
    async telegram(_chatId, text) { sent.push({ channel: 'telegram', text }); return true; },
    async whatsapp(_to, text) { sent.push({ channel: 'whatsapp', text }); return true; },
    async email(_userId, _to, items) { sent.push({ channel: 'email', text: items.map((i) => i.title).join(',') }); return true; },
};

/**
 * A matcher that reads its own prompt the way the model would: for each
 * numbered requirement, the first evidence line sharing a keyword with it.
 * Requirements with no keyword in the record get null.
 */
const KEYWORDS = ['go', 'postgresql', 'kafka', 'distributed', 'clearance', 'mainframe', 'cobol', 'rust'];
const matcher: MatchAi = (async (opts: { prompt: string }) => {
    const [reqBlock, evBlock] = opts.prompt.split('\n\nEVIDENCE:\n');
    const requirements = reqBlock.replace('REQUIREMENTS:\n', '').split('\n');
    const evidence = evBlock.split('\n');
    const judgements = requirements.map((line, index) => {
        const words = line.toLowerCase().split(/[^a-z]+/);
        const key = KEYWORDS.find((keyword) => words.includes(keyword));
        const at = key ? evidence.findIndex((ev) => ev.toLowerCase().split(/[^a-z]+/).includes(key)) : -1;
        return { requirement: index + 1, soft: false, evidence: at >= 0 ? at + 1 : null, strength: at >= 0 ? 'direct' as const : null };
    });
    return { data: { judgements }, usage: {} as never, degraded: false, guardViolations: [] };
}) as unknown as MatchAi;

const failingMatcher: MatchAi = (async () => { throw new Error('model down'); }) as unknown as MatchAi;

const LONG = ' We build the payment rails used by millions of merchants across India, and this team owns the ledger, settlement and reconciliation services end to end.';

function brief(musts: string[], skills: string[]) {
    return {
        role: 'Backend Engineer', company: 'Acme Pay', seniority: 'senior', domain: 'payments',
        requirements: musts.map((text, i) => ({ id: `r${i + 1}`, text, kind: 'must', category: 'skill', satisfiedByTenure: false })),
        skills,
        responsibilities: [],
    };
}

async function makePosting(key: keyof typeof postingIds, title: string, description: string, parsed: object | null) {
    const row = await prisma.jobPosting.create({
        data: {
            sourceId, externalId: `${RUN}-${key}`, title, location: 'Bengaluru, India (Hybrid)', absoluteUrl: `https://boards.greenhouse.io/${RUN}/jobs/${key}`,
            contentHash: key, postedAt: new Date(NOW.getTime() - 86_400_000), description,
            skills: ['go', 'postgresql', 'kafka'],
            parsed: parsed ?? undefined, parsedKey: parsed ? parsedKeyFor(description) : null,
        },
        select: { id: true },
    });
    postingIds[key] = row.id;
}

beforeAll(async () => {
    // Hermetic: no live people search even where TAVILY_API_KEY is set.
    providerTesting.setProvider(null);
    flags = await snapshotFlags();
    await setFlagForTest('job_watch', { enabled: true, allowUserIds: [USER] });
    await prisma.userProfile.create({
        data: {
            userId: USER, fullName: 'Asha Iyer', email: `${RUN}@example.test`, defaultTitle: 'Senior Backend Engineer', location: 'Bengaluru',
            // No target roles: the watch then reads only the watched board (the
            // open market would pull in every posting in the dev database), and
            // the profile headline stands in as the role to match.
            preferences: { targetRoles: [], targetLocations: ['Bengaluru'], preferredWorkModes: ['hybrid', 'remote'] },
        },
    });
    await prisma.userExperience.create({
        data: {
            userId: USER, company: 'Plivo', role: 'Senior Backend Engineer', startDate: '2018-01', current: true,
            highlights: [
                'Built the payments ledger services in Go',
                'Ran PostgreSQL clusters at 20k writes per second',
                'Designed Kafka event pipelines for settlement',
                'Led on-call for distributed systems serving every merchant',
            ],
        },
    });
    await prisma.channelIdentity.create({ data: { userId: USER, channel: Channel.telegram, externalId: `${RUN}-tg`, verified: true } });
    sourceId = (await prisma.jobSource.create({
        data: { provider: 'greenhouse', boardToken: RUN, companyName: 'Acme Pay', lastFetchedAt: NOW, lastSuccessAt: NOW },
        select: { id: true },
    })).id;
    await prisma.watchedCompany.create({ data: { userId: USER, companyName: 'Acme Pay', companyKey: 'acme pay', sourceId } });
});

beforeEach(async () => {
    sent = [];
    // Any model call not injected below is a test bug: the posting reads are pre-stored.
    aiTesting.setObjectRunner(async () => { throw new Error('unexpected model call'); });
    aiTesting.setUsageLogger(async () => {});
    aiTesting.setBudgetGuard(async () => {});
    await prisma.jobMatch.deleteMany({ where: { userId: USER } });
    await prisma.applicationWorkspace.deleteMany({ where: { userId: USER } });
    await prisma.jobPosting.deleteMany({ where: { sourceId } });
    await makePosting('strong', 'Senior Backend Engineer',
        `Hybrid role in Bengaluru. You will build Go services on PostgreSQL and Kafka for distributed systems.${LONG}`,
        brief(['Production experience writing Go', 'Operating PostgreSQL at scale', 'Event pipelines with Kafka', 'Distributed systems design'], ['Go', 'PostgreSQL', 'Kafka']));
    await makePosting('weak', 'Backend Engineer, Core Banking',
        `Hybrid role in Bengaluru. Maintain COBOL batch jobs on the mainframe; an active security clearance is required.${LONG}`,
        brief(['Five years of COBOL', 'Mainframe operations', 'Active security clearance', 'Go is a plus'], ['COBOL']));
    await makePosting('offRole', 'Accounts Payable Manager', `Own vendor payments and month-end close.${LONG}`, null);
});

afterEach(() => aiTesting.reset());

afterAll(async () => {
    providerTesting.setProvider(undefined);
    await prisma.win.deleteMany({ where: { userId: USER } });
    await prisma.jobMatch.deleteMany({ where: { userId: USER } });
    await prisma.watchedCompany.deleteMany({ where: { userId: USER } });
    await prisma.jobPosting.deleteMany({ where: { sourceId } });
    await prisma.jobSource.deleteMany({ where: { id: sourceId } });
    await prisma.applicationWorkspace.deleteMany({ where: { userId: USER } });
    await prisma.channelIdentity.deleteMany({ where: { userId: USER } });
    await prisma.userExperience.deleteMany({ where: { userId: USER } });
    await prisma.userProfile.deleteMany({ where: { userId: USER } });
    await prisma.funnelEvent.deleteMany({ where: { userId: USER } });
    await restoreFlags(flags);
});

describe('the nightly run', () => {
    test('scores the shortlist, sends only the 85+ match, and records the rest with a reason', async () => {
        const result = await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders });

        expect(result.skipped).toBeUndefined();
        expect(result.shortlisted).toBe(2); // the off-role posting never reaches scoring
        expect(result.scored).toBe(2);
        expect(result.qualified).toBe(1);
        expect(result.alert).toEqual({ sent: 1, channel: 'telegram' });

        expect(sent).toHaveLength(1);
        expect(sent[0].text).toContain('Senior Backend Engineer · Acme Pay');
        expect(sent[0].text).toContain('evidence for 4 of 4 must-haves');
        expect(sent[0].text).not.toContain('Core Banking');

        const rows = await prisma.jobMatch.findMany({ where: { userId: USER }, select: { postingId: true, qualifies: true, status: true, holdReason: true, score: true } });
        expect(rows).toHaveLength(2);
        const strong = rows.find((row) => row.postingId === postingIds.strong)!;
        const weak = rows.find((row) => row.postingId === postingIds.weak)!;
        expect(strong).toMatchObject({ qualifies: true, status: JobMatchStatus.alerted, holdReason: null });
        expect(strong.score).toBeGreaterThanOrEqual(85);
        expect(weak.qualifies).toBe(false);
        expect(weak.holdReason).toMatch(/^Scored \d+, below your 85$/);
        expect(rows.some((row) => row.postingId === postingIds.offRole)).toBe(false);
    });

    test('a second run the same night scores nothing and sends nothing', async () => {
        await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders });
        sent = [];
        const again = await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders });
        expect(again.scored).toBe(0);
        expect(again.alert?.reason).toBe('nothing_new');
        expect(sent).toHaveLength(0);
    });

    test('a matcher outage holds everything and retries it the next night', async () => {
        const down = await runWatchForUser(USER, { now: NOW, ai: failingMatcher, send: senders });
        expect(down.qualified).toBe(0);
        expect(sent).toHaveLength(0);
        const held = await prisma.jobMatch.findFirstOrThrow({ where: { userId: USER, postingId: postingIds.strong } });
        expect(held).toMatchObject({ matchedVia: 'fallback', qualifies: false, attempts: 1 });

        const back = await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders });
        expect(back.qualified).toBe(1);
        const retried = await prisma.jobMatch.findFirstOrThrow({ where: { userId: USER, postingId: postingIds.strong } });
        expect(retried).toMatchObject({ matchedVia: 'model', qualifies: true, attempts: 2 });
        expect(sent).toHaveLength(1);
    });

    test('when every channel fails, the claim is released for tomorrow', async () => {
        const dead: AlertSenders = { telegram: async () => false, whatsapp: async () => false, email: async () => false };
        const result = await runWatchForUser(USER, { now: NOW, ai: matcher, send: dead });
        expect(result.alert).toMatchObject({ sent: 0, reason: 'no_channel_delivered' });
        const row = await prisma.jobMatch.findFirstOrThrow({ where: { userId: USER, postingId: postingIds.strong } });
        expect(row.alertedAt).toBeNull();
        expect(row.status).toBe(JobMatchStatus.new);

        const retry = await sendMorningAlert(USER, { now: NOW, send: senders });
        expect(retry).toEqual({ sent: 1, channel: 'telegram' });
    });

    test('opting out of job alerts stops the message, not the scoring', async () => {
        await prisma.emailPreference.upsert({
            where: { userId: USER },
            create: { userId: USER, unsubscribeToken: `${RUN}-unsub`, jobAlerts: false },
            update: { jobAlerts: false },
        });
        try {
            const result = await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders });
            expect(result.qualified).toBe(1);
            expect(result.alert?.reason).toBe('opted_out');
            expect(sent).toHaveLength(0);
        } finally {
            await prisma.emailPreference.deleteMany({ where: { userId: USER } });
        }
    });

    test('near the deadline it stops scoring, still sends what it found, and leaves the rest for next run', async () => {
        // The matcher takes 1s of fake time per posting; the deadline leaves room for exactly one
        // score before the 10s alert reserve. The first queued posting is the newest (`weak` vs
        // `strong` order is by createdAt desc), so assert on counts, not on which one.
        let fake = 0;
        const slowMatcher = (async (opts: { prompt: string }) => {
            fake += 1_000;
            return (matcher as unknown as (o: { prompt: string }) => Promise<unknown>)(opts);
        }) as unknown as MatchAi;
        const result = await runWatchForUser(USER, {
            now: NOW, ai: slowMatcher, send: senders,
            deadline: new Date(10_500), clock: () => fake,
        });
        expect(result.scored).toBe(1);
        expect(result.deferred).toBe(1);
        expect(result.alert).not.toBeNull();
        expect(await prisma.jobMatch.count({ where: { userId: USER } })).toBe(1);

        // Next run, no deadline: the deferred posting is still a candidate.
        const next = await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders });
        expect(next.scored).toBe(1);
        expect(next.deferred).toBe(0);
        expect(await prisma.jobMatch.count({ where: { userId: USER } })).toBe(2);
    });

    test('flag off: nothing runs', async () => {
        await setFlagForTest('job_watch', { enabled: false, allowUserIds: [] });
        try {
            expect((await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders })).skipped).toBe('flag_off');
        } finally {
            await setFlagForTest('job_watch', { enabled: true, allowUserIds: [USER] });
        }
    });
});

describe('people on the alert', () => {
    test('with no connection there, a recruiter found by search is named, with the page it came from', async () => {
        cacheTesting.setStore(createMemoryStore());
        providerTesting.setProvider({
            name: 'fake',
            async search(args: { query: string }) {
                const recruiter = /recruiter/.test(args.query);
                return {
                    kind: 'ok',
                    costUsd: 0,
                    results: recruiter
                        ? [{ url: 'https://linkedin.com/in/meera', title: 'Meera Nair - Technical Recruiter - Acme Pay | LinkedIn', content: '', rawContent: null, publishedDate: null, score: 1 }]
                        : [],
                };
            },
        } as never);
        try {
            await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders });
            expect(sent[0].text).toContain('Talk to: Meera Nair (Recruits at Acme Pay');
            expect(sent[0].text).toContain('https://linkedin.com/in/meera');
            const [match] = await listMatches(USER, 'qualified');
            const found = match.people?.targets.find((t) => t.tier === 'found');
            expect(found?.citation?.title).toBe('Meera Nair - Technical Recruiter - Acme Pay | LinkedIn');
        } finally {
            providerTesting.setProvider(null);
            cacheTesting.setStore(null);
        }
    });
});

describe('re-checking held matches when the record changes', () => {
    test('a near-miss held at ~75 is re-scored after a Win fills the gap, then sent', async () => {
        const rustRole = await prisma.jobPosting.create({
            data: {
                sourceId, externalId: `${RUN}-rust`, title: 'Senior Backend Engineer, Ledger', location: 'Bengaluru, India (Hybrid)',
                absoluteUrl: `https://boards.greenhouse.io/${RUN}/jobs/rust`, contentHash: 'rust', postedAt: new Date(NOW.getTime() - 86_400_000),
                description: `Hybrid role in Bengaluru. Go and Rust services on PostgreSQL with Kafka.${LONG}`,
                skills: ['go', 'postgresql', 'kafka', 'rust'],
                parsed: brief(['Production experience writing Go', 'Operating PostgreSQL at scale', 'Event pipelines with Kafka', 'Performance work in Rust'], ['Go', 'PostgreSQL', 'Kafka', 'Rust']),
                parsedKey: parsedKeyFor(`Hybrid role in Bengaluru. Go and Rust services on PostgreSQL with Kafka.${LONG}`),
            },
            select: { id: true },
        });
        try {
            await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders });
            const before = await prisma.jobMatch.findFirstOrThrow({ where: { userId: USER, postingId: rustRole.id } });
            expect(before.qualifies).toBe(false);
            expect(before.score!).toBeGreaterThanOrEqual(RECHECK_MIN_SCORE);
            expect(before.score!).toBeLessThan(85);
            expect(before.recordKey).toBeTruthy();

            // Nothing changed: the held match is not paid for again.
            const quiet = await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders });
            expect(quiet.rechecked).toBe(0);

            await prisma.win.create({
                data: {
                    userId: USER, title: 'Rewrote the ledger hot path in Rust', narrative: 'p99 fell from 40ms to 9ms.',
                    occurredAt: new Date('2026-09-20'), category: WinCategory.shipped, status: WinStatus.confirmed,
                    sensitivity: WinSensitivity.shareable, source: WinSource.manual, confirmedAt: new Date(),
                },
            });
            sent = [];
            const after = await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders });
            expect(after.rechecked).toBe(1);
            const now = await prisma.jobMatch.findFirstOrThrow({ where: { userId: USER, postingId: rustRole.id } });
            expect(now.qualifies).toBe(true);
            expect(now.recordKey).not.toBe(before.recordKey);
            expect(sent).toHaveLength(1);
            expect(sent[0].text).toContain('Senior Backend Engineer, Ledger');
        } finally {
            await prisma.win.deleteMany({ where: { userId: USER } });
        }
    });

    test('a far miss is never re-checked, whatever changes', async () => {
        await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders });
        await prisma.win.create({
            data: {
                userId: USER, title: 'Learned some COBOL', narrative: '', occurredAt: new Date('2026-09-20'), category: WinCategory.learned,
                status: WinStatus.confirmed, sensitivity: WinSensitivity.shareable, source: WinSource.manual,
            },
        });
        try {
            const again = await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders });
            expect(again.rechecked).toBe(0);
        } finally {
            await prisma.win.deleteMany({ where: { userId: USER } });
        }
    });
});

describe('acting on a match', () => {
    test('track puts it on the job board once; pass hides it', async () => {
        await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders });
        const [match] = await listMatches(USER, 'qualified');
        expect(match.people).not.toBeNull();

        const first = await trackMatch(USER, match.id);
        const second = await trackMatch(USER, match.id);
        expect(first.success && second.success && first.data.workspaceId === second.data.workspaceId).toBe(true);
        expect(await prisma.applicationWorkspace.count({ where: { userId: USER } })).toBe(1);

        const [held] = await listMatches(USER, 'held');
        expect(held.holdReason).toBeTruthy();
        await dismissMatch(USER, held.id);
        expect(await listMatches(USER, 'held')).toHaveLength(0);
        expect(await listMatches(USER, 'passed')).toHaveLength(1);
    });

    test("another user's match id does nothing", async () => {
        await runWatchForUser(USER, { now: NOW, ai: matcher, send: senders });
        const [match] = await listMatches(USER, 'qualified');
        expect((await trackMatch(`${RUN}-intruder`, match.id)).success).toBe(false);
        expect(await dismissMatch(`${RUN}-intruder`, match.id)).toEqual({ success: true, data: { dismissed: false } });
    });
});
