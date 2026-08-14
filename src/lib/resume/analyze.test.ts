/**
 * Reading a resume out of extracted PDF text.
 *
 * The model calls are covered by the eval; this pins the two pure parts, both
 * of which are working with the roughest input in the product — one flat
 * string from a PDF extractor with no structure to trust.
 */

import { describe, expect, test } from 'bun:test';

import { extractClaimLines, tenureFromText } from './analyze';

const RESUME = `PRIYA RAMAN
Senior Software Engineer
priya@example.com | linkedin.com/in/priyaraman | San Francisco, CA

EXPERIENCE

Flexport — Senior Software Engineer
2021 - Present
• Cut invoice generation p95 from 4.2s to 900ms by replacing N+1 lookups with a batched query.
• Led the migration of 9 services from EC2 to Kubernetes with zero customer-visible downtime.
- Mentored 3 engineers; two were promoted within the year.

Instacart — Software Engineer
2018 - 2021
• Built and owned the order settlement pipeline processing 1.2M orders per day.

EDUCATION
BSc Computer Science, 2018
`;

describe('pulling claims out of PDF text', () => {
    const lines = extractClaimLines(RESUME);

    test('finds the achievements', () => {
        expect(lines.some((l) => l.includes('4.2s to 900ms'))).toBe(true);
        expect(lines.some((l) => l.includes('1.2M orders per day'))).toBe(true);
        expect(lines.some((l) => l.includes('Mentored 3 engineers'))).toBe(true);
    });

    test('strips the bullet glyph, whatever it is', () => {
        // • and - both appear in real extracted text, often in one document.
        expect(lines.some((l) => l.startsWith('•') || l.startsWith('-'))).toBe(false);
        expect(lines.some((l) => l.startsWith('Mentored 3 engineers'))).toBe(true);
    });

    test('drops all-caps section headings', () => {
        expect(lines).not.toContain('EXPERIENCE');
        expect(lines).not.toContain('EDUCATION');
        expect(lines).not.toContain('PRIYA RAMAN');
    });

    test('drops the contact line', () => {
        // An email or a profile URL is not a claim about the candidate's work.
        expect(lines.some((l) => l.includes('@') || l.includes('linkedin.com'))).toBe(false);
    });

    test('drops short fragments a heading or date leaves behind', () => {
        expect(lines).not.toContain('2021 - Present');
        expect(lines.every((l) => l.length >= 25)).toBe(true);
    });

    test('de-duplicates, because two-column PDFs repeat lines', () => {
        const doubled = extractClaimLines(`${RESUME}\n${RESUME}`);
        expect(new Set(doubled).size).toBe(doubled.length);
    });

    test('discards a run-together blob rather than sending it to the model', () => {
        const blob = 'x'.repeat(500);
        expect(extractClaimLines(blob)).toEqual([]);
    });

    test('an empty document yields nothing rather than throwing', () => {
        expect(extractClaimLines('')).toEqual([]);
        expect(extractClaimLines('   \n\n  ')).toEqual([]);
    });

    test('errs toward including — a stray heading costs nothing', () => {
        // A heading that slips through scores 0-1 and answers nothing. A
        // dropped achievement becomes a requirement wrongly reported as a gap,
        // which is the failure a candidate would actually notice.
        const withOddHeading = extractClaimLines('Professional Experience And Selected Projects');
        expect(withOddHeading).toHaveLength(1);
    });
});

describe('years of experience from the page', () => {
    const NOW = new Date('2026-06-01T00:00:00Z');

    test('spans from the earliest year on the document', () => {
        expect(tenureFromText(RESUME, NOW)).toBe(8);
    });

    test('ignores a year that has not happened', () => {
        // "Expected graduation 2029" must not produce a negative span.
        expect(tenureFromText('Started 2020. Expected 2029.', NOW)).toBe(6);
    });

    test('ignores implausible years', () => {
        // A four-digit number in a metric — "processed 1965 orders" — is not a
        // date, but 1965 is before the floor so it cannot drag tenure to 61.
        expect(tenureFromText('Handled 1965 tickets since 2022', NOW)).toBe(4);
    });

    test('no years at all is zero, not a guess', () => {
        expect(tenureFromText('Backend engineer who ships things.', NOW)).toBe(0);
    });
});
