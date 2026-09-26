import { describe, expect, test } from 'bun:test';
import type { JobBoardItem } from '@/lib/inbox/types';
import {
    DEFAULT_STATE,
    boardFilters,
    groupByColumn,
    hrefFor,
    jobHref,
    parseInboxState,
    pipelineSummary,
    serializeInboxState,
    tabHref,
    tabLabel,
    toggle,
} from './params';

function item(overrides: Partial<JobBoardItem>): JobBoardItem {
    return {
        workspaceId: 'w',
        runId: null,
        company: 'Acme',
        role: 'SDE',
        location: null,
        workMode: null,
        fitScore: null,
        verdict: null,
        status: 'analyzed',
        column: 'to_review',
        sourceUrl: null,
        compHint: null,
        topStrength: null,
        topConcern: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
    };
}

describe('inbox URL state', () => {
    test('the default view has a clean URL', () => {
        expect(serializeInboxState(DEFAULT_STATE)).toBe('');
        expect(hrefFor(DEFAULT_STATE)).toBe('/scout');
    });

    test('filters round-trip through the URL', () => {
        const state = { ...DEFAULT_STATE, verdicts: ['strong', 'possible'] as const, workModes: ['remote'] as const, location: 'Bengaluru', sinceDays: 7 as const, sort: 'recent' as const };
        const query = serializeInboxState({ ...state, verdicts: [...state.verdicts], workModes: [...state.workModes] });
        const parsed = parseInboxState(new URLSearchParams(query));
        expect(parsed.verdicts).toEqual(['strong', 'possible']);
        expect(parsed.workModes).toEqual(['remote']);
        expect(parsed.location).toBe('Bengaluru');
        expect(parsed.sinceDays).toBe(7);
        expect(parsed.sort).toBe('recent');
    });

    test('garbage is dropped, not guessed at', () => {
        const parsed = parseInboxState({ tab: 'hax', verdict: 'great,strong,strong', mode: 'space', since: '9', sort: 'random' });
        expect(parsed.tab).toBe('jobs');
        expect(parsed.verdicts).toEqual(['strong']);
        expect(parsed.workModes).toEqual([]);
        expect(parsed.sinceDays).toBeNull();
        expect(parsed.sort).toBe('fit');
    });

    test('repeated params and Next-style arrays both parse', () => {
        expect(parseInboxState(new URLSearchParams('verdict=strong&verdict=stretch')).verdicts).toEqual(['strong', 'stretch']);
        expect(parseInboxState({ verdict: ['possible', 'not_a_fit'] }).verdicts).toEqual(['possible', 'not_a_fit']);
    });

    test('job filters are not carried onto another tab', () => {
        const state = { ...DEFAULT_STATE, verdicts: ['strong' as const], tab: 'insights' as const, tag: 'system design' };
        expect(serializeInboxState(state)).toBe('?tab=insights&tag=system+design');
        expect(tabHref('notes')).toBe('/scout?tab=notes');
    });

    test('board filters leave empty lists out', () => {
        expect(boardFilters(DEFAULT_STATE)).toEqual({ verdicts: undefined, workModes: undefined, location: null, sinceDays: null, sort: 'fit' });
    });

    test('toggle adds then removes', () => {
        expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
        expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
    });
});

describe('board grouping', () => {
    test('every column is present, in order, and keeps the service sort', () => {
        const groups = groupByColumn([
            item({ workspaceId: '1', status: 'analyzed', fitScore: 80 }),
            item({ workspaceId: '2', status: 'applied' }),
            item({ workspaceId: '3', status: 'discovered', fitScore: 40 }),
            item({ workspaceId: '4', status: 'archived' }),
            item({ workspaceId: '5', status: 'interview' }),
        ]);
        expect(groups.map((group) => group.column)).toEqual(['to_review', 'applied', 'interviewing', 'offer', 'closed']);
        expect(groups[0].items.map((i) => i.workspaceId)).toEqual(['1', '3']);
        expect(groups[3].items).toEqual([]);
        expect(groups[4].items.map((i) => i.workspaceId)).toEqual(['4']);
    });

    test('the column comes from the status, not a stale column field', () => {
        const groups = groupByColumn([item({ status: 'applied', column: 'to_review' })]);
        expect(groups.find((group) => group.column === 'applied')?.items).toHaveLength(1);
    });
});

describe('labels', () => {
    const counts = { toReview: 3, applied: 2, interviewing: 1, insights: 0, draftNotes: 4 };

    test('tab labels carry counts only when non-zero', () => {
        expect(tabLabel('jobs', counts)).toBe('Jobs · 6');
        expect(tabLabel('insights', counts)).toBe('Insights');
        expect(tabLabel('notes', counts)).toBe('Notes · 4');
        expect(tabLabel('companies', counts)).toBe('Companies');
        expect(tabLabel('jobs', null)).toBe('Jobs');
    });

    test('pipeline summary names only what exists', () => {
        expect(pipelineSummary(counts)).toBe('3 to review · 2 applied · 1 interviewing');
        expect(pipelineSummary({ ...counts, toReview: 0, applied: 0 })).toBe('1 interviewing');
    });

    test('a card opens its analysis, else the posting, else nothing', () => {
        expect(jobHref({ runId: 'r1', sourceUrl: 'https://x.com' })).toEqual({ href: '/scout/r1', external: false });
        expect(jobHref({ runId: null, sourceUrl: 'https://x.com/j' })).toEqual({ href: 'https://x.com/j', external: true });
        expect(jobHref({ runId: null, sourceUrl: 'scout:abc' })).toBeNull();
        expect(jobHref({ runId: null, sourceUrl: 'javascript:alert(1)' })).toBeNull();
    });
});
