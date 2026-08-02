'use server';

/**
 * Career Radar (PRD 04).
 *
 * Four answers on one screen: what your profile is worth, who would hire you,
 * which of your skills are in demand, and whether you are drifting.
 *
 * Two rules govern everything here and neither is negotiable:
 *
 *   No model produces a number. Bands are arithmetic over ranges read verbatim
 *   from public postings (§2.1 rule 1). Nothing in `src/lib/radar` imports an
 *   AI helper, and this action does not either.
 *
 *   Every figure ships with its provenance. `n`, the window, and the geography
 *   travel with the band, because a number a reader cannot check is a number
 *   they are being asked to take on faith — which is the opposite of what this
 *   product sells.
 */

import { auth } from '@clerk/nextjs/server';
import { WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { isEnabled } from '@/lib/flags';
import { getUserTier, hasFeature } from '@/lib/entitlements';
import { track } from '@/lib/track';
import {
    bandProvenance,
    computeBand,
    positionInBand,
    type BandObservation,
    type BandPosition,
    type MarketBand,
    type BandRefusal,
} from '@/lib/radar/band';
import { normalizeGeo } from '@/lib/radar/geo';
import { classifyFamily, classifySeniority, type Seniority } from '@/lib/radar/role';
import { findMatches, type Match } from '@/lib/radar/matching';

const FEATURE = { feature: 'career_radar' } as const;

/** Narrow a Json column to the string list it is supposed to be. */
function asStrings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Bands read only postings from this window.
 *
 * Without it the band spans whatever has ever been ingested — the first live
 * render said "based on 45 disclosed ranges, last 2451 days", which is nearly
 * seven years and is not a market. A band is a claim about what a role pays
 * NOW, so the window has to be recent enough to mean that and long enough to
 * reach n=8.
 */
const BAND_WINDOW_DAYS = 180;

/** Wins older than this stop describing what you do now (§4). */
const WIN_WINDOW_MONTHS = 18;

export type RadarBand =
    | { ok: true; band: MarketBand; provenance: string; position: BandPosition | null }
    | { ok: false; refusal: BandRefusal };

export type RadarSkill = {
    skill: string;
    postingCount: number;
    medianLow: number | null;
    medianHigh: number | null;
    currency: string | null;
    /** Null until two runs a month apart exist. Never fabricated. */
    trendPercent: number | null;
};

export type RadarMatch = {
    title: string;
    companyName: string;
    url: string;
    fitScore: number;
    matched: string[];
    ageDays: number;
    compLow: number | null;
    compHigh: number | null;
    currency: string | null;
};

export type RadarView = {
    /** What we inferred about the user, shown so they can tell us we're wrong. */
    profile: { family: string; seniority: Seniority; geoBucket: string | null; label: string };
    band: RadarBand;
    matches: RadarMatch[];
    skills: RadarSkill[];
    /** Confirmed wins in the window — the input quality signal. */
    winCount: number;
    /** True when the plan does not include full Radar. */
    locked: boolean;
    /** How fresh the underlying postings are. */
    postingsAsOf: Date | null;
};

/**
 * Everything the person has actually done, as one searchable string.
 *
 * Confirmed Wins first, then the profile. This is the whole reason Radar's
 * matching beats a keyword matcher (§4): we know what they *did* recently, at
 * a granularity a resume never carries. Drafts are excluded — an unconfirmed
 * win is a suggestion, and matching on it would recommend roles based on
 * something the user never agreed was true.
 *
 * Experience records and their tech lists are included too, and that is not
 * padding. Wins deliberately record OUTCOMES — "cut checkout p95 latency
 * 800ms → 180ms" — while postings are indexed by TECHNOLOGY. A log of seven
 * good wins can contain no technology keyword at all, which scored every match
 * at the floor until this was widened. The outcome is the better evidence; the
 * tech list is what makes it findable.
 */
async function buildCorpus(userId: string): Promise<{ corpus: string; winCount: number }> {
    const since = new Date();
    since.setMonth(since.getMonth() - WIN_WINDOW_MONTHS);

    const [wins, profile, experiences, projects] = await Promise.all([
        prisma.win.findMany({
            where: { userId, status: WinStatus.confirmed, occurredAt: { gte: since } },
            select: { title: true, narrative: true },
            orderBy: { occurredAt: 'desc' },
            take: 200,
        }),
        prisma.userProfile.findUnique({
            where: { userId },
            select: { defaultTitle: true, defaultSummary: true, location: true },
        }),
        prisma.userExperience.findMany({
            where: { userId },
            select: { company: true, role: true, description: true, highlights: true },
            take: 20,
        }),
        prisma.userProject.findMany({
            where: { userId },
            select: { name: true, description: true, technologies: true },
            take: 20,
        }),
    ]);

    const corpus = [
        profile?.defaultTitle ?? '',
        profile?.defaultSummary ?? '',
        ...wins.map((w) => `${w.title} ${w.narrative}`),
        // `highlights` and `technologies` are Json columns; narrow rather
        // than spread, or a malformed row throws mid-request.
        ...experiences.map((e) =>
            [e.company, e.role, e.description, ...asStrings(e.highlights)].join(' '),
        ),
        ...projects.map((p) => [p.name, p.description, ...asStrings(p.technologies)].join(' ')),
    ]
        .join(' ')
        .toLowerCase();

    return { corpus, winCount: wins.length };
}

/**
 * Infer the cell this person sits in.
 *
 * Deliberately derived from their stated title and location rather than
 * guessed from their Wins: a person who has been writing SQL all year is not
 * necessarily a data analyst, and getting this wrong silently shows them the
 * wrong market. It is returned in the view so they can see what we assumed.
 */
async function inferProfile(userId: string) {
    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { defaultTitle: true, location: true },
    });

    const title = profile?.defaultTitle ?? '';
    const geo = normalizeGeo(profile?.location);

    return {
        family: classifyFamily(title),
        seniority: classifySeniority(title),
        geoBucket: geo.bucket,
        label: [title || 'Your role', geo.bucket ?? 'location not set'].join(' · '),
    };
}

/** The band for one cell, or an explained refusal. */
async function bandFor(
    family: string,
    seniority: Seniority,
    geoBucket: string | null,
): Promise<RadarBand> {
    if (family === 'unknown' || !geoBucket) {
        return { ok: false, refusal: { reason: 'no_data', n: 0 } };
    }

    const since = new Date(Date.now() - BAND_WINDOW_DAYS * 86_400_000);

    const rows = await prisma.jobPosting.findMany({
        where: {
            roleFamily: family,
            seniority,
            geoBucket,
            compBandEligible: true,
            postedAt: { gte: since },
        },
        select: { compAnnualLow: true, compAnnualHigh: true, compCurrency: true, postedAt: true },
    });

    const observations: BandObservation[] = rows.flatMap((r) =>
        r.compAnnualLow !== null && r.compAnnualHigh !== null && r.compCurrency
            ? [
                  {
                      annualLow: r.compAnnualLow,
                      annualHigh: r.compAnnualHigh,
                      currency: r.compCurrency,
                      postedAt: r.postedAt ?? new Date(),
                  },
              ]
            : [],
    );

    const result = computeBand(observations);
    if (!result.ok) return { ok: false, refusal: result.refusal };

    return {
        ok: true,
        band: result.band,
        provenance: bandProvenance(result.band),
        // Position needs the user's own compensation, which we do not collect
        // yet (PRD 04 §3.3 makes it an optional, skippable ask). Null until
        // then — inventing a position would be the worst kind of guess.
        position: null,
    };
}

/**
 * The Radar view.
 *
 * Returns a whole screen's worth in one call because every panel reads the
 * same inferred cell, and computing it three times would let the panels
 * disagree with each other.
 */
export async function getRadar(): Promise<Result<RadarView>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');
    if (!(await isEnabled(userId, 'career_radar'))) return err('Not available yet', 'not_found');

    const [inferred, corpusResult, tier] = await Promise.all([
        inferProfile(userId),
        buildCorpus(userId),
        getUserTier(userId),
    ]);

    const locked = !hasFeature(tier, 'radar_full');

    // Companies the user already tracks, plus their current employer — §4
    // excludes both, because showing someone a job they already applied for is
    // worse than showing them nothing.
    const [workspaces, employers, freshest] = await Promise.all([
        prisma.applicationWorkspace.findMany({
            where: { userId },
            select: { companyName: true },
            take: 200,
        }),
        // Employers live on the experience record, not a table of their own.
        prisma.userExperience.findMany({
            where: { userId },
            select: { company: true },
            take: 20,
        }),
        prisma.jobPosting.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    ]);

    const excludeCompanies = [
        ...workspaces.map((w) => w.companyName ?? ''),
        ...employers.map((e) => e.company),
    ].filter(Boolean);

    const [band, matches, skillRows] = await Promise.all([
        bandFor(inferred.family, inferred.seniority, inferred.geoBucket),
        findMatches({
            corpus: corpusResult.corpus,
            geoBuckets: inferred.geoBucket ? [inferred.geoBucket] : [],
            // Show the level above too: the point of Radar is what you could
            // move to, not only what you already are.
            seniorities: [],
            roleFamilies: inferred.family === 'unknown' ? [] : [inferred.family],
            excludeCompanies,
        }),
        inferred.geoBucket
            ? prisma.skillSignal.findMany({
                  where: { window: '90d', geoBucket: inferred.geoBucket },
                  orderBy: { postingCount: 'desc' },
                  take: 8,
                  select: {
                      skillNorm: true,
                      postingCount: true,
                      medianLow: true,
                      medianHigh: true,
                      currency: true,
                      trendPercent: true,
                  },
              })
            : Promise.resolve([]),
    ]);

    await track(userId, 'radar_viewed', {
        ...FEATURE,
        hasBand: band.ok,
        matchCount: matches.length,
        winCount: corpusResult.winCount,
    });

    return ok({
        profile: inferred,
        band,
        matches: matches.map(toRadarMatch),
        skills: skillRows.map((s) => ({
            skill: s.skillNorm,
            postingCount: s.postingCount,
            medianLow: s.medianLow,
            medianHigh: s.medianHigh,
            currency: s.currency,
            trendPercent: s.trendPercent,
        })),
        winCount: corpusResult.winCount,
        locked,
        postingsAsOf: freshest?.updatedAt ?? null,
    });
}

function toRadarMatch(match: Match): RadarMatch {
    return {
        title: match.posting.title,
        companyName: match.posting.companyName,
        url: match.posting.absoluteUrl,
        fitScore: match.fitScore,
        matched: match.matched,
        ageDays: match.ageDays,
        compLow: match.posting.compAnnualLow,
        compHigh: match.posting.compAnnualHigh,
        currency: match.posting.compCurrency,
    };
}

/** Re-export so the screen does not reach into `lib/radar` directly. */
export async function describePosition(
    amount: number,
    band: MarketBand,
): Promise<BandPosition> {
    return positionInBand(amount, band);
}
