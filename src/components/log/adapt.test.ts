/**
 * Impact chip adaptation.
 *
 * `toMetricValue` decides the single number a win card shows, and it had no
 * tests until a live capture put a wrong one on screen. A real note — "page
 * went from 4.2s to 900ms" — produced a chip reading "900ms", because the
 * ranking preferred a bare `result` over the `baseline → result` range and
 * pushed the range into a hover tooltip. On its own "900ms" is a state, not an
 * achievement; a reader cannot tell whether it is good news.
 *
 * The live model turns out to fill `baseline` and `result` reliably and
 * `delta` rarely, so that was the common path, not the edge case.
 */

import { describe, expect, test } from 'bun:test';
import type { ImpactView } from '@/actions/wins.types';
import { impactSentence, toMetricValue } from './adapt';

function impact(patch: Partial<ImpactView>): ImpactView {
    return {
        id: 'im_1',
        metric: 'p95 latency',
        baseline: null,
        result: null,
        delta: null,
        scope: null,
        timeframe: null,
        ...patch,
    };
}

describe('toMetricValue — which figure reaches the chip', () => {
    test('prefers the range over a bare result (the live-capture regression)', () => {
        // Exactly what gpt-5-mini extracted from "page went from 4.2s to 900ms".
        const value = toMetricValue(
            impact({ metric: 'invoice list page load time', baseline: '4.2s', result: '900ms' }),
        );

        expect(value?.value).toBe('4.2s → 900ms');
        // And it must not also repeat in the tooltip.
        expect(value?.detail ?? '').not.toContain('4.2s → 900ms');
    });

    test('delta still outranks the range', () => {
        const value = toMetricValue(
            impact({ baseline: '4.2s', result: '900ms', delta: '−79%' }),
        );

        expect(value?.value).toBe('−79%');
        // The range is the supporting detail once something sharper exists.
        expect(value?.detail).toContain('4.2s → 900ms');
    });

    test('falls back to result when there is no baseline to compare against', () => {
        expect(toMetricValue(impact({ result: '900ms' }))?.value).toBe('900ms');
    });

    test('falls back to the metric name when there is no figure at all', () => {
        expect(toMetricValue(impact({}))?.value).toBe('p95 latency');
    });

    test('detail carries scope and timeframe without repeating the value', () => {
        const value = toMetricValue(
            impact({
                metric: 'invoice list page load time',
                baseline: '4.2s',
                result: '900ms',
                scope: 'biggest tenant',
                timeframe: 'tuesday',
            }),
        );

        expect(value?.detail).toContain('biggest tenant');
        expect(value?.detail).toContain('tuesday');
        expect(value?.detail).toContain('invoice list page load time');
    });

    test('null impact yields no chip', () => {
        expect(toMetricValue(null)).toBeNull();
    });
});

describe('impactSentence — the drawer reads as prose', () => {
    test('renders the range, and the delta parenthetically', () => {
        expect(impactSentence(impact({ baseline: '4.2s', result: '900ms' }))).toBe('4.2s → 900ms');
        expect(impactSentence(impact({ baseline: '4.2s', result: '900ms', delta: '−79%' }))).toBe(
            '4.2s → 900ms (−79%)',
        );
    });

    test('a delta with no endpoints is shown alone, not in stray parentheses', () => {
        expect(impactSentence(impact({ delta: '−79%' }))).toBe('−79%');
    });
});
