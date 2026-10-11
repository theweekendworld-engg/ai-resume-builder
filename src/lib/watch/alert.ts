/**
 * The morning message (PRD 12 §6). Pure rendering; sending lives in
 * `src/services/jobWatch.ts`.
 *
 * Written by code from the computed fit, never by a model: every number in it
 * is one `scoreFit` produced, every "why" is a requirement next to the user's
 * own line that answers it, and nothing can read warmer than the numbers.
 */

import type { FitData, NetworkData } from '@/lib/scout/types';

/** At most this many jobs per message. A fourth is a list, not a tip. */
export const ALERT_MAX_ITEMS = 3;

export type AlertItem = {
    matchId: string;
    title: string;
    company: string;
    location: string | null;
    url: string;
    score: number;
    mustCovered: number;
    mustTotal: number;
    /** The strongest matched requirement, with the user's own evidence. */
    strongest: { requirement: string; evidence: string } | null;
    /** The most important gap left, if any. Minor by construction (the gate drops blocking ones). */
    gap: string | null;
    /** The first person worth contacting, if the user has one. */
    person: { name: string; why: string; url: string | null } | null;
    /** A people search to fall back on when they have no one. */
    searchLink: { label: string; url: string } | null;
    compensation: string | null;
};

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

/** Build the item for one match from what was stored when it was scored. */
export function alertItem(params: {
    matchId: string;
    title: string;
    company: string;
    location: string | null;
    url: string;
    score: number;
    fit: Pick<FitData, 'matched' | 'gaps'>;
    coverage: { mustCovered: number; mustTotal: number };
    people: NetworkData | null;
    compensation: string | null;
}): AlertItem {
    const direct = params.fit.matched.find((match) => match.strength === 'direct') ?? params.fit.matched[0] ?? null;
    const target = params.people?.targets[0] ?? null;
    const search = params.people?.searchLinks[0] ?? null;
    return {
        matchId: params.matchId,
        title: params.title,
        company: params.company,
        location: params.location,
        url: params.url,
        score: params.score,
        mustCovered: params.coverage.mustCovered,
        mustTotal: params.coverage.mustTotal,
        strongest: direct ? { requirement: clip(direct.text, 90), evidence: clip(direct.evidence, 120) } : null,
        gap: params.fit.gaps[0] ? clip(params.fit.gaps[0].text, 90) : null,
        person: target ? { name: target.fullName, why: clip(target.why, 90), url: target.profileUrl } : null,
        searchLink: target ? null : search,
        compensation: params.compensation,
    };
}

function headline(count: number): string {
    return count === 1 ? 'A new job you match 85% or more:' : `${count} new jobs you match 85% or more:`;
}

/**
 * Plain text for Telegram and WhatsApp. Both link bare URLs on their own, and
 * plain text survives either app's formatting rules unchanged.
 */
export function renderChatAlert(items: readonly AlertItem[], watchUrl: string): string {
    const shown = items.slice(0, ALERT_MAX_ITEMS);
    const blocks = shown.map((item, index) => {
        const lines = [
            `${index + 1}. ${item.title} · ${item.company}${item.location ? ` (${item.location})` : ''}`,
            `Match ${item.score} · evidence for ${item.mustCovered} of ${item.mustTotal} must-haves${item.compensation ? ` · ${item.compensation}` : ''}`,
        ];
        if (item.strongest) lines.push(`Why: "${item.strongest.requirement}" ← ${item.strongest.evidence}`);
        if (item.gap) lines.push(`Gap: ${item.gap}`);
        if (item.person) lines.push(`Talk to: ${item.person.name} (${item.person.why})`);
        else if (item.searchLink) lines.push(`Find someone: ${item.searchLink.url}`);
        lines.push(item.url);
        return lines.join('\n');
    });
    return [
        headline(items.length),
        blocks.join('\n\n'),
        items.length > shown.length ? `+${items.length - shown.length} more on the page below.` : '',
        `Draft outreach, track or pass on any of these: ${watchUrl}`,
    ].filter(Boolean).join('\n\n');
}

export function alertSubject(items: readonly AlertItem[]): string {
    if (items.length === 1) return `${items[0].title} at ${items[0].company}: match ${items[0].score}`;
    return `${items.length} new jobs you match 85% or more`;
}
