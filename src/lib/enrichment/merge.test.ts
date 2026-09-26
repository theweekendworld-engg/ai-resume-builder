/**
 * Source precedence.
 *
 * The regression this file exists to catch: a licensed headcount being
 * overwritten by a sentence caught by regex in marketing prose, because the
 * regex ran more recently. Nothing errors when that happens — the card just
 * quietly gets worse, and it gets worse again every time the page is opened.
 */

import { describe, expect, test } from 'bun:test';
import {
    confidenceFromProvenance,
    freshnessLabelFor,
    mergeCompanyFields,
    readProvenance,
} from './merge';
import type { ProvenanceMap } from './types';

const EARLIER = new Date('2026-01-01T00:00:00.000Z');
const LATER = new Date('2026-09-01T00:00:00.000Z');

const EMPTY = { employeeCount: null, fundingTotal: null, revenueEstimateText: null };

describe('rule 1 — a null never overwrites a value', () => {
    test('a provider with no funding data does not erase the job page value', () => {
        const result = mergeCompanyFields({
            current: { ...EMPTY, fundingTotal: '$12M raised' },
            currentProvenance: { fundingTotal: { source: 'job_page', observedAt: EARLIER.toISOString() } },
            incoming: { fundingTotal: null, employeeCount: 400 },
            source: 'provider',
            provider: 'peopledatalabs',
            observedAt: LATER,
        });

        expect(result.fields.fundingTotal).toBe('$12M raised');
        expect(result.fields.employeeCount).toBe(400);
    });

    test('an empty string is treated as absence, not as a value', () => {
        const result = mergeCompanyFields({
            current: { ...EMPTY, revenueEstimateText: '$5M ARR' },
            currentProvenance: {},
            incoming: { revenueEstimateText: '   ' },
            source: 'provider',
            observedAt: LATER,
        });

        expect(result.fields.revenueEstimateText).toBe('$5M ARR');
    });
});

describe('rule 2 — a weaker source never wins, however fresh', () => {
    test('the job page cannot overwrite a provider headcount', () => {
        const provenance: ProvenanceMap = {
            employeeCount: {
                source: 'provider',
                provider: 'peopledatalabs',
                observedAt: EARLIER.toISOString(),
            },
        };

        const result = mergeCompanyFields({
            current: { ...EMPTY, employeeCount: 4_000 },
            currentProvenance: provenance,
            // The JD says "our 50-person team", and it says it today.
            incoming: { employeeCount: 50 },
            source: 'job_page',
            observedAt: LATER,
        });

        expect(result.fields.employeeCount).toBe(4_000);
        expect(result.changed).toEqual([]);
        expect(result.provenance.employeeCount.source).toBe('provider');
    });

    test('a provider does overwrite a job-page value', () => {
        const result = mergeCompanyFields({
            current: { ...EMPTY, employeeCount: 50 },
            currentProvenance: { employeeCount: { source: 'job_page', observedAt: LATER.toISOString() } },
            incoming: { employeeCount: 4_000 },
            source: 'provider',
            provider: 'peopledatalabs',
            observedAt: EARLIER,
        });

        expect(result.fields.employeeCount).toBe(4_000);
        expect(result.changed).toEqual(['employeeCount']);
    });

    test('an unattributed legacy value can be claimed by any source', () => {
        // Rows written before provenance existed have none. They should be
        // upgraded, not frozen.
        const result = mergeCompanyFields({
            current: { ...EMPTY, employeeCount: 50 },
            currentProvenance: {},
            incoming: { employeeCount: 4_000 },
            source: 'job_page',
            observedAt: LATER,
        });

        expect(result.fields.employeeCount).toBe(4_000);
        expect(result.provenance.employeeCount.source).toBe('job_page');
    });
});

describe('rule 3 — same rank, newer wins, and replays are no-ops', () => {
    test('a newer provider observation replaces an older one', () => {
        const result = mergeCompanyFields({
            current: { ...EMPTY, employeeCount: 400 },
            currentProvenance: {
                employeeCount: { source: 'provider', provider: 'peopledatalabs', observedAt: EARLIER.toISOString() },
            },
            incoming: { employeeCount: 450 },
            source: 'provider',
            provider: 'peopledatalabs',
            observedAt: LATER,
        });

        expect(result.fields.employeeCount).toBe(450);
    });

    test('replaying the same payload changes nothing', () => {
        const provenance: ProvenanceMap = {
            employeeCount: { source: 'provider', provider: 'peopledatalabs', observedAt: LATER.toISOString() },
        };

        const result = mergeCompanyFields({
            current: { ...EMPTY, employeeCount: 400 },
            currentProvenance: provenance,
            incoming: { employeeCount: 400 },
            source: 'provider',
            provider: 'peopledatalabs',
            observedAt: LATER,
        });

        expect(result.changed).toEqual([]);
    });

    test('a stale provider observation does not clobber a newer one', () => {
        const result = mergeCompanyFields({
            current: { ...EMPTY, employeeCount: 450 },
            currentProvenance: {
                employeeCount: { source: 'provider', provider: 'peopledatalabs', observedAt: LATER.toISOString() },
            },
            incoming: { employeeCount: 400 },
            source: 'provider',
            provider: 'peopledatalabs',
            observedAt: EARLIER,
        });

        expect(result.fields.employeeCount).toBe(450);
    });
});

describe('confidence follows the source, not the field count', () => {
    test('one provider field beats three scraped ones', () => {
        const scraped = confidenceFromProvenance({
            employeeCount: { source: 'job_page', observedAt: LATER.toISOString() },
            fundingTotal: { source: 'job_page', observedAt: LATER.toISOString() },
            revenueEstimateText: { source: 'job_page', observedAt: LATER.toISOString() },
        });
        const licensed = confidenceFromProvenance({
            employeeCount: { source: 'provider', provider: 'peopledatalabs', observedAt: LATER.toISOString() },
        });

        expect(licensed).toBeGreaterThan(scraped);
    });

    test('nothing ever reaches certainty', () => {
        const everything = confidenceFromProvenance({
            employeeCount: { source: 'observed_postings', observedAt: LATER.toISOString() },
            fundingTotal: { source: 'observed_postings', observedAt: LATER.toISOString() },
            revenueEstimateText: { source: 'observed_postings', observedAt: LATER.toISOString() },
        });

        expect(everything).toBeLessThanOrEqual(0.86);
    });

    test('an empty row is not confident', () => {
        expect(confidenceFromProvenance({})).toBeLessThan(0.2);
    });
});

describe('freshness label names the strongest source', () => {
    test('a mixed row is labelled by the provider, not the job page', () => {
        expect(freshnessLabelFor({
            employeeCount: { source: 'provider', provider: 'peopledatalabs', observedAt: LATER.toISOString() },
            fundingTotal: { source: 'job_page', observedAt: LATER.toISOString() },
        })).toBe('provider:peopledatalabs');
    });

    test('an empty row falls back to the historical label', () => {
        expect(freshnessLabelFor({})).toBe('job-page-derived');
    });
});

describe('reading provenance back off rawData', () => {
    test('round-trips', () => {
        const written = mergeCompanyFields({
            current: EMPTY,
            currentProvenance: {},
            incoming: { employeeCount: 400 },
            source: 'provider',
            provider: 'peopledatalabs',
            observedAt: LATER,
        });

        const read = readProvenance({ provenance: written.provenance });
        expect(read.employeeCount).toEqual({
            source: 'provider',
            provider: 'peopledatalabs',
            observedAt: LATER.toISOString(),
        });
    });

    test.each([
        ['null rawData', null],
        ['an array', []],
        ['no provenance key', { facts: [] }],
        ['a garbage provenance', { provenance: 'nope' }],
    ])('%s reads as empty rather than throwing', (_label, input) => {
        expect(readProvenance(input)).toEqual({});
    });

    test('entries with an unrecognised source are dropped, not coerced', () => {
        // A source we do not know cannot be ranked, and an unrankable entry in
        // the map would silently be treated as rank 0 — i.e. overwritable by
        // anything, which is the opposite of what an unknown source deserves.
        const read = readProvenance({
            provenance: {
                employeeCount: { source: 'vibes', observedAt: LATER.toISOString() },
                fundingTotal: { source: 'provider', observedAt: LATER.toISOString() },
            },
        });

        expect(read.employeeCount).toBeUndefined();
        expect(read.fundingTotal).toBeDefined();
    });
});
