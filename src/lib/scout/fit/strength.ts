import type { FitData } from '@/lib/scout/types';

/** Degree / education requirements: true matches, but the weakest headline. */
const EDUCATION = /\b(degree|bachelor|master|b\.?\s?tech|m\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|graduat|diploma|phd|education|university|college)\b/i;

/**
 * The one match to lead with. What the user DID beats what they studied:
 * a live Eltropy run led with "B.Tech, IIT…" while a shipped-microservices
 * match sat further down the list. Direct beats partial; work beats degree.
 */
/** All matches, best headline first: direct work, partial work, then education. */
export function orderStrengths(matched: FitData['matched'] | undefined): FitData['matched'] {
    if (!matched?.length) return [];
    const rank = (match: FitData['matched'][number]) =>
        (EDUCATION.test(match.text) || EDUCATION.test(match.evidence) ? 2 : 0) + (match.strength === 'partial' ? 1 : 0);
    return [...matched].sort((a, b) => rank(a) - rank(b));
}

export function topStrength(matched: FitData['matched'] | undefined): FitData['matched'][number] | null {
    if (!matched?.length) return null;
    const direct = matched.filter((match) => match.strength !== 'partial');
    const isWork = (match: FitData['matched'][number]) => !EDUCATION.test(match.text) && !EDUCATION.test(match.evidence);
    return direct.find(isWork) ?? matched.find(isWork) ?? direct[0] ?? null;
}
