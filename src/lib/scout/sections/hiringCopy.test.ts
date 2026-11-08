import { describe, expect, test } from 'bun:test';
import { bucketName, geographyName, hiringStatementFor, roleGeography } from './hiringCopy';

const WINDOW = { windowStart: '2026-05-11T00:00:00.000Z', windowEnd: '2026-11-07T00:00:00.000Z' };

describe('roleGeography: the role\'s own location, never a default', () => {
    test('a placed location, a scoped remote role, and nothing', () => {
        expect(roleGeography('Bengaluru, Karnataka, India', '')).toBe('india');
        expect(roleGeography('New York, NY', '')).toBe('us');
        expect(roleGeography('Remote - US', '')).toBe('us');
        // The QA post: no location field, "Remote, DMV preferred" in the text.
        expect(roleGeography(null, 'Remote, DMV preferred | $90/hr')).toBe('us');
        expect(roleGeography('Remote', 'Work from anywhere.')).toBeNull();
        expect(roleGeography(null, '')).toBeNull();
    });
});

describe('hiringStatementFor', () => {
    test('no postings: framed around the role\'s geography, with a proper name (QA 2026-11-07)', () => {
        const sentence = hiringStatementFor({ ok: false, geography: 'us', reason: 'no_postings', total: 0, placeable: 0, statement: '' } as never, 'us');
        expect(sentence).toBe('No postings from this company on the job boards we watch yet, so there is no read on its hiring in the US.');
        expect(sentence).not.toMatch(/\bINDIA\b|\bUS hiring\b/);
    });

    test('a role we cannot place gets only what is true without a geography', () => {
        expect(hiringStatementFor({ ok: false, geography: 'india', reason: 'no_postings', total: 0, placeable: 0, statement: '' } as never, null))
            .toBe('No postings from this company on the job boards we watch yet.');
        expect(hiringStatementFor({ ok: false, geography: 'india', reason: 'insufficient_for_absence', total: 9, placeable: 9, needed: 20, statement: '' } as never, null)).toBeNull();
        expect(hiringStatementFor(null, 'us')).toBeNull();
    });

    test('a hiring read keeps its numbers and names its buckets', () => {
        const sentence = hiringStatementFor({
            ok: true, geography: 'india', verdict: 'hires_there', matched: 6, placeable: 20, total: 24, share: 0.3, ...WINDOW,
            latestMatchAt: null, buckets: [{ bucket: 'bengaluru', n: 4 }, { bucket: 'remote_india', n: 2 }], citations: [], scope: 'observed_public_boards', statement: '',
        } as never, 'india');
        expect(sentence).toBe('Yes: 6 of 20 located roles on their public board in the last 180 days were in India: Bengaluru (4), Remote (India) (2).');
        const none = hiringStatementFor({
            ok: true, geography: 'us', verdict: 'no_observed_hiring', matched: 0, placeable: 31, total: 40, share: 0, ...WINDOW,
            latestMatchAt: null, buckets: [], citations: [], scope: 'observed_public_boards', statement: '',
        } as never, 'us');
        expect(none).toStartWith('No roles in the US among 31 located postings');
        expect(none).toContain('not evidence they never hire there');
    });

    test('names', () => {
        expect(geographyName('india')).toBe('India');
        expect(geographyName('us')).toBe('the US');
        expect(bucketName('remote_us')).toBe('Remote (US)');
        expect(bucketName('sf_bay')).toBe('SF Bay Area');
        expect(bucketName('multi_india')).toBe('Several sites (India)');
    });
});
