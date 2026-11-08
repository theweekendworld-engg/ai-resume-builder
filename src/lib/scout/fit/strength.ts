import type { FitData } from '@/lib/scout/types';

/** Degree / education requirements: true matches, but the weakest headline. */
const EDUCATION = /\b(degree|bachelor|master|b\.?\s?tech|m\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|graduat|diploma|phd|education|university|college)\b/i;

/**
 * Years-of-experience evidence: code-written from dates or the profile
 * ("About 4 years full-time (from your role dates)"). True, but it is time
 * served, not something done: "✓ 3 years of experience" led the Jobs list
 * for an engineer whose best line was an agent platform (QA 2026-11-07).
 */
const TENURE = /\((?:from your role dates|stated on your profile)\)/;

type Match = FitData['matched'][number];

function isTenure(match: Match): boolean {
    return TENURE.test(match.evidence);
}

/**
 * The one match to lead with. What the user DID beats what they studied:
 * a live Eltropy run led with "B.Tech, IIT…" while a shipped-microservices
 * match sat further down the list. Direct beats partial; work beats degree;
 * tenure comes last.
 */
/** All matches, best headline first: direct work, partial work, education, then tenure. */
export function orderStrengths(matched: FitData['matched'] | undefined): FitData['matched'] {
    if (!matched?.length) return [];
    const rank = (match: Match) =>
        (isTenure(match) ? 4 : 0) + (EDUCATION.test(match.text) || EDUCATION.test(match.evidence) ? 2 : 0) + (match.strength === 'partial' ? 1 : 0);
    return [...matched].sort((a, b) => rank(a) - rank(b));
}

export function topStrength(matched: FitData['matched'] | undefined): Match | null {
    if (!matched?.length) return null;
    const direct = matched.filter((match) => match.strength !== 'partial');
    const isWork = (match: Match) => !isTenure(match) && !EDUCATION.test(match.text) && !EDUCATION.test(match.evidence);
    return direct.find(isWork) ?? matched.find(isWork) ?? direct.find((match) => !isTenure(match)) ?? direct[0] ?? null;
}
