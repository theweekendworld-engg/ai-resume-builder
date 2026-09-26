/**
 * The hiring signal, and specifically its asymmetry.
 *
 * The tests that matter here are the ones about REFUSING. Getting a "yes" right
 * is easy — a posting in Bengaluru is a posting in Bengaluru. The failure this
 * module exists to prevent is telling someone a company does not hire in their
 * country on the strength of four postings, and that failure is silent, sounds
 * authoritative, and would change where a person applies.
 */

import { describe, expect, test } from 'bun:test';
import {
    MIN_POSTINGS_FOR_ABSENCE,
    bucketsForGeography,
    computeHiringSignal,
    describeHiringRefusal,
    describeHiringSignal,
    toWireHiringSignal,
    type HiringObservation,
} from './hiring';
import { normalizeGeo } from '@/lib/radar/geo';

const WINDOW_START = new Date('2026-03-09T00:00:00.000Z');
const WINDOW_END = new Date('2026-09-05T00:00:00.000Z');

function posting(over: Partial<HiringObservation> = {}): HiringObservation {
    return {
        geoBucket: 'nyc',
        location: 'New York, NY',
        postedAt: new Date('2026-08-01T00:00:00.000Z'),
        title: 'Backend Engineer',
        absoluteUrl: 'https://boards.greenhouse.io/acme/jobs/1',
        ...over,
    };
}

function many(n: number, over: Partial<HiringObservation> = {}): HiringObservation[] {
    return Array.from({ length: n }, (_, i) =>
        posting({ ...over, absoluteUrl: `https://boards.greenhouse.io/acme/jobs/${i}` }));
}

const india = { geography: 'india', windowStart: WINDOW_START, windowEnd: WINDOW_END };

describe('presence is an existence proof, not a rate', () => {
    test('a single India posting is enough to answer yes', () => {
        const result = computeHiringSignal(
            [posting({ geoBucket: 'bengaluru', location: 'Bengaluru, India' }), ...many(3)],
            india,
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.signal.verdict).toBe('hires_there');
        expect(result.signal.matched).toBe(1);
    });

    test('a yes always carries the postings it is based on', () => {
        const result = computeHiringSignal(
            [posting({ geoBucket: 'pune', location: 'Pune, India' })],
            india,
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // The claim has to be checkable, which means a URL, not just a count.
        expect(result.signal.citations).toHaveLength(1);
        expect(result.signal.citations[0].absoluteUrl).toContain('greenhouse.io');
    });

    test('citations are capped and ordered newest first', () => {
        const observations = Array.from({ length: 9 }, (_, i) =>
            posting({
                geoBucket: 'bengaluru',
                postedAt: new Date(`2026-0${(i % 8) + 1}-01T00:00:00.000Z`),
                absoluteUrl: `https://boards.greenhouse.io/acme/jobs/${i}`,
            }));

        const result = computeHiringSignal(observations, india);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.signal.citations).toHaveLength(5);

        const dates = result.signal.citations.map((c) => c.postedAt?.getTime() ?? 0);
        expect([...dates].sort((a, b) => b - a)).toEqual(dates);
    });

    test('cities are broken out, so "yes" can say where', () => {
        const result = computeHiringSignal(
            [
                ...many(3, { geoBucket: 'bengaluru' }),
                ...many(1, { geoBucket: 'pune' }),
            ],
            india,
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.signal.buckets).toEqual([
            { bucket: 'bengaluru', n: 3 },
            { bucket: 'pune', n: 1 },
        ]);
    });
});

describe('absence needs a denominator', () => {
    test('zero India roles out of a handful is a refusal, not a no', () => {
        const result = computeHiringSignal(many(4), india);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.refusal.reason).toBe('insufficient_for_absence');
    });

    test(`zero out of ${MIN_POSTINGS_FOR_ABSENCE} is finally allowed to be a no`, () => {
        const result = computeHiringSignal(many(MIN_POSTINGS_FOR_ABSENCE), india);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.signal.verdict).toBe('no_observed_hiring');
        expect(result.signal.matched).toBe(0);
        expect(result.signal.placeable).toBe(MIN_POSTINGS_FOR_ABSENCE);
    });

    test('one under the floor still refuses — the boundary is not off by one', () => {
        const result = computeHiringSignal(many(MIN_POSTINGS_FOR_ABSENCE - 1), india);
        expect(result.ok).toBe(false);
    });

    test('unplaceable postings do not pad the denominator', () => {
        // 25 rows, but only 5 state a location we can read. Counting all 25
        // would clear the floor and license a "no" backed by nothing.
        const observations = [
            ...many(5),
            ...many(20, { geoBucket: null, location: 'Somewhere fun' }),
        ];

        const result = computeHiringSignal(observations, india);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.refusal.reason).toBe('insufficient_for_absence');
        if (refusalHasPlaceable(result.refusal)) expect(result.refusal.placeable).toBe(5);
    });

    test('nothing placeable at all is its own refusal', () => {
        const result = computeHiringSignal(
            many(30, { geoBucket: null, location: null }),
            india,
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.refusal.reason).toBe('no_placeable_locations');
    });

    test('no postings at all is distinguishable from a real zero', () => {
        const result = computeHiringSignal([], india);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.refusal.reason).toBe('no_postings');
    });
});

function refusalHasPlaceable(r: { reason: string; placeable?: number }): r is { reason: string; placeable: number } {
    return typeof r.placeable === 'number';
}

describe('what counts as being in a geography', () => {
    test('remote roles scoped to the region count', () => {
        const result = computeHiringSignal(
            [posting({ geoBucket: 'remote_india', location: 'Remote - India' })],
            india,
        );
        expect(result.ok).toBe(true);
    });

    test('remote roles scoped to an Indian metro count', () => {
        const result = computeHiringSignal(
            [posting({ geoBucket: 'remote_bengaluru' })],
            india,
        );
        expect(result.ok).toBe(true);
    });

    test('remote_global does not count as hiring in India', () => {
        // The employer said "anywhere", not "India". Treating a global remote
        // posting as an India posting is the single easiest way to manufacture
        // a yes, and it is the one users would most reasonably rely on.
        const result = computeHiringSignal(many(MIN_POSTINGS_FOR_ABSENCE, {
            geoBucket: 'remote_global',
        }), india);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.signal.verdict).toBe('no_observed_hiring');
    });

    test('a US posting is not an India posting', () => {
        const result = computeHiringSignal(many(MIN_POSTINGS_FOR_ABSENCE), india);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.signal.matched).toBe(0);
    });
});

/**
 * The drift guard.
 *
 * `GEOGRAPHY_BUCKETS` restates slugs that live privately in `radar/geo.ts`. If
 * someone adds Chennai to the metro table there and not here, India hiring
 * silently under-counts and nothing fails. This runs real location strings
 * through the real normaliser and asserts they land inside the geography.
 */
describe('bucket names stay in sync with radar/geo', () => {
    test.each([
        'Bengaluru, India',
        'Bangalore',
        'Hyderabad, India',
        'Mumbai',
        'Pune, India',
        'Gurugram',
        'Noida, India',
        'India',
        'Remote - India',
    ])('%s lands inside the india geography', (raw) => {
        const bucket = normalizeGeo(raw).bucket;
        expect(bucket).not.toBeNull();
        expect(bucketsForGeography('india').has(bucket!)).toBe(true);
    });

    test.each([
        'New York, NY',
        'London',
        'Remote - US',
        'Singapore',
    ])('%s does not', (raw) => {
        const bucket = normalizeGeo(raw).bucket;
        expect(bucketsForGeography('india').has(bucket!)).toBe(false);
    });

    test('an unknown geography matches nothing rather than everything', () => {
        expect(bucketsForGeography('atlantis').size).toBe(0);
    });
});

describe('the sentence carries its own caveats', () => {
    test('a negative states what it is a negative about', () => {
        const result = computeHiringSignal(many(MIN_POSTINGS_FOR_ABSENCE), india);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const sentence = describeHiringSignal(result.signal);
        expect(sentence).toContain('only the boards we poll');
        expect(sentence).toContain(String(MIN_POSTINGS_FOR_ABSENCE));
    });

    test('a positive states n and where', () => {
        const result = computeHiringSignal(
            [...many(2, { geoBucket: 'bengaluru' }), ...many(6)],
            india,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const sentence = describeHiringSignal(result.signal);
        expect(sentence).toContain('2 of 8');
        expect(sentence).toContain('bengaluru');
    });

    test('a refusal reads as unknown, never as a no', () => {
        const sentence = describeHiringRefusal(
            { reason: 'insufficient_for_absence', total: 5, placeable: 5, needed: 20 },
            'india',
        );
        expect(sentence).toContain('unknown, not as a no');
    });
});

describe('wire shape', () => {
    test('dates serialise and the statement rides along', () => {
        const result = computeHiringSignal([posting({ geoBucket: 'mumbai' })], india);
        const wire = toWireHiringSignal(result, 'india');

        expect(wire.ok).toBe(true);
        if (!wire.ok) return;
        expect(wire.windowStart).toBe(WINDOW_START.toISOString());
        expect(typeof wire.statement).toBe('string');
        expect(wire.scope).toBe('observed_public_boards');
    });

    test('a refusal serialises with its reason intact', () => {
        const wire = toWireHiringSignal(computeHiringSignal([], india), 'india');
        expect(wire.ok).toBe(false);
        if (wire.ok) return;
        expect(wire.reason).toBe('no_postings');
        expect(wire.placeable).toBe(0);
    });
});
