import { describe, expect, test } from 'bun:test';
import type { InterviewLink } from '@/lib/scout/types';
import {
    charCount,
    domainOf,
    draftClipboardText,
    formatCount,
    formatLatency,
    groupInterviewLinks,
    isLive,
    provenanceLabel,
    relativeTime,
    safeHref,
    sectionReason,
    sectionState,
    splitList,
} from './format';

describe('links', () => {
    test('domainOf strips www/m and lowercases', () => {
        expect(domainOf('https://www.Reddit.com/r/cscareerquestions/x')).toBe('reddit.com');
        expect(domainOf('https://in.linkedin.com/jobs/view/1')).toBe('linkedin.com');
        expect(domainOf('not a url')).toBe('');
        expect(domainOf(null)).toBe('');
    });

    test('safeHref refuses non-web schemes', () => {
        expect(safeHref('javascript:alert(1)')).toBeNull();
        expect(safeHref('data:text/html,hi')).toBeNull();
        expect(safeHref('https://levels.fyi/x')).toBe('https://levels.fyi/x');
        expect(safeHref('')).toBeNull();
    });
});

describe('time', () => {
    const now = new Date('2026-09-23T12:00:00Z');
    test('relative buckets', () => {
        expect(relativeTime('2026-09-23T11:59:30Z', now)).toBe('less than a minute ago');
        expect(relativeTime('2026-09-23T11:56:00Z', now)).toBe('4 min ago');
        expect(relativeTime('2026-09-23T09:00:00Z', now)).toBe('3 h ago');
        expect(relativeTime('2026-09-21T12:00:00Z', now)).toBe('2 d ago');
        expect(relativeTime('2026-03-04T12:00:00Z', now)).toBe('Mar 4, 2026');
    });
    test('never says "just now" and tolerates junk', () => {
        expect(relativeTime('garbage', now)).toBe('');
        expect(relativeTime(null, now)).toBe('');
    });
});

describe('observability formatting', () => {
    test('latency', () => {
        expect(formatLatency(840)).toBe('840 ms');
        expect(formatLatency(12_400)).toBe('12 s');
        expect(formatLatency(2_450)).toBe('2.5 s');
        expect(formatLatency(null)).toBe('');
    });


    test('isLive only while the run can change on its own', () => {
        expect(isLive('queued')).toBe(true);
        expect(isLive('running')).toBe(true);
        expect(isLive('awaiting_input')).toBe(false);
        expect(isLive('partial')).toBe(false);
    });
});

describe('sections', () => {
    const at = '2026-09-23T00:00:00Z';
    test('missing is pending; reasons come through verbatim', () => {
        expect(sectionState(undefined)).toBe('pending');
        expect(sectionReason({ status: 'unavailable', reason: 'No search provider configured', sources: [], finishedAt: at }))
            .toBe('No search provider configured');
        expect(sectionReason({ status: 'ok', data: {}, sources: [], finishedAt: at })).toBeNull();
        expect(sectionReason({ status: 'needs_input', question: { id: 'q', step: 'fit', prompt: 'Relocate?' }, finishedAt: at }))
            .toBe('Relocate?');
    });
});

describe('drafts', () => {
    test('connection notes are held to 300 characters', () => {
        expect(charCount('x'.repeat(300), 'linkedin_note')).toEqual({ count: 300, limit: 300, over: false });
        expect(charCount('x'.repeat(301), 'linkedin_note').over).toBe(true);
        expect(charCount('x'.repeat(5000), 'email')).toEqual({ count: 5000, limit: null, over: false });
    });

    test('emails carry the subject into the clipboard', () => {
        expect(draftClipboardText({ format: 'email', subject: 'Hello', body: 'Body' })).toBe('Subject: Hello\n\nBody');
        expect(draftClipboardText({ format: 'linkedin_note', subject: 'ignored', body: 'Body' })).toBe('Body');
    });
});

describe('interview grouping', () => {
    const link = (source: InterviewLink['source'], publishedAt: string | null, title: string): InterviewLink => ({
        url: `https://example.com/${title}`,
        title,
        source,
        publishedAt,
        snippet: '',
        relevance: '',
    });

    test('stable source order, newest first, undated last', () => {
        const groups = groupInterviewLinks([
            link('reddit', '2026-01-01', 'old'),
            link('youtube', null, 'yt'),
            link('reddit', null, 'undated'),
            link('reddit', '2026-08-01', 'new'),
            link('leetcode', '2026-05-01', 'lc'),
        ]);
        expect(groups.map((group) => group.source)).toEqual(['leetcode', 'reddit', 'youtube']);
        expect(groups[1].links.map((item) => item.title)).toEqual(['new', 'old', 'undated']);
    });
});

describe('company & settings helpers', () => {
    test('provenance labels', () => {
        expect(provenanceLabel('provider:peopledatalabs')).toBe('peopledatalabs');
        expect(provenanceLabel('job_page')).toBe('from the job page');
        expect(provenanceLabel('https://www.crunchbase.com/x')).toBe('crunchbase.com');
        expect(provenanceLabel(null)).toBe('');
    });

    test('formatCount is locale-independent', () => {
        expect(formatCount(1234567)).toBe('1,234,567');
        expect(formatCount(null)).toBe('');
    });

    test('splitList dedupes case-insensitively and caps', () => {
        expect(splitList('Backend Engineer, backend engineer ,SDE II\n\n Staff ')).toEqual(['Backend Engineer', 'SDE II', 'Staff']);
        expect(splitList(Array.from({ length: 12 }, (_, i) => `r${i}`).join(','))).toHaveLength(8);
    });
});
