/**
 * Score one board posting for one user, the way Scout scores a shared link
 * (PRD 12 §4). Same reader, same matcher, same arithmetic — a job alerted at
 * 88 opens to a Scout card that says 88.
 *
 * Two model calls at most, and usually one:
 *
 *   READ   the posting into requirements (`readPosting`). Stored on the
 *          posting itself and keyed by its text, so every user it is scored
 *          for shares one read. Contains nothing about any user.
 *   MATCH  which line of THIS user's record answers which requirement. Per
 *          user, and skipped when code settles every requirement.
 *
 * No summary call: the morning message is written by code from the computed
 * fields, which is cheaper and cannot be warmer than the numbers.
 */

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { generateStructured } from '@/lib/ai/structured';
import { prisma } from '@/lib/prisma';
import { adapterFor } from '@/lib/radar/boards';
import { readPosting, type ReadPostingResult } from '@/lib/resume/posting';
import { evaluateFit, type FitEvaluation, type FitRecord } from '@/lib/scout/fit/evaluate';
import {
    detectEmploymentType,
    detectWorkMode,
    extractCompensationText,
    extractExperienceText,
    extractLocation,
} from '@/lib/scout/fit/jdSignals';
import { planMatching } from '@/lib/scout/fit/match';
import { matchRequirements, type MatchAi } from '@/lib/scout/sections/fit';
import type { JdData } from '@/lib/scout/types';
import type { UserGenerationPreferences } from '@/lib/userPreferences';
import type { MatchedVia } from '@/lib/watch/gate';

/** Bump when the posting prompt or its schema changes; every stored read is redone. */
export const WATCH_PARSE_VERSION = 'v1';

/** Below this there is nothing to read requirements out of (Scout's floor). */
const MIN_DESCRIPTION_CHARS = 200;

type Brief = ReadPostingResult['brief'];

export type ScorablePosting = {
    id: string;
    externalId: string;
    title: string;
    location: string | null;
    absoluteUrl: string;
    description: string | null;
    parsed: unknown;
    parsedKey: string | null;
    source: { provider: string; boardToken: string; companyName: string };
};

export type PostingScore =
    | {
        kind: 'scored';
        jd: JdData;
        evaluation: FitEvaluation;
        matchedVia: MatchedVia;
    }
    | { kind: 'unscorable'; reason: string };

/**
 * Fingerprint of everything a score depends on besides the posting: the
 * record's lines and years, and the preferences the checks read. Equal keys
 * mean re-scoring would give the same answer, so a held match is only
 * re-scored when this moves.
 */
export function recordKeyFor(record: FitRecord, prefs: UserGenerationPreferences): string {
    const material = JSON.stringify({
        lines: record.lines.map((line) => `${line.source}|${line.text}`),
        years: record.years,
        location: record.location,
        title: record.defaultTitle,
        prefs: [
            prefs.targetRoles, prefs.targetLocations, prefs.preferredWorkModes, prefs.willingToRelocate,
            prefs.requiresSponsorship, prefs.minCompensationText, prefs.companySizePreference,
        ],
    });
    return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

export function parsedKeyFor(description: string): string {
    return `${WATCH_PARSE_VERSION}:${createHash('sha256').update(description).digest('hex').slice(0, 32)}`;
}

/** The description, fetching it once for providers whose list omits it. */
async function descriptionOf(posting: ScorablePosting): Promise<string | null> {
    if (posting.description && posting.description.trim()) return posting.description;
    const adapter = adapterFor(posting.source.provider);
    if (!adapter?.fetchDescription) return null;
    const text = await adapter.fetchDescription({ boardToken: posting.source.boardToken, externalId: posting.externalId });
    if (text) {
        await prisma.jobPosting.update({ where: { id: posting.id }, data: { description: text } }).catch(() => {});
    }
    return text;
}

function isBrief(value: unknown): value is Brief {
    const brief = value as Brief | null;
    return Boolean(brief && Array.isArray(brief.requirements) && Array.isArray(brief.skills));
}

/** The read, from the posting row when current, else from the model (and stored). */
async function briefOf(posting: ScorablePosting, description: string, userId: string): Promise<Brief> {
    const key = parsedKeyFor(description);
    if (posting.parsedKey === key && isBrief(posting.parsed)) return posting.parsed;
    const read = await readPosting({ jobDescription: description, userId, feature: 'job_watch', task: 'scoutPostingRead' });
    await prisma.jobPosting
        .update({ where: { id: posting.id }, data: { parsed: read.brief as unknown as Prisma.InputJsonValue, parsedKey: key } })
        .catch((error: unknown) => console.warn('[watch] posting read not stored', { postingId: posting.id, error: String(error) }));
    return read.brief;
}

/** JdData from a board posting. The board's own fields outrank the model's reading. */
export function jdFromPosting(posting: ScorablePosting, brief: Brief, description: string): JdData {
    const location = posting.location ?? extractLocation(description);
    return {
        role: posting.title,
        company: posting.source.companyName,
        seniority: brief.seniority,
        domain: brief.domain,
        location,
        workMode: detectWorkMode({ location, title: posting.title, text: description }),
        employmentType: detectEmploymentType(description),
        compensationText: extractCompensationText(description),
        experienceText: extractExperienceText(description),
        requirements: brief.requirements.map((requirement) => ({ id: requirement.id, text: requirement.text, kind: requirement.kind })),
        skills: brief.skills,
        responsibilities: brief.responsibilities,
        applyUrl: posting.absoluteUrl || null,
    };
}

export async function scorePosting(params: {
    userId: string;
    posting: ScorablePosting;
    record: FitRecord;
    prefs: UserGenerationPreferences;
    /** Injected in tests. */
    ai?: MatchAi;
}): Promise<PostingScore> {
    const { userId, posting, record, prefs } = params;
    if (record.empty) return { kind: 'unscorable', reason: 'Your record is empty, so there is nothing to match against' };

    const description = await descriptionOf(posting);
    if (!description || description.trim().length < MIN_DESCRIPTION_CHARS) {
        return { kind: 'unscorable', reason: 'The posting has no description to read requirements from' };
    }

    const brief = await briefOf(posting, description, userId);
    const jd = jdFromPosting(posting, brief, description);
    if (jd.requirements.length === 0 && jd.skills.length === 0) {
        return { kind: 'unscorable', reason: 'No requirements could be read from this posting' };
    }

    const ai: MatchAi = params.ai ?? ((opts) => generateStructured({ ...opts, userId, feature: 'job_watch' }));
    const plan = planMatching(jd, record);
    const match = await matchRequirements(ai, plan, record, (message, extra) => console.info(`[watch] ${message}`, { postingId: posting.id, ...extra }));
    const evaluation = evaluateFit({
        jd,
        jdText: description,
        record,
        prefs,
        answers: {},
        plan,
        judgements: match.judgements,
        softIds: match.softIds,
    });
    const matchedVia: MatchedVia = match.via === 'model' ? 'model' : match.via === 'none' ? 'deterministic' : 'fallback';
    return { kind: 'scored', jd, evaluation, matchedVia };
}
