import { describe, expect, test } from 'bun:test';
import { suggestionsFor } from './suggestions';
import type { ChatContext } from './types';

const base: ChatContext = { jobs: [], openQuestion: null, draftCount: 0, hasBaseResume: true, looking: { roles: [], locations: [], remote: false } };

describe('chat suggestions', () => {
    test('"find roles" uses the job-search preferences, not a hardcoded role', () => {
        const s = suggestionsFor({ ...base, looking: { roles: ['Product Designer'], locations: ['Bengaluru'], remote: false } });
        expect(s.find((x) => x.label.startsWith('Find'))?.message).toBe('Find Product Designer roles in Bengaluru');
        expect(JSON.stringify(s)).not.toContain('backend');
    });

    test('remote preference reads as remote', () => {
        const s = suggestionsFor({ ...base, looking: { roles: ['SDE II'], locations: [], remote: true } });
        expect(s.find((x) => x.label.startsWith('Find'))?.message).toBe('Find SDE II roles, remote');
    });

    test('no preferences, no invented role; no tracked job, no "Tailor for"', () => {
        const s = suggestionsFor(base);
        expect(s.find((x) => x.label.startsWith('Find'))?.message).toBe('Find open roles that fit me');
        expect(s.some((x) => x.label.startsWith('Tailor'))).toBe(false);
    });
});
