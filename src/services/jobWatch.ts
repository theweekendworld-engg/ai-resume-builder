/**
 * The job watch (docs/prd/12-job-watch.md): the companies a user is aiming
 * for, a nightly look at what opened, and a morning message only when
 * something clears the bar.
 *
 * The pipeline per user, each night:
 *
 *   refresh   their watched boards, if tonight's ingest has not reached them
 *   shortlist new open postings, screened in code (`watch/candidates.ts`)
 *   score     the shortlist, as Scout would (`watch/score.ts`), capped per plan
 *   gate      fail-closed, 85+ and strong and nothing unknown (`watch/gate.ts`)
 *   alert     one message, top three, on the chat app they linked
 *
 * Every scored posting is a `JobMatch`, unique per (user, posting). That row
 * is the "already seen" set, the history the watch page shows, and the
 * guarantee that a double-fired night cannot alert the same job twice.
 */

import { Channel, JobMatchStatus, Prisma, WatchStatus } from '@prisma/client';
import { escapeTelegramHtml } from '@/lib/channels/format';
import { config } from '@/lib/config';
import { sendEmail } from '@/lib/email/send';
import { canonicalCompanyKey } from '@/lib/enrichment/companyName';
import { getUserTier } from '@/lib/entitlements';
import { isEnabled } from '@/lib/flags';
import { ingestOne } from '@/lib/jobs/handlers/ingestBoard';
import { jobWatchCompanyLimit, jobWatchNightlyScoreLimit } from '@/lib/plans';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import type { Coverage } from '@/lib/scout/fit/evaluate';
import { findPeople } from '@/lib/scout/sections/network';
import { SourceSet } from '@/lib/agent/sources';
import type { PeopleSearchStep } from '@/lib/research/people';
import { loadFitSources, type MatchAi } from '@/lib/scout/sections/fit';
import type { FitData, NetworkData } from '@/lib/scout/types';
import { sendTelegramMessageDetailed } from '@/lib/telegram';
import { track } from '@/lib/track';
import { sendWhatsAppText } from '@/lib/whatsapp';
import { alertItem, alertKeyboard, renderChatAlert, type AlertItem, type ChatButton } from '@/lib/watch/alert';
import { shortlist, type CandidatePosting } from '@/lib/watch/candidates';
import { alertGate, ALERT_MAX_AGE_DAYS } from '@/lib/watch/gate';
import { resolveCompanyBoard } from '@/lib/watch/resolve';
import { recordKeyFor, scorePosting } from '@/lib/watch/score';

/** Postings older than this are not "new" for a first run either. */
const CANDIDATE_WINDOW_DAYS = 30;
/** A board fetched more recently than this is fresh enough to score from. */
const FRESH_BOARD_MS = 6 * 60 * 60 * 1000;
/** Time kept back from the job deadline for the alert and bookkeeping. */
const ALERT_RESERVE_MS = 10_000;

/** Watched boards refreshed inline per run, at most. The rest wait for ingest. */
const MAX_INLINE_REFRESH = 10;
/** A fallback-scored match is retried this many times before it stays held. */
const MAX_ATTEMPTS = 3;
/**
 * A held match is re-scored after the record changes only if it was this
 * close. New evidence moves a score by a requirement or two, not from 30 to
 * 85, and every re-score is a model call.
 */
export const RECHECK_MIN_SCORE = 60;
/**
 * Companies whose recruiters and hiring managers are searched for per run.
 * Each is two web searches unless cached (14 days, shared across users), and
 * only qualifying matches are looked up.
 */
const MAX_PEOPLE_SEARCHES = 5;
/** Qualifying matches carried into one message (three shown, the rest counted). */
const ALERT_POOL = 10;

function watchUrl(): string {
    return `${config.app.url.replace(/\/$/, '')}/watch`;
}

// ───────────────────────────────────────────────────────────── watchlist

export type WatchedCompanyView = {
    id: string;
    companyName: string;
    status: 'watching' | 'not_found';
    provider: string | null;
    boardToken: string | null;
    openCount: number;
    /** A few current titles, so the user can see it is the right company. */
    sampleTitles: string[];
    lastCheckedAt: string | null;
};

export async function listWatchedCompanies(userId: string): Promise<WatchedCompanyView[]> {
    const rows = await prisma.watchedCompany.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: {
            id: true,
            companyName: true,
            status: true,
            source: { select: { id: true, provider: true, boardToken: true, lastSuccessAt: true } },
        },
    });
    const sourceIds = rows.flatMap((row) => (row.source ? [row.source.id] : []));
    const [counts, samples] = await Promise.all([
        sourceIds.length
            ? prisma.jobPosting.groupBy({ by: ['sourceId'], where: { sourceId: { in: sourceIds }, closedAt: null }, _count: { _all: true } })
            : Promise.resolve([]),
        sourceIds.length
            ? prisma.jobPosting.findMany({
                where: { sourceId: { in: sourceIds }, closedAt: null },
                orderBy: [{ postedAt: { sort: 'desc', nulls: 'last' } }],
                select: { sourceId: true, title: true },
                take: 200,
            })
            : Promise.resolve([]),
    ]);
    const countBy = new Map(counts.map((row) => [row.sourceId, row._count._all]));
    return rows.map((row) => ({
        id: row.id,
        companyName: row.companyName,
        status: row.status,
        provider: row.source?.provider ?? null,
        boardToken: row.source?.boardToken ?? null,
        openCount: row.source ? countBy.get(row.source.id) ?? 0 : 0,
        sampleTitles: row.source ? samples.filter((s) => s.sourceId === row.source!.id).slice(0, 3).map((s) => s.title) : [],
        lastCheckedAt: row.source?.lastSuccessAt?.toISOString() ?? null,
    }));
}

/**
 * Watch a company. Resolves its board (or records that none answered), and
 * fetches the board now when we have never read it, so the page can show
 * real openings instead of "check back tomorrow".
 */
export async function addWatchedCompany(
    userId: string,
    input: { companyName: string; careersUrl?: string | null },
    deps: { fetchImpl?: typeof fetch } = {},
): Promise<Result<{ company: WatchedCompanyView; note: string | null }>> {
    const companyName = input.companyName.trim();
    const companyKey = canonicalCompanyKey(companyName);
    if (!companyKey) return err('Type the company name as it appears on its careers page.', 'invalid_input');

    const [tier, count, existing] = await Promise.all([
        getUserTier(userId),
        prisma.watchedCompany.count({ where: { userId } }),
        prisma.watchedCompany.findUnique({ where: { userId_companyKey: { userId, companyKey } }, select: { id: true, status: true } }),
    ]);
    // Re-adding an unresolved company with a link is how the user fixes it.
    if (existing && (existing.status === WatchStatus.watching || !input.careersUrl)) {
        return err(`You are already watching ${companyName}.`, 'already_watching');
    }
    const limit = jobWatchCompanyLimit(tier);
    if (!existing && count >= limit) {
        return err(`Your plan watches up to ${limit} companies. Remove one to add another.`, 'limit_reached');
    }

    const resolution = await resolveCompanyBoard({ companyName, careersUrl: input.careersUrl, userId, fetchImpl: deps.fetchImpl });
    const data = resolution.kind === 'resolved'
        ? { companyName, companyKey, sourceId: resolution.sourceId, status: WatchStatus.watching }
        : { companyName, companyKey, sourceId: null, status: WatchStatus.not_found };
    const row = existing
        ? await prisma.watchedCompany.update({ where: { id: existing.id }, data, select: { id: true } })
        : await prisma.watchedCompany.create({ data: { userId, ...data }, select: { id: true } });

    if (resolution.kind === 'resolved') {
        const source = await prisma.jobSource.findUnique({ where: { id: resolution.sourceId }, select: { lastSuccessAt: true } });
        if (!source?.lastSuccessAt) {
            await ingestOne(resolution.sourceId).catch((error: unknown) =>
                console.warn('[watch] first fetch failed; the nightly ingest will retry', { sourceId: resolution.sourceId, error: String(error) }));
        }
    }
    await track(userId, 'watch_company_added', { resolved: resolution.kind === 'resolved', via: resolution.kind === 'resolved' ? resolution.via : null });

    const view = (await listWatchedCompanies(userId)).find((company) => company.id === row.id);
    if (!view) return err('The company was added but could not be read back. Refresh the page.', 'read_back_failed');
    // Kept on the list either way: an unresolved company is a visible to-do
    // ("paste a link"), not a silent failure.
    return ok({ company: view, note: resolution.kind === 'not_found' ? resolution.reason : null });
}

export async function removeWatchedCompany(userId: string, id: string): Promise<Result<{ removed: boolean }>> {
    // Scoped by userId in the WHERE: an id from another account deletes nothing.
    const { count } = await prisma.watchedCompany.deleteMany({ where: { id, userId } });
    if (count) await track(userId, 'watch_company_removed', {});
    return ok({ removed: count > 0 });
}

// ──────────────────────────────────────────────────────────────── matches

export type MatchView = {
    id: string;
    title: string;
    company: string;
    location: string | null;
    url: string;
    postedAt: string | null;
    closed: boolean;
    origin: 'watchlist' | 'preferences';
    score: number | null;
    verdict: string;
    qualifies: boolean;
    holdReason: string | null;
    status: 'new' | 'alerted' | 'tracked' | 'dismissed';
    matched: FitData['matched'];
    gaps: FitData['gaps'];
    preferenceChecks: FitData['preferenceChecks'];
    coverage: { mustCovered: number; mustTotal: number } | null;
    people: NetworkData | null;
    workspaceId: string | null;
    evaluatedAt: string;
};

type StoredFit = Omit<FitData, 'summary'> & { coverage?: Coverage };

function readFit(value: unknown): StoredFit | null {
    const fit = value as StoredFit | null;
    return fit && Array.isArray(fit.matched) && Array.isArray(fit.gaps) ? fit : null;
}

export async function listMatches(
    userId: string,
    view: 'qualified' | 'held' | 'passed',
    limit = 50,
): Promise<MatchView[]> {
    const where: Prisma.JobMatchWhereInput = view === 'qualified'
        ? { userId, qualifies: true, status: { in: [JobMatchStatus.new, JobMatchStatus.alerted, JobMatchStatus.tracked] } }
        : view === 'held'
            ? { userId, qualifies: false, status: { not: JobMatchStatus.dismissed }, score: { not: null } }
            : { userId, status: JobMatchStatus.dismissed };
    const rows = await prisma.jobMatch.findMany({
        where,
        orderBy: view === 'held' ? [{ score: { sort: 'desc', nulls: 'last' } }] : [{ evaluatedAt: 'desc' }],
        take: limit,
        select: {
            id: true, origin: true, score: true, verdict: true, qualifies: true, holdReason: true, fit: true,
            people: true, status: true, workspaceId: true, evaluatedAt: true,
            posting: { select: { title: true, location: true, absoluteUrl: true, postedAt: true, closedAt: true, source: { select: { companyName: true } } } },
        },
    });
    return rows.map((row) => {
        const fit = readFit(row.fit);
        return {
            id: row.id,
            title: row.posting.title,
            company: row.posting.source.companyName,
            location: row.posting.location,
            url: row.posting.absoluteUrl,
            postedAt: row.posting.postedAt?.toISOString() ?? null,
            closed: row.posting.closedAt !== null,
            origin: row.origin === 'watchlist' ? 'watchlist' : 'preferences',
            score: row.score,
            verdict: row.verdict,
            qualifies: row.qualifies,
            holdReason: row.holdReason,
            status: row.status,
            matched: fit?.matched ?? [],
            gaps: fit?.gaps ?? [],
            preferenceChecks: fit?.preferenceChecks ?? [],
            coverage: fit?.coverage ? { mustCovered: fit.coverage.mustCovered, mustTotal: fit.coverage.mustTotal } : null,
            people: (row.people as NetworkData | null) ?? null,
            workspaceId: row.workspaceId,
            evaluatedAt: row.evaluatedAt.toISOString(),
        };
    });
}

export async function dismissMatch(userId: string, matchId: string): Promise<Result<{ dismissed: boolean }>> {
    const { count } = await prisma.jobMatch.updateMany({
        where: { id: matchId, userId, status: { not: JobMatchStatus.tracked } },
        data: { status: JobMatchStatus.dismissed },
    });
    if (count) await track(userId, 'watch_match_dismissed', {});
    return ok({ dismissed: count > 0 });
}

/**
 * Put a match on the user's job board. Upsert on (user, url), the board's own
 * key, so a job already tracked from Scout or the extension is linked, not
 * duplicated, and its status is never moved backwards.
 */
export async function trackMatch(userId: string, matchId: string): Promise<Result<{ workspaceId: string }>> {
    const match = await prisma.jobMatch.findFirst({
        where: { id: matchId, userId },
        select: {
            id: true, score: true, verdict: true,
            posting: { select: { title: true, location: true, absoluteUrl: true, description: true, source: { select: { companyName: true } } } },
        },
    });
    if (!match) return err('That match was not found.', 'not_found');
    const workspace = await prisma.applicationWorkspace.upsert({
        where: { userId_sourceUrl: { userId, sourceUrl: match.posting.absoluteUrl } },
        create: {
            userId,
            sourcePlatform: 'job_watch',
            sourceUrl: match.posting.absoluteUrl,
            companyName: match.posting.source.companyName,
            roleTitle: match.posting.title,
            location: match.posting.location,
            jobDescription: match.posting.description,
            fitScore: match.score,
            fitVerdict: match.verdict,
        },
        update: {},
        select: { id: true },
    });
    await prisma.jobMatch.update({ where: { id: match.id }, data: { status: JobMatchStatus.tracked, workspaceId: workspace.id } });
    await track(userId, 'watch_match_tracked', {});
    return ok({ workspaceId: workspace.id });
}

// ──────────────────────────────────────────────────────────── the nightly run

export type WatchRunResult = {
    skipped?: 'flag_off' | 'nothing_to_watch' | 'empty_record';
    refreshed: number;
    considered: number;
    shortlisted: number;
    scored: number;
    /** Held near-misses re-scored because the record or preferences changed. */
    rechecked: number;
    qualified: number;
    errors: number;
    /** Queue items left unscored because the run reached its deadline; they are candidates again next run. */
    deferred: number;
    alert: AlertOutcome | null;
};

export type WatchDeps = {
    now?: Date;
    /**
     * The job's hard deadline (JobContext.deadline). Refresh and scoring stop
     * early enough to leave time for the alert, so a slow night still sends
     * what it found instead of being killed and retried a day later.
     */
    deadline?: Date;
    /** Injected in tests: the clock used for deadline checks. */
    clock?: () => number;
    /** Injected in tests: the matcher call. */
    ai?: MatchAi;
    /** Injected in tests: refreshing a board. */
    refresh?: (sourceId: string) => Promise<unknown>;
    send?: AlertSenders;
    /** Injected in tests: the web step for people search, or null for none. */
    peopleStep?: PeopleSearchStep | null;
};

/** A step for people search outside a Scout run: its own sources, a deadline, logs. */
function watchPeopleStep(userId: string): PeopleSearchStep {
    return {
        userId,
        sources: new SourceSet(),
        signal: AbortSignal.timeout(20_000),
        addCost: () => {},
        log: (message, extra) => console.info(`[watch] ${message}`, { userId, ...extra }),
    };
}

/** Users the dispatcher should run for: someone watching a company, or targeting a role. */
export async function watchUserIds(limit = 5_000): Promise<string[]> {
    const [watchers, profiles] = await Promise.all([
        prisma.watchedCompany.findMany({ where: { status: WatchStatus.watching }, distinct: ['userId'], select: { userId: true }, take: limit }),
        // `preferences` is JSON; the role check is a cheap in-memory filter.
        prisma.userProfile.findMany({ where: { preferences: { not: Prisma.DbNull } }, select: { userId: true, preferences: true }, take: limit }),
    ]);
    const ids = new Set(watchers.map((row) => row.userId));
    for (const profile of profiles) {
        const roles = (profile.preferences as { targetRoles?: unknown } | null)?.targetRoles;
        if (Array.isArray(roles) && roles.length > 0) ids.add(profile.userId);
    }
    return [...ids];
}

function recordTitles(record: { defaultTitle: string; lines: Array<{ source: string }> }): string[] {
    // Experience lines are sourced "Role at Company"; the role is the title.
    const roles = record.lines
        .filter((line) => line.source.includes(' at '))
        .map((line) => line.source.split(' at ')[0].trim())
        .filter((title) => title && title.length <= 80);
    return [...new Set([record.defaultTitle, ...roles].filter(Boolean))].slice(0, 4);
}

export async function runWatchForUser(userId: string, deps: WatchDeps = {}): Promise<WatchRunResult> {
    const now = deps.now ?? new Date();
    const result: WatchRunResult = { refreshed: 0, considered: 0, shortlisted: 0, scored: 0, rechecked: 0, qualified: 0, errors: 0, deferred: 0, alert: null };
    const clock = deps.clock ?? Date.now;
    const outOfTime = (): boolean => deps.deadline !== undefined && deps.deadline.getTime() - clock() < ALERT_RESERVE_MS;
    if (!(await isEnabled(userId, 'job_watch'))) return { ...result, skipped: 'flag_off' };

    const [watched, { record, prefs }, tier] = await Promise.all([
        prisma.watchedCompany.findMany({
            where: { userId, status: WatchStatus.watching, sourceId: { not: null } },
            select: { sourceId: true, source: { select: { lastFetchedAt: true, status: true } } },
        }),
        loadFitSources(userId),
        getUserTier(userId),
    ]);
    if (record.empty) return { ...result, skipped: 'empty_record' };
    const watchedIds = new Set(watched.flatMap((row) => (row.sourceId ? [row.sourceId] : [])));
    const broad = prefs.targetRoles.length > 0;
    if (watchedIds.size === 0 && !broad) return { ...result, skipped: 'nothing_to_watch' };

    // 1. Refresh. The night's ingest children are staggered and may not have
    //    reached these boards yet; a user's own companies must not lag a day.
    const refresh = deps.refresh ?? ingestOne;
    const stale = watched
        .filter((row) => row.source && row.source.status !== 'inactive'
            && (!row.source.lastFetchedAt || now.getTime() - row.source.lastFetchedAt.getTime() > FRESH_BOARD_MS))
        .slice(0, MAX_INLINE_REFRESH);
    for (const row of stale) {
        if (outOfTime()) break;
        try {
            await refresh(row.sourceId!);
            result.refreshed += 1;
        } catch (error) {
            console.warn('[watch] refresh failed; scoring what we have', { sourceId: row.sourceId, error: String(error) });
        }
    }

    // 2. Retries first: a fallback-scored match deserves a proper look before new ones.
    const budget = jobWatchNightlyScoreLimit(tier);
    const retries = await prisma.jobMatch.findMany({
        where: { userId, matchedVia: 'fallback', attempts: { lt: MAX_ATTEMPTS }, status: JobMatchStatus.new, posting: { closedAt: null } },
        select: { postingId: true, origin: true },
        take: budget,
    });

    // 2b. Re-checks: near-misses held against an older record. A Win the
    //     user confirmed yesterday, or a location they finally stated, is
    //     exactly what turns an 82 into an 88; without this, a held job stays
    //     held forever.
    const recordKey = recordKeyFor(record, prefs);
    const oldest = new Date(now.getTime() - ALERT_MAX_AGE_DAYS * 86_400_000);
    const rechecks = await prisma.jobMatch.findMany({
        where: {
            userId,
            qualifies: false,
            status: JobMatchStatus.new,
            matchedVia: { in: ['model', 'deterministic'] },
            score: { gte: RECHECK_MIN_SCORE },
            OR: [{ recordKey: null }, { recordKey: { not: recordKey } }],
            posting: { closedAt: null, OR: [{ postedAt: { gte: oldest } }, { postedAt: null }] },
        },
        orderBy: { score: 'desc' },
        select: { postingId: true, origin: true },
        take: Math.max(0, budget - retries.length),
    });

    // 3. Shortlist the postings this user has never been scored on.
    const since = new Date(now.getTime() - CANDIDATE_WINDOW_DAYS * 86_400_000);
    const fresh = await prisma.jobPosting.findMany({
        where: {
            closedAt: null,
            OR: [{ postedAt: { gte: since } }, { postedAt: null, createdAt: { gte: since } }],
            ...(broad ? {} : { sourceId: { in: [...watchedIds] } }),
            matches: { none: { userId } },
        },
        orderBy: { createdAt: 'desc' },
        take: 3_000,
        select: { id: true, sourceId: true, title: true, location: true, skills: true },
    });
    result.considered = fresh.length;
    const postings: CandidatePosting[] = fresh.map((row) => ({
        id: row.id,
        sourceId: row.sourceId,
        title: row.title,
        location: row.location,
        skills: Array.isArray(row.skills) ? (row.skills as unknown[]).filter((skill): skill is string => typeof skill === 'string') : [],
    }));
    const { candidates } = shortlist({
        postings,
        watchedSourceIds: watchedIds,
        profile: {
            targetRoles: prefs.targetRoles,
            targetLocations: prefs.targetLocations,
            preferredWorkModes: prefs.preferredWorkModes,
            recordTitles: recordTitles(record),
            corpus: record.corpus,
        },
        limit: Math.max(0, budget - retries.length - rechecks.length),
    });
    result.shortlisted = candidates.length;

    // 4. Score and gate, one posting at a time. A failure on one posting
    //    leaves no row, so it is simply a candidate again tomorrow.
    const queue = [
        ...retries.map((row) => ({ postingId: row.postingId, origin: row.origin, recheck: false })),
        ...rechecks.map((row) => ({ postingId: row.postingId, origin: row.origin, recheck: true })),
        ...candidates.map((candidate) => ({ postingId: candidate.posting.id, origin: candidate.origin, recheck: false })),
    ];
    const people = { left: MAX_PEOPLE_SEARCHES, step: deps.peopleStep === undefined ? watchPeopleStep(userId) : deps.peopleStep };
    for (const [index, item] of queue.entries()) {
        if (outOfTime()) {
            result.deferred = queue.length - index;
            console.warn('[watch] deadline near; alerting with what was scored', { userId, deferred: result.deferred });
            break;
        }
        try {
            const qualified = await scoreAndStore({ userId, postingId: item.postingId, origin: item.origin, record, prefs, recordKey, now, ai: deps.ai, people });
            result.scored += 1;
            if (item.recheck) result.rechecked += 1;
            if (qualified) result.qualified += 1;
        } catch (error) {
            result.errors += 1;
            console.warn('[watch] scoring failed; will retry tomorrow', { userId, postingId: item.postingId, error: String(error) });
        }
    }

    // 5. Alert.
    result.alert = await sendMorningAlert(userId, { now, send: deps.send });
    await track(userId, 'watch_run', {
        considered: result.considered, shortlisted: result.shortlisted, scored: result.scored, rechecked: result.rechecked,
        qualified: result.qualified, errors: result.errors, deferred: result.deferred, alerted: result.alert?.sent ?? 0,
    });
    return result;
}

async function scoreAndStore(params: {
    userId: string;
    postingId: string;
    origin: string;
    record: Awaited<ReturnType<typeof loadFitSources>>['record'];
    prefs: Awaited<ReturnType<typeof loadFitSources>>['prefs'];
    recordKey: string;
    now: Date;
    ai?: MatchAi;
    /** Web people-search allowance for this run, shared across its matches. */
    people?: { left: number; step: PeopleSearchStep | null };
}): Promise<boolean> {
    const posting = await prisma.jobPosting.findUnique({
        where: { id: params.postingId },
        select: {
            id: true, externalId: true, title: true, location: true, absoluteUrl: true, description: true, department: true,
            parsed: true, parsedKey: true, postedAt: true, closedAt: true,
            source: { select: { provider: true, boardToken: true, companyName: true } },
        },
    });
    if (!posting) return false;

    const scored = await scorePosting({ userId: params.userId, posting, record: params.record, prefs: params.prefs, ai: params.ai });

    let data: Omit<Prisma.JobMatchUncheckedCreateInput, 'userId' | 'postingId' | 'origin'>;
    if (scored.kind === 'unscorable') {
        data = { score: null, verdict: 'unknown', matchedVia: 'none', qualifies: false, holdReason: scored.reason, fit: {}, people: Prisma.DbNull };
    } else {
        const { evaluation, matchedVia } = scored;
        const gate = alertGate({
            fit: evaluation.fit,
            coverage: evaluation.coverage,
            matchedVia,
            questionOpen: evaluation.question !== null,
            postedAt: posting.postedAt,
            closed: posting.closedAt !== null,
            now: params.now,
        });
        // People are looked up only for what will be sent: it is the user's own
        // contacts, so there is no reason to compute it for a job they never see.
        let web: PeopleSearchStep | null = null;
        if (gate.qualifies && params.people?.step && params.people.left > 0) {
            params.people.left -= 1;
            web = params.people.step;
        }
        const people = gate.qualifies
            ? await findPeople({
                userId: params.userId, company: posting.source.companyName, role: posting.title, domain: scored.jd.domain,
                team: posting.department, web,
            })
            : null;
        data = {
            score: evaluation.fit.score,
            verdict: evaluation.fit.verdict,
            matchedVia,
            qualifies: gate.qualifies,
            holdReason: gate.qualifies ? null : gate.reason,
            fit: { ...evaluation.fit, coverage: evaluation.coverage } as unknown as Prisma.InputJsonValue,
            people: people ? (people as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        };
    }

    await prisma.jobMatch.upsert({
        where: { userId_postingId: { userId: params.userId, postingId: posting.id } },
        create: { userId: params.userId, postingId: posting.id, origin: params.origin, recordKey: params.recordKey, ...data },
        update: { ...data, recordKey: params.recordKey, attempts: { increment: 1 }, evaluatedAt: params.now },
    });
    return data.qualifies === true;
}

// ─────────────────────────────────────────────────────────────── alerting

export type AlertSenders = {
    /** With one row of buttons per job (`alertKeyboard`). */
    telegram: (chatId: string, text: string, keyboard: ChatButton[][]) => Promise<boolean>;
    whatsapp: (to: string, text: string) => Promise<boolean>;
    email: (userId: string, to: string, items: AlertItem[]) => Promise<boolean>;
};

const defaultSenders: AlertSenders = {
    async telegram(chatId, text, keyboard) {
        const sent = await sendTelegramMessageDetailed({
            chatId,
            text: escapeTelegramHtml(text),
            replyMarkup: keyboard.length ? { inline_keyboard: keyboard } : undefined,
        });
        return sent.ok;
    },
    async whatsapp(to, text) {
        // Outside Meta's 24-hour window a free-form message is refused; the
        // email fallback then takes it.
        const sent = await sendWhatsAppText(to, text);
        return sent.ok;
    },
    async email(userId, to, items) {
        const sent = await sendEmail({ userId, to, template: 'job_alert', data: { items, watchUrl: watchUrl() } });
        return sent.status === 'sent';
    },
};

export type AlertOutcome = { sent: number; channel: 'telegram' | 'whatsapp' | 'email' | null; reason?: string };

/**
 * Send what qualified and has not been sent, once.
 *
 * Claim-then-send: the rows are stamped `alertedAt` by a conditional update
 * BEFORE anything goes out, so a second run racing this one claims nothing.
 * If every channel fails the claim is released, and tomorrow tries again.
 */
export async function sendMorningAlert(userId: string, deps: { now?: Date; send?: AlertSenders } = {}): Promise<AlertOutcome> {
    const now = deps.now ?? new Date();
    const send = deps.send ?? defaultSenders;

    const pref = await prisma.emailPreference.findUnique({ where: { userId }, select: { jobAlerts: true } });
    if (pref && !pref.jobAlerts) return { sent: 0, channel: null, reason: 'opted_out' };

    const oldest = new Date(now.getTime() - ALERT_MAX_AGE_DAYS * 86_400_000);
    const pending = await prisma.jobMatch.findMany({
        where: {
            userId, qualifies: true, status: JobMatchStatus.new, alertedAt: null,
            posting: { closedAt: null, OR: [{ postedAt: { gte: oldest } }, { postedAt: null }] },
        },
        orderBy: { score: 'desc' },
        take: ALERT_POOL,
        select: { id: true },
    });
    if (pending.length === 0) return { sent: 0, channel: null, reason: 'nothing_new' };

    const ids = pending.map((row) => row.id);
    const claimed = await prisma.jobMatch.updateMany({ where: { id: { in: ids }, alertedAt: null }, data: { alertedAt: now } });
    if (claimed.count === 0) return { sent: 0, channel: null, reason: 'claimed_elsewhere' };

    const rows = await prisma.jobMatch.findMany({
        where: { id: { in: ids }, alertedAt: now },
        orderBy: { score: 'desc' },
        select: {
            id: true, score: true, fit: true, people: true,
            posting: {
                select: {
                    title: true, location: true, absoluteUrl: true, compCurrency: true, compLow: true, compHigh: true, compPeriod: true,
                    source: { select: { companyName: true } },
                },
            },
        },
    });
    const items = rows.flatMap((row) => {
        const fit = readFit(row.fit);
        if (!fit || row.score === null) return [];
        return [alertItem({
            matchId: row.id,
            title: row.posting.title,
            company: row.posting.source.companyName,
            location: row.posting.location,
            url: row.posting.absoluteUrl,
            score: row.score,
            fit,
            coverage: { mustCovered: fit.coverage?.mustCovered ?? fit.matched.length, mustTotal: fit.coverage?.mustTotal ?? fit.matched.length + fit.gaps.length },
            people: (row.people as NetworkData | null) ?? null,
            compensation: compText(row.posting),
        })];
    });

    const channel = await deliver(userId, items, send);
    const claimedIds = rows.map((row) => row.id);
    if (!channel) {
        await prisma.jobMatch.updateMany({ where: { id: { in: claimedIds }, alertedAt: now }, data: { alertedAt: null } });
        return { sent: 0, channel: null, reason: 'no_channel_delivered' };
    }
    await prisma.jobMatch.updateMany({ where: { id: { in: claimedIds } }, data: { status: JobMatchStatus.alerted } });
    await track(userId, 'watch_alert_sent', { channel, count: items.length });
    return { sent: items.length, channel };
}

function compText(posting: { compCurrency: string | null; compLow: number | null; compHigh: number | null; compPeriod: string | null }): string | null {
    if (!posting.compCurrency || posting.compLow === null || posting.compHigh === null) return null;
    const format = (value: number) => value.toLocaleString('en-US');
    // Exactly as disclosed: no conversion, no rounding to "k".
    return `${posting.compCurrency} ${format(posting.compLow)}–${format(posting.compHigh)}${posting.compPeriod ? ` per ${posting.compPeriod}` : ''}`;
}

async function deliver(userId: string, items: AlertItem[], send: AlertSenders): Promise<AlertOutcome['channel']> {
    if (items.length === 0) return null;
    const text = renderChatAlert(items, watchUrl());
    const identities = await prisma.channelIdentity.findMany({
        where: { userId, verified: true, channel: { in: [Channel.telegram, Channel.whatsapp] } },
        select: { channel: true, externalId: true },
    });
    const telegram = identities.find((identity) => identity.channel === Channel.telegram);
    // On Telegram the buttons do the work, so the text drops its trailing
    // "draft outreach, track or pass" line in favour of them.
    const telegramText = renderChatAlert(items, watchUrl(), { buttons: true });
    if (telegram && (await send.telegram(telegram.externalId, telegramText, alertKeyboard(items)).catch(() => false))) return 'telegram';
    const whatsapp = identities.find((identity) => identity.channel === Channel.whatsapp);
    if (whatsapp && (await send.whatsapp(whatsapp.externalId, text).catch(() => false))) return 'whatsapp';

    const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { email: true } });
    if (profile?.email && (await send.email(userId, profile.email, items).catch(() => false))) return 'email';
    return null;
}
