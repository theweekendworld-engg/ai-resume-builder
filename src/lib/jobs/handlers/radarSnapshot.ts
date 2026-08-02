/**
 * `radar_snapshot` — the monthly Radar email (PRD 04 §5).
 *
 * This job kind has been declared in `types.ts` since the job system was
 * built, with a comment marking it "Phase 4+" and no handler behind it. An
 * enqueued `radar_snapshot` would have dead-lettered. This is that handler.
 *
 * Two modes, matching the shape `capture_sync` and `ingest_board` established:
 *
 *   `{}`             dispatch: enqueue one child per due user, then return
 *   `{ userId }`     compose and send one person's snapshot
 *
 * The fan-out is not optional (impl/00 §P-2): composing N users' snapshots in
 * one invocation is one slow user away from nobody getting an email.
 *
 * ── Cadence ─────────────────────────────────────────────────────────────
 *
 * Monthly, and deliberately NOT on the same rhythm as the weekly log digest.
 * They ask for different things — the weekly one wants you to confirm wins,
 * this one tells you where you stand — and a person may reasonably want one
 * without the other. `EmailPreference.radarDigest` governs this send alone.
 */

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { buildDedupeKey } from '@/lib/jobs/runner';
import type { JobContext, JobHandler, JobResultObject } from '@/lib/jobs/types';
import { sendEmail } from '@/lib/email/send';
import { config } from '@/lib/config';
import { computeBand, bandProvenance, type BandObservation } from '@/lib/radar/band';
import { normalizeGeo } from '@/lib/radar/geo';
import { classifyFamily, classifySeniority } from '@/lib/radar/role';
import { findMatches } from '@/lib/radar/matching';
import { isEnabled } from '@/lib/flags';

export const RADAR_SNAPSHOT_JOB_KIND = 'radar_snapshot' as const;

const PayloadSchema = z.object({
    userId: z.string().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(5_000).default(1_000),
});

/** Bands read this window — recent enough to mean "now", long enough to reach n=8. */
const BAND_WINDOW_DAYS = 180;

function money(amount: number, currency: string | null): string {
    const symbol = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '';
    const value = amount >= 1000 ? `${Math.round(amount / 1000)}k` : String(amount);
    return symbol ? `${symbol}${value}` : `${value} ${currency ?? ''}`.trim();
}

function prettyGeo(bucket: string): string {
    return bucket.replace(/^multi_/, 'multiple sites · ').replace(/^remote_/, 'remote · ').replace(/_/g, ' ');
}

/**
 * Users due a snapshot this month.
 *
 * Opt-out is checked HERE rather than in the child, so an unsubscribed user
 * costs nothing at all. `sendEmail` checks preferences again before sending —
 * that redundancy is deliberate, because the two checks protect against
 * different mistakes and the expensive one is the email, not the query.
 */
export async function dueUserIds(limit: number): Promise<string[]> {
    const rows = await prisma.emailPreference.findMany({
        where: { radarDigest: true, unsubscribedAll: false },
        select: { userId: true },
        take: limit,
    });
    return rows.map((r) => r.userId);
}

async function dispatch(limit: number, ctx: JobContext): Promise<JobResultObject> {
    const userIds = await dueUserIds(limit);
    // One snapshot per user per month. A double-fired cron is a no-op rather
    // than a second email, which is the failure users actually notice.
    const month = new Date().toISOString().slice(0, 7);

    let enqueued = 0;
    for (const userId of userIds) {
        const { deduped } = await ctx.enqueue(
            RADAR_SNAPSHOT_JOB_KIND,
            { userId },
            { dedupeKey: buildDedupeKey(RADAR_SNAPSHOT_JOB_KIND, [userId, month]) },
        );
        if (!deduped) enqueued += 1;
    }

    return { mode: 'dispatch', due: userIds.length, enqueued };
}

async function sendOne(userId: string): Promise<JobResultObject> {
    if (!(await isEnabled(userId, 'career_radar'))) {
        return { mode: 'send', skipped: 'flag_off' };
    }

    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { fullName: true, email: true, defaultTitle: true, defaultSummary: true, location: true },
    });
    if (!profile?.email) return { mode: 'send', skipped: 'no_email' };

    const geo = normalizeGeo(profile.location);
    const family = classifyFamily(profile.defaultTitle ?? '');
    const seniority = classifySeniority(profile.defaultTitle ?? '');

    // Without a market we have nothing to report. Sending "we could not place
    // you" monthly would be a recurring reminder that the product is not
    // working, so it is skipped until the profile is complete.
    if (!geo.bucket || family === 'unknown') {
        return { mode: 'send', skipped: 'profile_incomplete' };
    }

    const since = new Date(Date.now() - BAND_WINDOW_DAYS * 86_400_000);
    const [bandRows, wins, workspaces, skillRows] = await Promise.all([
        prisma.jobPosting.findMany({
            where: {
                roleFamily: family,
                seniority,
                geoBucket: geo.bucket,
                compBandEligible: true,
                postedAt: { gte: since },
            },
            select: { compAnnualLow: true, compAnnualHigh: true, compCurrency: true, postedAt: true },
        }),
        prisma.win.findMany({
            where: { userId, status: 'confirmed' },
            select: { title: true, narrative: true },
            take: 200,
        }),
        prisma.applicationWorkspace.findMany({ where: { userId }, select: { companyName: true }, take: 200 }),
        prisma.skillSignal.findMany({
            where: { window: '90d', geoBucket: geo.bucket },
            orderBy: { postingCount: 'desc' },
            take: 5,
            select: { skillNorm: true, postingCount: true, medianLow: true, medianHigh: true, currency: true },
        }),
    ]);

    const observations: BandObservation[] = bandRows.flatMap((r) =>
        r.compAnnualLow !== null && r.compAnnualHigh !== null && r.compCurrency
            ? [{ annualLow: r.compAnnualLow, annualHigh: r.compAnnualHigh, currency: r.compCurrency, postedAt: r.postedAt ?? new Date() }]
            : [],
    );
    const band = computeBand(observations);

    const corpus = [
        profile.defaultTitle ?? '',
        profile.defaultSummary ?? '',
        ...wins.map((w) => `${w.title} ${w.narrative}`),
    ]
        .join(' ')
        .toLowerCase();

    const matches = await findMatches({
        corpus,
        geoBuckets: [geo.bucket],
        seniorities: [],
        roleFamilies: [family],
        excludeCompanies: workspaces.map((w) => w.companyName ?? '').filter(Boolean),
    });

    const geoLabel = prettyGeo(geo.bucket);
    const roleLabel = `${seniority === 'unlevelled' ? 'Your role' : seniority} · ${family.replace(/_/g, ' ')}`;

    const result = await sendEmail({
        userId,
        to: profile.email,
        template: 'radar_digest',
        data: {
            monthLabel: new Date().toLocaleString('en-US', { month: 'long' }),
            roleLabel,
            geoLabel,
            band: band.ok
                ? {
                      kind: 'band' as const,
                      low: money(band.band.low, band.band.currency),
                      high: money(band.band.high, band.band.currency),
                      median: money(band.band.median, band.band.currency),
                      provenance: bandProvenance(band.band),
                  }
                : {
                      kind: 'suppressed' as const,
                      reason:
                          band.refusal.reason === 'insufficient_data'
                              ? `We found ${band.refusal.n} disclosed range${band.refusal.n === 1 ? '' : 's'} for ${roleLabel} in ${geoLabel}. We show a band at ${band.refusal.needed} or more.`
                              : `Not enough public data for ${roleLabel} in ${geoLabel} yet.`,
                  },
            matches: matches.map((m) => ({
                title: m.posting.title,
                company: m.posting.companyName,
                url: m.posting.absoluteUrl,
                pay:
                    m.posting.compAnnualLow && m.posting.compAnnualHigh
                        ? `${money(m.posting.compAnnualLow, m.posting.compCurrency)}–${money(m.posting.compAnnualHigh, m.posting.compCurrency)}`
                        : null,
            })),
            skills: skillRows.map((s) => ({
                label: s.skillNorm.replace(/_/g, ' '),
                postingCount: s.postingCount,
                pay: s.medianLow && s.medianHigh ? `${money(s.medianLow, s.currency)}–${money(s.medianHigh, s.currency)}` : null,
            })),
            radarUrl: `${config.app.url}/radar`,
        },
    });

    return { mode: 'send', status: result.status, hasBand: band.ok, matches: matches.length };
}

export const radarSnapshotHandler: JobHandler = async (payload, ctx) => {
    const parsed = PayloadSchema.safeParse(payload ?? {});
    if (!parsed.success) throw new Error('radar_snapshot: invalid payload');

    const { userId, limit } = parsed.data;
    return userId ? sendOne(userId) : dispatch(limit, ctx);
};
