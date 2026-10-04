/**
 * The career inbox's URL state: which tab, which filters. Pure — no React,
 * no server imports — so the server page and the client controls read and
 * write the same string, and a copied link reopens the same view.
 *
 * Unknown or malformed values are dropped, never guessed at: `?verdict=great`
 * shows everything rather than an empty board the user cannot explain.
 */

import {
    BOARD_COLUMNS,
    COLUMN_LABELS,
    COLUMN_OF_STATUS,
    type BoardColumn,
    type InboxCounts,
    type JobBoardFilters,
    type JobBoardItem,
} from '@/lib/inbox/types';
import type { FitVerdict, WorkMode } from '@/lib/scout/types';

export const INBOX_TABS = ['jobs', 'email', 'insights', 'companies', 'notes', 'activity'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export const TAB_LABELS: Record<InboxTab, string> = {
    jobs: 'Jobs',
    // Forwarded job email (docs/prd/11-job-journey.md); shown with `job_journey`.
    email: 'Email',
    insights: 'Insights',
    companies: 'Companies',
    notes: 'Notes',
    activity: 'Activity',
};

const VERDICTS: readonly FitVerdict[] = ['strong', 'possible', 'stretch', 'not_a_fit', 'unknown'];
const WORK_MODES: readonly WorkMode[] = ['remote', 'hybrid', 'onsite', 'unknown'];
export const SINCE_OPTIONS = [7, 30] as const;

/** What the inbox URL can say. Everything optional; absent means "all". */
export type InboxState = {
    tab: InboxTab;
    verdicts: FitVerdict[];
    workModes: WorkMode[];
    location: string;
    sinceDays: (typeof SINCE_OPTIONS)[number] | null;
    sort: 'fit' | 'recent';
    /** Insights tab: tag chip and search box. */
    tag: string;
    q: string;
};

export const DEFAULT_STATE: InboxState = {
    tab: 'jobs',
    verdicts: [],
    workModes: [],
    location: '',
    sinceDays: null,
    sort: 'fit',
    tag: '',
    q: '',
};

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function read(source: ParamSource, key: string): string[] {
    if (source instanceof URLSearchParams) return source.getAll(key);
    const value = source[key];
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}

/** `?verdict=strong,possible` and `?verdict=strong&verdict=possible` both work. */
function readList<T extends string>(source: ParamSource, key: string, allowed: readonly T[]): T[] {
    const values = read(source, key).flatMap((value) => value.split(','));
    const out: T[] = [];
    for (const value of values) {
        const trimmed = value.trim() as T;
        if (allowed.includes(trimmed) && !out.includes(trimmed)) out.push(trimmed);
    }
    return out;
}

function readText(source: ParamSource, key: string, max: number): string {
    return (read(source, key)[0] ?? '').trim().slice(0, max);
}

export function parseInboxState(source: ParamSource): InboxState {
    const tab = readText(source, 'tab', 20) as InboxTab;
    const since = Number(readText(source, 'since', 4));
    const sort = readText(source, 'sort', 10);
    return {
        tab: INBOX_TABS.includes(tab) ? tab : 'jobs',
        verdicts: readList(source, 'verdict', VERDICTS),
        workModes: readList(source, 'mode', WORK_MODES),
        location: readText(source, 'loc', 80),
        sinceDays: (SINCE_OPTIONS as readonly number[]).includes(since) ? (since as InboxState['sinceDays']) : null,
        sort: sort === 'recent' ? 'recent' : 'fit',
        tag: readText(source, 'tag', 60),
        q: readText(source, 'q', 120),
    };
}

/**
 * The query string for a state, omitting defaults so links stay short and a
 * default view has a clean URL (`/scout`, not `/scout?tab=jobs&sort=fit`).
 */
export function serializeInboxState(state: InboxState): string {
    const params = new URLSearchParams();
    if (state.tab !== DEFAULT_STATE.tab) params.set('tab', state.tab);
    if (state.tab === 'jobs') {
        if (state.verdicts.length) params.set('verdict', state.verdicts.join(','));
        if (state.workModes.length) params.set('mode', state.workModes.join(','));
        if (state.location) params.set('loc', state.location);
        if (state.sinceDays) params.set('since', String(state.sinceDays));
        if (state.sort !== DEFAULT_STATE.sort) params.set('sort', state.sort);
    }
    if (state.tab === 'insights') {
        if (state.tag) params.set('tag', state.tag);
        if (state.q) params.set('q', state.q);
    }
    const query = params.toString();
    return query ? `?${query}` : '';
}

export function hrefFor(state: InboxState, patch: Partial<InboxState> = {}): string {
    return `/scout${serializeInboxState({ ...state, ...patch })}`;
}

/** A tab link keeps no filters from another tab: they would mean nothing there. */
export function tabHref(tab: InboxTab): string {
    return hrefFor(DEFAULT_STATE, { tab });
}

/** The service's filter shape for the Jobs tab. */
export function boardFilters(state: InboxState): JobBoardFilters {
    return {
        verdicts: state.verdicts.length ? state.verdicts : undefined,
        workModes: state.workModes.length ? state.workModes : undefined,
        location: state.location || null,
        sinceDays: state.sinceDays,
        sort: state.sort,
    };
}

export function hasBoardFilters(state: InboxState): boolean {
    return state.verdicts.length > 0 || state.workModes.length > 0 || Boolean(state.location) || state.sinceDays !== null;
}

export function toggle<T>(list: readonly T[], value: T): T[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

// ────────────────────────────────────────────────────────────────── board

export type BoardGroup = { column: BoardColumn; label: string; items: JobBoardItem[] };

/**
 * Items into board columns, in column order, preserving the service's sort
 * within each column. The column is recomputed from `status` rather than
 * trusted from the item, so a stale `column` cannot put an applied job under
 * "To review".
 */
export function groupByColumn(items: readonly JobBoardItem[]): BoardGroup[] {
    const groups = new Map<BoardColumn, JobBoardItem[]>(BOARD_COLUMNS.map((column) => [column, []]));
    for (const item of items) {
        const column = COLUMN_OF_STATUS[item.status] ?? item.column;
        groups.get(column)?.push(item);
    }
    return BOARD_COLUMNS.map((column) => ({ column, label: COLUMN_LABELS[column], items: groups.get(column) ?? [] }));
}

// ───────────────────────────────────────────────────────────────── counts

/** Tab label with its count: "Jobs · 4". No count for tabs that have none. */
export function tabLabel(tab: InboxTab, counts: InboxCounts | null): string {
    const base = TAB_LABELS[tab];
    if (!counts) return base;
    const n =
        tab === 'jobs'
            ? counts.toReview + counts.applied + counts.interviewing
            : tab === 'insights'
              ? counts.insights
              : tab === 'notes'
                ? counts.draftNotes
                : 0;
    return n > 0 ? `${base} · ${n}` : base;
}

/** "3 to review · 2 applied · 1 interviewing" — only the non-zero parts. */
export function pipelineSummary(counts: InboxCounts | null): string {
    if (!counts) return '';
    return [
        counts.toReview ? `${counts.toReview} to review` : null,
        counts.applied ? `${counts.applied} applied` : null,
        counts.interviewing ? `${counts.interviewing} interviewing` : null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/** Where a job card should go when clicked: its analysis, else the posting. */
export function jobHref(item: Pick<JobBoardItem, 'runId' | 'sourceUrl'>): { href: string; external: boolean } | null {
    if (item.runId) return { href: `/scout/${item.runId}`, external: false };
    if (item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl)) return { href: item.sourceUrl, external: true };
    return null;
}
