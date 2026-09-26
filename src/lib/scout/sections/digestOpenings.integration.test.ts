/**
 * Digest and openings against the local Postgres.
 *
 * Isolation: a unique userId and runId prefix; everything created is deleted.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { prisma } from '@/lib/prisma';
import { digestSection } from './digest';
import { openingsSection, scorePosting } from './openings';
import { fakeContext } from '@/lib/scout/ingest/testContext.test-utils';
import type { ScoutSections } from '@/lib/scout/types';

const RUN = `itest-scout-f1-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const USER = `${RUN}-user`;
const createdSources: string[] = [];

afterAll(async () => {
    await prisma.savedInsight.deleteMany({ where: { userId: USER } });
    await prisma.jobSource.deleteMany({ where: { id: { in: createdSources } } });
    await prisma.userProfile.deleteMany({ where: { userId: USER } });
});

const at = new Date().toISOString();

describe('digest section', () => {
    const post = 'Three things I learned running interviews at Stripe: ask for trade-offs, not trivia; let candidates drive the design; and write feedback within 24 hours.';
    const sections: ScoutSections = {
        ingest: {
            status: 'ok',
            finishedAt: at,
            sources: [],
            data: {
                sourceUrl: 'https://www.linkedin.com/posts/x-activity-9',
                linkKind: 'linkedin_post',
                fetchVia: 'public_html',
                title: 'Interviewing lessons',
                author: 'Jane Doe',
                authorUrl: null,
                companyName: null,
                location: null,
                postedAt: null,
                applicantsText: null,
                text: post,
                truncated: false,
            },
        },
    };

    test('saves a SavedInsight, never a KnowledgeItem, and guards takeaways against the post', async () => {
        const knowledgeBefore = await prisma.knowledgeItem.count({ where: { userId: USER } });
        const { ctx, aiCalls } = fakeContext({
            userId: USER,
            runId: `${RUN}-digest`,
            sections,
            aiResponses: [{
                title: 'Interviewing lessons',
                takeaways: ['Ask about trade-offs rather than trivia.', 'Write feedback within 24 hours.'],
                tags: ['#Interviewing', 'hiring', 'hiring'],
            }],
        });

        const outcome = await digestSection(ctx);
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;
        expect(outcome.data.tags).toEqual(['interviewing', 'hiring']);

        const guard = aiCalls[0].guard as { sourceText: string; fields: string[] };
        expect(guard.fields).toContain('takeaways');
        expect(guard.sourceText).toContain('24 hours');

        const saved = await prisma.savedInsight.findUnique({ where: { runId: `${RUN}-digest` } });
        expect(saved?.userId).toBe(USER);
        expect(saved?.author).toBe('Jane Doe');
        expect(outcome.data.savedInsightId).toBe(saved!.id);

        expect(await prisma.knowledgeItem.count({ where: { userId: USER } })).toBe(knowledgeBefore);
    });

    test('re-running the section updates the same insight rather than duplicating it', async () => {
        const { ctx } = fakeContext({
            userId: USER,
            runId: `${RUN}-digest`,
            sections,
            aiResponses: [{ title: 'Interviewing lessons', takeaways: ['Let candidates drive the design.'], tags: ['hiring'] }],
        });
        await digestSection(ctx);
        expect(await prisma.savedInsight.count({ where: { runId: `${RUN}-digest` } })).toBe(1);
    });
});

describe('openings section', () => {
    const company = `Zyxorbit ${RUN.slice(-6)}`;

    function classified(companies: string[]): ScoutSections {
        return {
            classify: {
                status: 'ok',
                finishedAt: at,
                sources: [],
                data: { kind: 'company_signal', confidence: 0.9, companies, roleTitle: null, reason: 'Funding news.' },
            },
        };
    }

    test('lists a tracked company’s open roles, ranked by the user’s preferences', async () => {
        const source = await prisma.jobSource.create({
            data: { provider: 'greenhouse', boardToken: `${RUN}-board`, companyName: `${company}, Inc.` },
        });
        createdSources.push(source.id);
        const now = Date.now();
        await prisma.jobPosting.createMany({
            data: [
                { sourceId: source.id, externalId: '1', title: 'Account Executive', location: 'London', absoluteUrl: 'https://boards.greenhouse.io/z/jobs/1', contentHash: 'a', postedAt: new Date(now - 86_400_000) },
                { sourceId: source.id, externalId: '2', title: 'Senior Backend Engineer', location: 'Bengaluru, India', absoluteUrl: 'https://boards.greenhouse.io/z/jobs/2', contentHash: 'b', postedAt: new Date(now - 20 * 86_400_000) },
                { sourceId: source.id, externalId: '3', title: 'Backend Engineer', location: 'Remote', absoluteUrl: 'https://boards.greenhouse.io/z/jobs/3', contentHash: 'c', postedAt: new Date(now - 5 * 86_400_000), closedAt: new Date() },
            ],
        });
        await prisma.userProfile.create({
            data: { userId: USER, preferences: { targetRoles: ['Backend Engineer'], targetLocations: ['Bengaluru'] } },
        });

        const { ctx, sources } = fakeContext({ userId: USER, sections: classified([company, `Nonexistent ${RUN}`]) });
        const outcome = await openingsSection(ctx);
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;

        const [tracked, untracked] = outcome.data.companies;
        expect(tracked.tracked).toBe(true);
        // Closed postings are excluded; the preferred role ranks first.
        expect(tracked.openings.map((opening) => opening.title)).toEqual(['Senior Backend Engineer', 'Account Executive']);
        expect(sources.has('https://boards.greenhouse.io/z/jobs/2')).toBe(true);

        expect(untracked.tracked).toBe(false);
        expect(untracked.openings).toEqual([]);
        expect(untracked.note).toContain('does not watch');
    });

    test('no company named → unavailable with a reason', async () => {
        const { ctx } = fakeContext({ userId: USER, sections: classified([]) });
        const outcome = await openingsSection(ctx);
        expect(outcome.status).toBe('unavailable');
    });

    test('scorePosting: no preferences means recency alone', () => {
        const now = new Date('2026-09-23T00:00:00Z');
        const fresh = scorePosting({ title: 'X', location: null, postedAt: new Date('2026-09-22T00:00:00Z') }, { targetRoles: [], targetLocations: [] }, now);
        const stale = scorePosting({ title: 'X', location: null, postedAt: new Date('2026-06-01T00:00:00Z') }, { targetRoles: [], targetLocations: [] }, now);
        expect(fresh).toBeGreaterThan(stale);
    });
});
