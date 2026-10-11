/**
 * Which new postings are worth scoring tonight (PRD 12 §4). Pure, no model.
 *
 * The full fit check costs a model call per posting per user, so it runs on a
 * shortlist. This file builds the shortlist the way a friend skimming a job
 * board would: is it the kind of role you do, is it somewhere you would work,
 * and how much of what it names do you already have.
 *
 * A posting that fails here gets no `JobMatch` row and is looked at again
 * tomorrow (cheaply, in code). Recording it would be cheaper still, but it
 * would also freeze tonight's preferences: a user who adds "Remote" next week
 * should see the remote roles that were already open.
 */

import { classifyFamily, classifySeniority } from '@/lib/radar/role';
import { findMatchedSkills } from '@/lib/extension/fitScore';
import { placeMatches } from '@/lib/scout/fit/evaluate';

export type CandidatePosting = {
    id: string;
    sourceId: string;
    title: string;
    location: string | null;
    skills: string[];
};

export type CandidateProfile = {
    /** Stated target roles. Empty means "not stated". */
    targetRoles: string[];
    /** Stated places. Empty means "not stated", never "anywhere". */
    targetLocations: string[];
    preferredWorkModes: Array<'remote' | 'hybrid' | 'onsite'>;
    /** Titles the record shows (profile headline, recent roles), for when no target role is stated. */
    recordTitles: string[];
    /** `FitRecord.corpus`. */
    corpus: string;
};

export type Candidate = {
    posting: CandidatePosting;
    origin: 'watchlist' | 'preferences';
    /** Share of the posting's named skills found in the record, 0–1. Ordering only. */
    skillOverlap: number;
    /** Title relevance, 0–1. */
    roleMatch: number;
};

export type Rejection = 'role' | 'location' | 'level';

function tokens(value: string): string[] {
    return value.toLowerCase().split(/[^a-z0-9+#]+/).filter((token) => token.length >= 2);
}

/** Words that say nothing about what the job is. */
const NOISE = new Set(['senior', 'sr', 'junior', 'jr', 'staff', 'principal', 'lead', 'ii', 'iii', 'iv', 'i', 'the', 'and', 'of', 'for', 'with']);

/**
 * How well a posting's title fits a set of roles, 0–1.
 * Best of: the share of a role's meaningful words found in the title, and 0.7
 * for the same known family ("SDE II" and "Backend Engineer" are both
 * software engineering, which word overlap alone misses).
 */
export function roleMatch(title: string, roles: readonly string[]): number {
    const titleTokens = new Set(tokens(title));
    const titleFamily = classifyFamily(title);
    let best = 0;
    for (const role of roles) {
        const meaningful = tokens(role).filter((token) => !NOISE.has(token));
        if (meaningful.length > 0) {
            best = Math.max(best, meaningful.filter((token) => titleTokens.has(token)).length / meaningful.length);
        }
        const family = classifyFamily(role);
        if (family !== 'unknown' && family === titleFamily) best = Math.max(best, 0.7);
    }
    return best;
}

const REMOTE = /\bremote\b|\bwork from home\b|\banywhere\b/i;

/**
 * Could the user work here? Unknown locations pass: the fit check reads the
 * description and asks, which is better than dropping a real match on a
 * missing field.
 */
export function locationAcceptable(location: string | null, profile: Pick<CandidateProfile, 'targetLocations' | 'preferredWorkModes'>): boolean {
    if (!location || !location.trim()) return true;
    if (profile.targetLocations.length === 0) return true;
    const remoteOk = profile.preferredWorkModes.length === 0 || profile.preferredWorkModes.includes('remote')
        || profile.targetLocations.some((place) => REMOTE.test(place));
    if (REMOTE.test(location) && remoteOk) return true;
    return placeMatches(location, profile.targetLocations);
}

/** Interns and directors are different searches; anything else the fit check judges. */
function levelAcceptable(title: string, roles: readonly string[]): boolean {
    const seniority = classifySeniority(title);
    if (seniority === 'intern') return roles.some((role) => /\bintern/i.test(role));
    if (seniority === 'director_plus') return roles.some((role) => classifySeniority(role) === 'director_plus');
    return true;
}

/** The record's own titles stand in for unstated target roles, but only when they name a family. */
function rolesToMatch(profile: CandidateProfile): string[] {
    if (profile.targetRoles.length) return profile.targetRoles;
    return profile.recordTitles.filter((title) => classifyFamily(title) !== 'unknown');
}

/**
 * Minimum title relevance. At a watched company the user already chose the
 * employer, so a looser bar; across every board, the title has to be clearly
 * theirs or the shortlist fills with near-misses.
 */
export const ROLE_MATCH_FLOOR = { watchlist: 0.5, preferences: 0.7 } as const;

export function screenPosting(
    posting: CandidatePosting,
    profile: CandidateProfile,
    watched: boolean,
): { ok: true; candidate: Candidate } | { ok: false; reason: Rejection } {
    const roles = rolesToMatch(profile);
    const origin = watched ? 'watchlist' : 'preferences';
    // With no role at all we cannot tell a fit from noise. A watched company's
    // postings still go through; across all boards, nothing does.
    const match = roles.length ? roleMatch(posting.title, roles) : watched ? 0.5 : 0;
    if (match < ROLE_MATCH_FLOOR[origin]) return { ok: false, reason: 'role' };
    if (!levelAcceptable(posting.title, roles)) return { ok: false, reason: 'level' };
    if (!locationAcceptable(posting.location, profile)) return { ok: false, reason: 'location' };

    const skills = posting.skills.filter(Boolean);
    const skillOverlap = skills.length ? findMatchedSkills(skills, profile.corpus).length / skills.length : 0;
    return { ok: true, candidate: { posting, origin, skillOverlap, roleMatch: match } };
}

/**
 * Screen and rank. Watched companies first (the user named them), then by
 * title relevance and skill overlap together.
 */
export function shortlist(params: {
    postings: readonly CandidatePosting[];
    watchedSourceIds: ReadonlySet<string>;
    profile: CandidateProfile;
    limit: number;
}): { candidates: Candidate[]; screenedOut: Record<Rejection, number> } {
    const screenedOut: Record<Rejection, number> = { role: 0, location: 0, level: 0 };
    const passed: Candidate[] = [];
    for (const posting of params.postings) {
        const result = screenPosting(posting, params.profile, params.watchedSourceIds.has(posting.sourceId));
        if (result.ok) passed.push(result.candidate);
        else screenedOut[result.reason] += 1;
    }
    passed.sort((a, b) => {
        if (a.origin !== b.origin) return a.origin === 'watchlist' ? -1 : 1;
        return (b.roleMatch + b.skillOverlap) - (a.roleMatch + a.skillOverlap);
    });
    return { candidates: passed.slice(0, Math.max(0, params.limit)), screenedOut };
}
