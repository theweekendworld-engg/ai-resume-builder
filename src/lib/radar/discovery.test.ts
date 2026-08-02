/**
 * Board discovery.
 *
 * The URL shapes below are what each provider actually emits, copied from live
 * API responses. The negative cases are the important ones: a token guessed
 * from the wrong URL creates a JobSource that 404s forever and then retires
 * itself five polls later — noise indistinguishable from a real dead board.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { prisma } from '@/lib/prisma';
import { boardFromUrl, registerBoard, registerBoardFromUrl } from './discovery';

const created: string[] = [];

function uniqueToken(label: string): string {
    const t = `disc-${label}-${crypto.randomUUID().slice(0, 8)}`;
    created.push(t);
    return t;
}

afterEach(async () => {
    while (created.length > 0) {
        const t = created.pop();
        if (t) await prisma.jobSource.deleteMany({ where: { boardToken: t } });
    }
});

describe('recovering a board from a posting URL', () => {
    test.each([
        // Real, from greenhouse `absolute_url` and ashby `jobUrl`.
        ['https://boards.greenhouse.io/figma/jobs/5364702004?gh_jid=5364702004', 'greenhouse', 'figma'],
        ['https://job-boards.greenhouse.io/stripe/jobs/12345', 'greenhouse', 'stripe'],
        ['https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245', 'ashby', 'ramp'],
        ['https://jobs.ashbyhq.com/openai/abc-def/application', 'ashby', 'openai'],
    ])('%s', (url, provider, token) => {
        expect(boardFromUrl(url)).toEqual({ provider: provider as 'greenhouse' | 'ashby', boardToken: token });
    });

    test('a URL from a provider we cannot read yields nothing', () => {
        // Lever has no adapter. Registering it would create a source that can
        // never be fetched.
        expect(boardFromUrl('https://jobs.lever.co/spotify/abc-123')).toBeNull();
    });

    test('an aggregator or company careers page is not a board', () => {
        expect(boardFromUrl('https://www.linkedin.com/jobs/view/12345')).toBeNull();
        expect(boardFromUrl('https://acme.com/careers/engineer')).toBeNull();
    });

    test('the embed path is not a company slug', () => {
        // boards.greenhouse.io/embed/job_app?token=… puts "embed" where the
        // company normally sits.
        expect(boardFromUrl('https://boards.greenhouse.io/embed/job_app?token=123')).toBeNull();
    });

    test('malformed input is null, never a throw', () => {
        expect(boardFromUrl('not a url')).toBeNull();
        expect(boardFromUrl('')).toBeNull();
        expect(boardFromUrl(null)).toBeNull();
        expect(boardFromUrl(undefined)).toBeNull();
    });

    test('a bare board root with no job path still identifies the board', () => {
        expect(boardFromUrl('https://boards.greenhouse.io/figma')).toEqual({
            provider: 'greenhouse',
            boardToken: 'figma',
        });
    });
});

describe('registration', () => {
    test('registers a board once', async () => {
        const token = uniqueToken('once');
        const first = await registerBoard({
            board: { provider: 'greenhouse', boardToken: token },
            companyName: 'Test Co',
            discoveredVia: 'seed',
        });
        expect(first.created).toBe(true);

        const rows = await prisma.jobSource.count({ where: { boardToken: token } });
        expect(rows).toBe(1);
    });

    test('a re-sighting is idempotent and does not disturb the existing row', async () => {
        // Safe to call on every page view is the whole point — and an existing
        // row may hold an ETag, a 404 streak, or a retired status that a
        // re-sighting is no evidence against.
        const token = uniqueToken('idem');
        const first = await registerBoard({
            board: { provider: 'greenhouse', boardToken: token },
            companyName: 'Original',
            discoveredVia: 'seed',
        });
        await prisma.jobSource.update({
            where: { id: first.id },
            data: { status: 'inactive', notFoundStreak: 5, etag: 'W/"keep"' },
        });

        const second = await registerBoard({
            board: { provider: 'greenhouse', boardToken: token },
            companyName: 'Different Name',
            discoveredVia: 'extension',
        });

        expect(second.created).toBe(false);
        expect(second.id).toBe(first.id);
        const row = await prisma.jobSource.findUniqueOrThrow({ where: { id: first.id } });
        expect(row.status).toBe('inactive');
        expect(row.notFoundStreak).toBe(5);
        expect(row.etag).toBe('W/"keep"');
        expect(row.companyName).toBe('Original');
    });

    test('the same token on two providers is two boards', async () => {
        const token = uniqueToken('cross');
        await registerBoard({ board: { provider: 'greenhouse', boardToken: token }, discoveredVia: 'seed' });
        await registerBoard({ board: { provider: 'ashby', boardToken: token }, discoveredVia: 'seed' });
        expect(await prisma.jobSource.count({ where: { boardToken: token } })).toBe(2);
    });

    test('records who found it, so the extension channel can be measured', async () => {
        const token = uniqueToken('via');
        const { id } = await registerBoard({
            board: { provider: 'ashby', boardToken: token },
            discoveredVia: 'extension',
            discoveredByUserId: 'user_abc',
        });
        const row = await prisma.jobSource.findUniqueOrThrow({ where: { id } });
        expect(row.discoveredVia).toBe('extension');
        expect(row.discoveredByUserId).toBe('user_abc');
    });

    test('falls back to the token when no company name is given', async () => {
        const token = uniqueToken('noname');
        const { id } = await registerBoard({
            board: { provider: 'greenhouse', boardToken: token },
            discoveredVia: 'seed',
        });
        const row = await prisma.jobSource.findUniqueOrThrow({ where: { id } });
        expect(row.companyName).toBe(token);
    });
});

describe('registerBoardFromUrl', () => {
    test('registers when the URL is a readable board', async () => {
        const token = uniqueToken('fromurl');
        const board = await registerBoardFromUrl({
            url: `https://boards.greenhouse.io/${token}/jobs/1`,
            companyName: 'From URL',
            discoveredVia: 'workspace',
        });
        expect(board?.boardToken).toBe(token);
        expect(await prisma.jobSource.count({ where: { boardToken: token } })).toBe(1);
    });

    test('an unreadable URL registers nothing and reports null', async () => {
        expect(
            await registerBoardFromUrl({ url: 'https://linkedin.com/jobs/1', discoveredVia: 'workspace' }),
        ).toBeNull();
    });

    test('never throws — it runs inside user-facing paths', async () => {
        // Discovery is a background nicety. A failure here must not surface as
        // an error on an action the user actually asked for.
        await expect(
            registerBoardFromUrl({ url: null, discoveredVia: 'extension' }),
        ).resolves.toBeNull();
    });
});
