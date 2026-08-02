/**
 * Board discovery (PRD 04 §3.1).
 *
 * "Board discovery is the real work, not the fetching." Ingestion has been
 * able to read a board since slice 2, but only for `JobSource` rows created by
 * hand — so in production nothing was ingested at all.
 *
 * Three sources, in ascending order of how much they compound:
 *
 *   1. A curated launch list. Finite, ages, but gets the first bands to n=8.
 *   2. Companies our users already track (`ApplicationWorkspace.sourceUrl`).
 *      Their real target companies, which is the highest-value seed we have
 *      and costs nothing.
 *   3. The extension. When someone opens a Greenhouse or Ashby posting, that
 *      board registers itself. Every install is a discovery probe, which is
 *      the one channel that grows without us doing anything.
 *
 * The mechanism for (2) and (3) is the same: recover a board token from a
 * posting URL. Everything here is string parsing — no network, no model.
 */

import { prisma } from '@/lib/prisma';

export type DiscoveredBoard = {
    provider: 'greenhouse' | 'ashby';
    boardToken: string;
};

/**
 * Board tokens we must never register.
 *
 * A URL like `boards.greenhouse.io/embed/job_app?token=…` has `embed` where
 * the company slug normally sits. Registering it would create a JobSource that
 * 404s forever and then retires itself five polls later — noise that looks
 * exactly like a real dead board.
 */
const RESERVED_TOKENS = new Set([
    'embed',
    'jobs',
    'job',
    'apply',
    'api',
    'www',
    'static',
    'assets',
    'search',
]);

/** A plausible company slug: lowercase-ish, no spaces, not absurdly long. */
function isPlausibleToken(token: string): boolean {
    if (!token || token.length > 64) return false;
    if (RESERVED_TOKENS.has(token.toLowerCase())) return false;
    return /^[a-z0-9][a-z0-9._-]*$/i.test(token);
}

/**
 * Recover the board a posting URL belongs to.
 *
 * Real formats, confirmed against what each provider emits:
 *   https://boards.greenhouse.io/figma/jobs/5364702004?gh_jid=…
 *   https://job-boards.greenhouse.io/figma/jobs/5364702004
 *   https://jobs.ashbyhq.com/ramp/34413f8d-…/application
 *
 * Returns null for anything else, including LinkedIn and company career pages
 * that merely link onward to a board — guessing a token from those produces a
 * source that can never be fetched.
 */
export function boardFromUrl(rawUrl: string | null | undefined): DiscoveredBoard | null {
    if (!rawUrl) return null;

    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }

    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    if (host.endsWith('greenhouse.io')) {
        // The company slug is the first path segment on both the legacy
        // `boards.` host and the newer `job-boards.` one.
        const token = segments[0];
        return isPlausibleToken(token) ? { provider: 'greenhouse', boardToken: token } : null;
    }

    if (host.endsWith('ashbyhq.com')) {
        const token = segments[0];
        return isPlausibleToken(token) ? { provider: 'ashby', boardToken: token } : null;
    }

    return null;
}

/**
 * Register a board, or leave the existing row alone.
 *
 * Idempotent by `(provider, boardToken)`, which is what makes this safe to
 * call on every extension page view and every workspace write. An existing
 * row is never modified: it may carry an ETag, a 404 streak, or a retired
 * status, and a re-sighting is not evidence that any of that changed.
 */
export async function registerBoard(params: {
    board: DiscoveredBoard;
    companyName?: string | null;
    discoveredVia: 'seed' | 'workspace' | 'extension';
    discoveredByUserId?: string | null;
}): Promise<{ id: string; created: boolean }> {
    const existing = await prisma.jobSource.findUnique({
        where: {
            provider_boardToken: {
                provider: params.board.provider,
                boardToken: params.board.boardToken,
            },
        },
        select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };

    const created = await prisma.jobSource.create({
        data: {
            provider: params.board.provider,
            boardToken: params.board.boardToken,
            companyName: params.companyName?.trim() || params.board.boardToken,
            discoveredVia: params.discoveredVia,
            discoveredByUserId: params.discoveredByUserId ?? null,
        },
        select: { id: true },
    });
    return { id: created.id, created: true };
}

/**
 * Register the board behind a posting URL, if it is one we can read.
 *
 * Deliberately swallows its own failures. This runs inside user-facing paths —
 * tracking an application, opening the side panel — and discovery is a
 * background nicety. A registration failure must never surface as an error on
 * an action the user asked for.
 */
export async function registerBoardFromUrl(params: {
    url: string | null | undefined;
    companyName?: string | null;
    discoveredVia: 'seed' | 'workspace' | 'extension';
    discoveredByUserId?: string | null;
}): Promise<DiscoveredBoard | null> {
    const board = boardFromUrl(params.url);
    if (!board) return null;

    try {
        await registerBoard({ ...params, board });
        return board;
    } catch (error) {
        console.warn('[radar/discovery] could not register board', {
            provider: board.provider,
            boardToken: board.boardToken,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

/**
 * Backfill boards from workspaces users have already tracked.
 *
 * Run once when discovery ships, and cheap enough to re-run: registration is
 * idempotent, so a second pass over the same workspaces registers nothing.
 */
export async function discoverFromWorkspaces(limit = 1_000): Promise<{
    scanned: number;
    registered: number;
}> {
    const workspaces = await prisma.applicationWorkspace.findMany({
        where: { sourceUrl: { not: '' } },
        select: { sourceUrl: true, companyName: true, userId: true },
        orderBy: { updatedAt: 'desc' },
        take: limit,
    });

    let registered = 0;
    // De-duplicate in memory so 200 workspaces at one company are one write.
    const seen = new Set<string>();

    for (const workspace of workspaces) {
        const board = boardFromUrl(workspace.sourceUrl);
        if (!board) continue;
        const key = `${board.provider}:${board.boardToken}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const result = await registerBoard({
            board,
            companyName: workspace.companyName,
            discoveredVia: 'workspace',
            discoveredByUserId: workspace.userId,
        });
        if (result.created) registered += 1;
    }

    return { scanned: workspaces.length, registered };
}

/**
 * The curated launch list.
 *
 * Small and honest: every token here was confirmed to answer during slice 2's
 * probes. A longer list assembled from memory would mostly be 404s that retire
 * themselves, which costs five polls each and pollutes the health signal.
 * Grow it from boards we have actually seen respond.
 */
export const LAUNCH_LIST: ReadonlyArray<DiscoveredBoard & { companyName: string }> = [
    { provider: 'greenhouse', boardToken: 'stripe', companyName: 'Stripe' },
    { provider: 'greenhouse', boardToken: 'databricks', companyName: 'Databricks' },
    { provider: 'greenhouse', boardToken: 'anthropic', companyName: 'Anthropic' },
    { provider: 'greenhouse', boardToken: 'discord', companyName: 'Discord' },
    { provider: 'greenhouse', boardToken: 'figma', companyName: 'Figma' },
    { provider: 'greenhouse', boardToken: 'gitlab', companyName: 'GitLab' },
    { provider: 'greenhouse', boardToken: 'cloudflare', companyName: 'Cloudflare' },
    { provider: 'greenhouse', boardToken: 'reddit', companyName: 'Reddit' },
    { provider: 'ashby', boardToken: 'ramp', companyName: 'Ramp' },
    { provider: 'ashby', boardToken: 'linear', companyName: 'Linear' },
    { provider: 'ashby', boardToken: 'notion', companyName: 'Notion' },
    { provider: 'ashby', boardToken: 'vanta', companyName: 'Vanta' },
    { provider: 'ashby', boardToken: 'openai', companyName: 'OpenAI' },
];

export async function seedLaunchList(): Promise<{ registered: number }> {
    let registered = 0;
    for (const entry of LAUNCH_LIST) {
        const result = await registerBoard({
            board: { provider: entry.provider, boardToken: entry.boardToken },
            companyName: entry.companyName,
            discoveredVia: 'seed',
        });
        if (result.created) registered += 1;
    }
    return { registered };
}
