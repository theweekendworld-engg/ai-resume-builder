/**
 * Put an analysed job in the job tracker (docs/impl/06-scout-agent.md, career inbox).
 *
 * The tracker is `ApplicationWorkspace`, the same table the dashboard's
 * Applications section and the extension already read and write. Scout adds
 * rows to it rather than keeping a second list, so a job shared on Telegram
 * and later opened in the extension is one job, not two.
 *
 * Three rules this file exists to keep:
 *
 *   1. Status never moves backwards. A job the user marked `applied` (in the
 *      extension, on the board, from Telegram) stays applied when the same
 *      link is analysed again. Only `discovered` — the extension's "we saw this
 *      page" — is promoted to `analyzed`.
 *   2. One job, one row. Matched by the canonical URL first; for LinkedIn also
 *      by job id inside whatever URL the extension saved; then by exact
 *      company + role, but only against rows Scout has not already claimed, so
 *      two different Scout-analysed postings with the same title never merge.
 *   3. The newest analysis wins the link: `scoutRunId` points at this run.
 */

import { Prisma, type ApplicationStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { linkedinJobId } from '@/lib/scout/inputKey';
import { dataOf, type ScoutSection } from '@/lib/scout/section';
import type { IngestData, TrackData, TrackedStatus } from '@/lib/scout/types';

/** Cap on the stored description; the full text lives on the run. */
export const JOB_DESCRIPTION_MAX = 20_000;

/**
 * The URL a job is filed under. LinkedIn shows one job under many URLs, so it
 * is filed under the one form they all share. Pasted text has no URL, and the
 * column is required and unique per user, so it is filed under the run.
 */
export function trackerUrl(ingest: Pick<IngestData, 'sourceUrl'> | null, runId: string): string {
    const url = ingest?.sourceUrl?.trim();
    if (!url) return `scout:${runId}`;
    const jobId = linkedinJobId(url);
    return jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : url;
}

/** What the tracker's `sourcePlatform` column says about where a job came from. */
export function platformOf(ingest: Pick<IngestData, 'sourceUrl' | 'linkKind'> | null): string {
    const url = ingest?.sourceUrl;
    if (!url) return 'scout';
    let host = '';
    try {
        host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return 'scout';
    }
    if (host.endsWith('linkedin.com')) return 'linkedin';
    for (const known of ['greenhouse', 'lever', 'ashby', 'workday', 'wellfound', 'indeed']) {
        if (host.includes(known)) return known;
    }
    return host || 'scout';
}

type Existing = { id: string; applicationStatus: ApplicationStatus; scoutRunId: string | null };

async function findExisting(params: {
    userId: string;
    url: string;
    ingest: IngestData | null;
    company: string | null;
    role: string | null;
}): Promise<Existing | null> {
    const select = { id: true, applicationStatus: true, scoutRunId: true } as const;
    const byUrl = await prisma.applicationWorkspace.findUnique({
        where: { userId_sourceUrl: { userId: params.userId, sourceUrl: params.url } },
        select,
    });
    if (byUrl) return byUrl;

    // The extension saves whatever URL the tab showed, tracking params and all.
    const jobId = params.ingest?.sourceUrl ? linkedinJobId(params.ingest.sourceUrl) : null;
    if (jobId) {
        // `contains` is a prefilter: 123456 is inside 1234567. The id parsed
        // back out of the stored URL is the actual match.
        const candidates = await prisma.applicationWorkspace.findMany({
            where: { userId: params.userId, sourceUrl: { contains: jobId } },
            orderBy: { updatedAt: 'desc' },
            select: { ...select, sourceUrl: true },
            take: 10,
        });
        const byJobId = candidates.find((row) => linkedinJobId(row.sourceUrl) === jobId);
        if (byJobId) return { id: byJobId.id, applicationStatus: byJobId.applicationStatus, scoutRunId: byJobId.scoutRunId };
    }

    if (params.company && params.role) {
        return prisma.applicationWorkspace.findFirst({
            where: {
                userId: params.userId,
                scoutRunId: null,
                companyName: { equals: params.company, mode: 'insensitive' },
                roleTitle: { equals: params.role, mode: 'insensitive' },
            },
            orderBy: { updatedAt: 'desc' },
            select,
        });
    }
    return null;
}

export const trackSection: ScoutSection<'track'> = async (ctx) => {
    const ingest = dataOf(ctx.sections, 'ingest');
    const jd = dataOf(ctx.sections, 'jd');
    const fit = dataOf(ctx.sections, 'fit');
    if (!jd) {
        return { status: 'unavailable', reason: 'The job description could not be read, so there is nothing to track' };
    }

    const url = trackerUrl(ingest, ctx.runId);
    const company = jd.company?.trim() || null;
    const role = jd.role?.trim() || null;
    const fields = {
        sourcePlatform: platformOf(ingest),
        companyName: company,
        roleTitle: role,
        location: jd.location,
        employmentType: jd.employmentType,
        compensationText: jd.compensationText,
        jobDescription: ingest?.text ? ingest.text.slice(0, JOB_DESCRIPTION_MAX) : null,
        fitScore: fit?.score ?? null,
        fitSummary: fit?.summary || null,
        fitVerdict: fit?.verdict ?? null,
        scoutRunId: ctx.runId,
    };

    const existing = await findExisting({ userId: ctx.userId, url, ingest, company, role });
    let id: string;
    let created = false;

    if (existing) {
        await release(ctx.runId, existing.id);
        // Status is deliberately absent: it is the user's, and only moves forward below.
        await prisma.applicationWorkspace.update({ where: { id: existing.id }, data: fields });
        id = existing.id;
    } else {
        try {
            const row = await prisma.applicationWorkspace.create({
                data: { userId: ctx.userId, sourceUrl: url, applicationStatus: 'analyzed', ...fields },
                select: { id: true },
            });
            id = row.id;
            created = true;
        } catch (error) {
            // Lost a race with a concurrent create for the same URL: update that row.
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
            const raced = await prisma.applicationWorkspace.findUnique({
                where: { userId_sourceUrl: { userId: ctx.userId, sourceUrl: url } },
                select: { id: true },
            });
            if (!raced) throw error;
            await release(ctx.runId, raced.id);
            await prisma.applicationWorkspace.update({ where: { id: raced.id }, data: fields });
            id = raced.id;
        }
    }

    // Forward-only, and conditional so it cannot clobber a status the user set
    // between our read and this write.
    await prisma.applicationWorkspace.updateMany({
        where: { id, applicationStatus: 'discovered' },
        data: { applicationStatus: 'analyzed' },
    });

    const row = await prisma.applicationWorkspace.findUniqueOrThrow({ where: { id }, select: { applicationStatus: true } });
    const data: TrackData = { workspaceId: id, status: row.applicationStatus as TrackedStatus, created };
    ctx.step.log('tracked', { workspaceId: id, created, status: data.status });
    return { status: 'ok', data };
};

/**
 * `scoutRunId` is unique. If a retried step already pinned this run to a
 * different row (it cannot normally, but a replayed workflow step is exactly
 * when "cannot normally" happens), unpin it there first.
 */
async function release(runId: string, keepId: string): Promise<void> {
    await prisma.applicationWorkspace.updateMany({
        where: { scoutRunId: runId, id: { not: keepId } },
        data: { scoutRunId: null },
    });
}
