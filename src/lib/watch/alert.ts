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
export function renderChatAlert(items: readonly AlertItem[], watchUrl: string, opts: { buttons?: boolean } = {}): string {
    const shown = items.slice(0, ALERT_MAX_ITEMS);
    const blocks = shown.map((item, index) => {
        const lines = [
            `${index + 1}. ${item.title} · ${item.company}${item.location ? ` (${item.location})` : ''}`,
            `Match ${item.score} · evidence for ${item.mustCovered} of ${item.mustTotal} must-haves${item.compensation ? ` · ${item.compensation}` : ''}`,
        ];
        if (item.strongest) lines.push(`Why: "${item.strongest.requirement}" ← ${item.strongest.evidence}`);
        if (item.gap) lines.push(`Gap: ${item.gap}`);
        if (item.person) lines.push(`Talk to: ${item.person.name} (${item.person.why})${item.person.url ? ` ${item.person.url}` : ''}`);
        else if (item.searchLink) lines.push(`Find someone: ${item.searchLink.url}`);
        lines.push(item.url);
        return lines.join('\n');
    });
    return [
        headline(items.length),
        blocks.join('\n\n'),
        items.length > shown.length ? `+${items.length - shown.length} more on the page below.` : '',
        opts.buttons ? `Tap below to track, draft outreach or pass. All matches: ${watchUrl}` : `Draft outreach, track or pass on any of these: ${watchUrl}`,
    ].filter(Boolean).join('\n\n');
}

export function alertSubject(items: readonly AlertItem[]): string {
    if (items.length === 1) return `${items[0].title} at ${items[0].company}: match ${items[0].score}`;
    return `${items.length} new jobs you match 85% or more`;
}

// ──────────────────────────────────────────────────────────── chat buttons

/**
 * Telegram buttons, one row per job:
 *   jw:t:<matchId>   track it (onto the job board)
 *   jw:o:<matchId>   draft outreach (a full Scout run on the posting)
 *   jw:x:<matchId>   not for me (never shown again)
 *
 * Telegram caps `callback_data` at 64 bytes; a cuid is ~25. Ownership is
 * checked by the handler against the linked chat, never trusted from here.
 */
export const WATCH_ACTION_PREFIX = 'jw:';

const ACTION_CODE = { track: 't', outreach: 'o', pass: 'x' } as const;
export type WatchActionKind = keyof typeof ACTION_CODE;
export type WatchAction = { kind: WatchActionKind; matchId: string };

export function encodeWatchAction(kind: WatchActionKind, matchId: string): string {
    return `${WATCH_ACTION_PREFIX}${ACTION_CODE[kind]}:${matchId}`;
}

export function decodeWatchAction(data: string): WatchAction | null {
    const match = /^jw:([tox]):([a-z0-9]{1,40})$/i.exec(data);
    if (!match) return null;
    const kind = (Object.entries(ACTION_CODE).find(([, code]) => code === match[1])?.[0] ?? null) as WatchActionKind | null;
    return kind ? { kind, matchId: match[2] } : null;
}

export type ChatButton = { text: string; callback_data: string };

export function alertKeyboard(items: readonly AlertItem[]): ChatButton[][] {
    return items.slice(0, ALERT_MAX_ITEMS).map((item, index) => {
        const n = items.length > 1 ? ` ${index + 1}` : '';
        return [
            { text: `✓ Track${n}`, callback_data: encodeWatchAction('track', item.matchId) },
            { text: `✉ Outreach${n}`, callback_data: encodeWatchAction('outreach', item.matchId) },
            { text: `✕ Not for me${n}`, callback_data: encodeWatchAction('pass', item.matchId) },
        ];
    });
}

/**
 * The keyboard after an action settles. Tracking spends Track and Not-for-me
 * for that job (outreach is still useful); passing spends the whole row;
 * outreach can be asked again, so it spends nothing.
 */
export function withoutSpentWatchButtons(rows: ChatButton[][], action: WatchAction): ChatButton[][] {
    const spent = new Set(
        action.kind === 'track'
            ? [encodeWatchAction('track', action.matchId), encodeWatchAction('pass', action.matchId)]
            : action.kind === 'pass'
                ? (['track', 'outreach', 'pass'] as const).map((kind) => encodeWatchAction(kind, action.matchId))
                : [],
    );
    return rows.map((row) => row.filter((button) => !spent.has(button.callback_data))).filter((row) => row.length > 0);
}
