/**
 * Compensation extraction.
 *
 * Every fixture below is a real shape observed on a live public board while
 * designing this (Greenhouse: Figma, Anthropic, GitLab, Reddit, Stripe), not
 * an invented one. The traps are real traps:
 *
 *   • `€200.000` is two hundred thousand euros, not two hundred.
 *   • The body arrives HTML-escaped; forgetting that yields a silent 0%.
 *   • "5 - 7 years of experience" must never read as a salary band.
 *
 * A wrong number here is worse than no number — it appears next to someone's
 * decision about whether they are underpaid.
 */

import { describe, expect, test } from 'bun:test';
import { extractCompensation, parseMoney, unescapeHtml } from './comp';

/** Wrap a body the way Greenhouse actually returns it: escaped. */
function escaped(html: string): string {
    return html
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function payRangeBlock(title: string, low: string, high: string): string {
    return escaped(
        `<div class="content">` +
        `<div class="title">${title}</div>` +
        `<div class="pay-range"><span>${low}</span><span class="divider">&mdash;</span><span>${high}</span></div>` +
        `</div>`,
    );
}

describe('parseMoney — separator ambiguity', () => {
    test('US thousands separators', () => {
        expect(parseMoney('$165,000')).toBe(165000);
        expect(parseMoney('1,234,567')).toBe(1234567);
    });

    test('European thousands separators are not decimals', () => {
        // Anthropic writes €200.000 for two hundred thousand. Reading this as
        // 200.00 would be a 1000x error shown next to a career decision.
        expect(parseMoney('€200.000')).toBe(200000);
        expect(parseMoney('255.000')).toBe(255000);
    });

    test('genuine decimals survive', () => {
        expect(parseMoney('$68.50')).toBe(68.5);
        expect(parseMoney('173,000.00')).toBe(173000);
    });

    test('K suffix multiplies', () => {
        expect(parseMoney('$120K')).toBe(120000);
        expect(parseMoney('160k')).toBe(160000);
    });

    test('non-numeric input yields null rather than NaN', () => {
        expect(parseMoney('competitive')).toBeNull();
        expect(parseMoney('')).toBeNull();
    });
});

describe('unescapeHtml', () => {
    test('unescapes tags so the structured block can be found', () => {
        expect(unescapeHtml('&lt;div class=&quot;pay-range&quot;&gt;')).toBe('<div class="pay-range">');
    });

    test('&amp; is resolved last so &amp;lt; does not become a real tag', () => {
        // A body containing a literal "&lt;" (written as &amp;lt;) must stay text.
        expect(unescapeHtml('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
    });
});

describe('structured pay-range block', () => {
    test('reads a Figma-shaped USD range', () => {
        const out = extractCompensation(payRangeBlock('Annual Base Salary Range:', '$165,000', '$190,000 USD'));
        expect(out).not.toBeNull();
        expect(out!.low).toBe(165000);
        expect(out!.high).toBe(190000);
        expect(out!.currency).toBe('USD');
        expect(out!.source).toBe('structured');
        expect(out!.bandEligible).toBe(true);
    });

    test('reads an Anthropic-shaped European EUR range', () => {
        const out = extractCompensation(payRangeBlock('Annual Salary:', '€200.000', '€255.000 EUR'));
        expect(out!.low).toBe(200000);
        expect(out!.high).toBe(255000);
        expect(out!.currency).toBe('EUR');
        expect(out!.bandEligible).toBe(true);
    });

    test('keeps the label, because it carries geography', () => {
        // "Zone 1" / "Local" / "United States" is the geo bucket, free.
        const out = extractCompensation(payRangeBlock('Zone 1 pay range', '$150,000', '$180,000 USD'));
        expect(out!.label).toBe('Zone 1 pay range');
    });

    test('the divider span is not mistaken for a value', () => {
        const out = extractCompensation(payRangeBlock('Salary', '$100,000', '$130,000 USD'));
        expect(out!.high).toBe(130000);
    });

    test('currency is never converted — GBP stays GBP', () => {
        const out = extractCompensation(payRangeBlock('UK Salary Range', '£65,000', '£80,000 GBP'));
        expect(out!.currency).toBe('GBP');
        expect(out!.annualHigh).toBe(80000);
    });
});

describe('band-quality rules (PRD 04 §3.1)', () => {
    test('a degenerate range is disclosed but not band-eligible', () => {
        // Figma really does post $110,000 - $110,000.
        const out = extractCompensation(payRangeBlock('Annual Base Salary Range:', '$110,000', '$110,000 USD'));
        expect(out).not.toBeNull();
        expect(out!.bandEligible).toBe(false);
        expect(out!.rejectReason).toBe('degenerate');
    });

    test('a range wider than 60% of its midpoint is compliance theatre', () => {
        // 60k-200k: midpoint 130k, width 140k => 108%.
        const out = extractCompensation(payRangeBlock('Pay range', '$60,000', '$200,000 USD'));
        expect(out!.bandEligible).toBe(false);
        expect(out!.rejectReason).toBe('implausibly_wide');
    });

    test('exactly at the 60% threshold is still eligible', () => {
        // 70k-130k: midpoint 100k, width 60k => exactly 60%.
        const out = extractCompensation(payRangeBlock('Pay range', '$70,000', '$130,000 USD'));
        expect(out!.bandEligible).toBe(true);
    });

    test('an unknown currency cannot be pooled', () => {
        const out = extractCompensation(payRangeBlock('Salary', '150,000', '180,000'));
        expect(out!.currency).toBe('UNKNOWN');
        expect(out!.bandEligible).toBe(false);
        expect(out!.rejectReason).toBe('unknown_currency');
    });

    test('a reversed range is ordered, not rejected', () => {
        const out = extractCompensation(payRangeBlock('Salary', '$190,000 USD', '$165,000'));
        expect(out!.low).toBe(165000);
        expect(out!.high).toBe(190000);
        expect(out!.bandEligible).toBe(true);
    });
});

describe('hourly postings', () => {
    test('annualised for comparison, with the original period retained', () => {
        const out = extractCompensation(payRangeBlock('Hourly rate', '$60.00', '$75.00 USD'));
        expect(out!.period).toBe('hour');
        expect(out!.low).toBe(60);
        // Period normalisation is arithmetic; currency conversion is not, and
        // is deliberately never done.
        expect(out!.annualLow).toBe(60 * 2080);
        expect(out!.annualHigh).toBe(75 * 2080);
        expect(out!.bandEligible).toBe(true);
    });
});

describe('prose fallback', () => {
    test('reads a Stripe-shaped prose range when no block exists', () => {
        const body = escaped(
            '<p>The annual US base salary range for this role is $182,208 - $236,580.</p>',
        );
        const out = extractCompensation(body);
        expect(out!.source).toBe('prose');
        expect(out!.low).toBe(182208);
        expect(out!.high).toBe(236580);
        expect(out!.currency).toBe('USD');
    });

    test('handles K-suffixed prose', () => {
        const out = extractCompensation(escaped('<p>Compensation: $120K–$160K</p>'));
        expect(out!.low).toBe(120000);
        expect(out!.high).toBe(160000);
    });

    test('does NOT read years of experience as a salary', () => {
        // The single most important negative case: no currency anchor, no match.
        const body = escaped('<p>We are looking for 5 - 7 years of experience building systems.</p>');
        expect(extractCompensation(body)).toBeNull();
    });

    test('does NOT read a headcount as a salary', () => {
        const body = escaped('<p>We are a team of 200 - 300 people across four offices.</p>');
        expect(extractCompensation(body)).toBeNull();
    });

    test('prefers the figure near compensation language', () => {
        const body = escaped(
            '<p>Founded in 2015 with 100 - 200 employees.</p>' +
            '<p>The base salary range for this position is $190,000 - $240,000 USD.</p>',
        );
        const out = extractCompensation(body);
        expect(out!.low).toBe(190000);
    });
});

describe('postings that disclose nothing', () => {
    test('return null rather than a guess', () => {
        expect(extractCompensation(escaped('<p>Competitive salary and equity.</p>'))).toBeNull();
        expect(extractCompensation('')).toBeNull();
    });
});
