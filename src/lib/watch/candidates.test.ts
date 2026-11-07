import { describe, expect, test } from 'bun:test';
import { locationAcceptable, roleMatch, screenPosting, shortlist, type CandidatePosting, type CandidateProfile } from './candidates';

const profile: CandidateProfile = {
    targetRoles: ['Backend Engineer'],
    targetLocations: ['Bengaluru'],
    preferredWorkModes: ['hybrid', 'remote'],
    recordTitles: ['Software Engineer'],
    corpus: 'go postgresql kafka distributed systems payments',
};

let n = 0;
const posting = (over: Partial<CandidatePosting> = {}): CandidatePosting => ({
    id: `p${(n += 1)}`,
    sourceId: 'stripe',
    title: 'Senior Backend Engineer',
    location: 'Bengaluru, India',
    skills: ['go', 'postgresql', 'rust'],
    ...over,
});

describe('roleMatch', () => {
    test('word overlap ignores level words', () => {
        expect(roleMatch('Senior Backend Engineer, Payments', ['Backend Engineer'])).toBe(1);
    });
    test('same family counts when the words differ', () => {
        expect(roleMatch('Software Development Engineer II', ['Backend Engineer'])).toBeGreaterThanOrEqual(0.7);
    });
    test('a different job scores low', () => {
        expect(roleMatch('Accounts Payable Manager', ['Backend Engineer'])).toBeLessThan(0.5);
    });
});

describe('locationAcceptable: remote with a region', () => {
    test('"Remote - US" is not a remote role for someone who only wants Bengaluru', () => {
        expect(locationAcceptable('Remote - US', profile)).toBe(false);
        expect(locationAcceptable('US Remote', profile)).toBe(false);
        expect(locationAcceptable('Remote - India', profile)).toBe(true);
        expect(locationAcceptable('Remote', profile)).toBe(true);
    });
    test('a target in the region, or places that cannot be placed, still pass', () => {
        expect(locationAcceptable('Remote - US', { ...profile, targetLocations: ['Bengaluru', 'San Francisco'] })).toBe(true);
        expect(locationAcceptable('Remote - US', { ...profile, targetLocations: ['Remote'] })).toBe(true);
    });
});

describe('locationAcceptable', () => {
    test('unknown or unstated passes; the fit check asks', () => {
        expect(locationAcceptable(null, profile)).toBe(true);
        expect(locationAcceptable('Pune', { targetLocations: [], preferredWorkModes: [] })).toBe(true);
    });
    test('remote passes when remote is acceptable', () => {
        expect(locationAcceptable('Remote - India', profile)).toBe(true);
        expect(locationAcceptable('Remote - India', { targetLocations: ['Bengaluru'], preferredWorkModes: ['onsite'] })).toBe(false);
    });
    test('another city is screened out', () => {
        expect(locationAcceptable('Gurugram, India', profile)).toBe(false);
        expect(locationAcceptable('Bangalore', profile)).toBe(true);
    });
});

describe('screenPosting', () => {
    test('interns and directors are other searches', () => {
        expect(screenPosting(posting({ title: 'Backend Engineering Intern' }), profile, true)).toEqual({ ok: false, reason: 'level' });
    });
    test('watched companies get a looser role bar than the open market', () => {
        const title = 'Platform Engineer';
        expect(roleMatch(title, profile.targetRoles)).toBeGreaterThanOrEqual(0.5);
        expect(screenPosting(posting({ title }), profile, true).ok).toBe(true);
    });
    test('with no stated or recorded role, only watched companies pass', () => {
        const blank = { ...profile, targetRoles: [], recordTitles: [] };
        expect(screenPosting(posting(), blank, true).ok).toBe(true);
        expect(screenPosting(posting(), blank, false)).toEqual({ ok: false, reason: 'role' });
    });
});

describe('shortlist', () => {
    test('watched first, then relevance, capped', () => {
        const market = posting({ sourceId: 'other', title: 'Backend Engineer', skills: ['go', 'postgresql'] });
        const watched = posting({ sourceId: 'stripe', title: 'Backend Engineer', skills: ['rust'] });
        const offTarget = posting({ title: 'Recruiter' });
        const { candidates, screenedOut } = shortlist({ postings: [market, watched, offTarget], watchedSourceIds: new Set(['stripe']), profile, limit: 5 });
        expect(candidates.map((c) => c.posting.id)).toEqual([watched.id, market.id]);
        expect(candidates[0].origin).toBe('watchlist');
        expect(screenedOut.role).toBe(1);
        expect(shortlist({ postings: [market, watched], watchedSourceIds: new Set(['stripe']), profile, limit: 1 }).candidates).toHaveLength(1);
    });
});
