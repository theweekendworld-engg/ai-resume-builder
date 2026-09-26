import { describe, expect, test } from 'bun:test';
import { canonicalProfileUrl, parseConnectedOn, parseCsvRows, parseLinkedInConnections } from './linkedinExport';
import { CONNECTIONS_FIXTURE } from './linkedinExport.fixture';


describe('parseCsvRows', () => {
    test('quoted commas, doubled quotes, CRLF', () => {
        const rows = parseCsvRows('a,"b, c","say ""hi"""\r\nd,e,f\r\n');
        expect(rows).toEqual([['a', 'b, c', 'say "hi"'], ['d', 'e', 'f']]);
    });
});

describe('parseLinkedInConnections', () => {
    const result = parseLinkedInConnections(CONNECTIONS_FIXTURE);

    test('finds the header after the Notes preamble', () => {
        expect(result.recognised).toBe(true);
        expect(result.connections.map((c) => c.fullName)).toEqual(['Priya Sharma', 'Arjun Mehta', 'Neha', 'Rahul Verma']);
    });

    test('keeps quoted commas and quotes inside fields', () => {
        expect(result.connections[0].company).toBe('Stripe, Inc.');
        expect(result.connections[1].position).toBe('Engineering Manager, Payments');
        expect(result.connections[2].position).toBe('Senior Engineer "Platform"');
    });

    test('canonicalises profile urls and dates', () => {
        expect(result.connections[1].profileUrl).toBe('https://www.linkedin.com/in/arjunmehta');
        expect(result.connections[0].connectedOn?.toISOString()).toBe('2024-03-12T00:00:00.000Z');
        expect(result.connections[2].connectedOn?.toISOString()).toBe('2022-02-07T00:00:00.000Z');
        expect(result.connections[3].profileUrl).toBeNull();
    });

    test('a row with no name is skipped, not invented', () => {
        expect(result.skipped).toBe(1);
    });

    test('normalises the company for matching', () => {
        expect(result.connections[0].normalizedCompany).toBeTruthy();
        expect(result.connections[0].email).toBeNull();
        expect(result.connections[1].email).toBe('arjun@example.com');
    });

    test('a file that is not the export is unrecognised', () => {
        expect(parseLinkedInConnections('name,phone\nA,1').recognised).toBe(false);
    });
});

describe('helpers', () => {
    test('parseConnectedOn rejects impossible dates', () => {
        expect(parseConnectedOn('31 Feb 2024')).toBeNull();
        expect(parseConnectedOn('yesterday')).toBeNull();
    });

    test('canonicalProfileUrl only accepts /in/ profiles', () => {
        expect(canonicalProfileUrl('linkedin.com/in/jane-doe?trk=x')).toBe('https://www.linkedin.com/in/jane-doe');
        expect(canonicalProfileUrl('https://www.linkedin.com/company/acme')).toBeNull();
        expect(canonicalProfileUrl('https://evil.com/in/jane')).toBeNull();
    });
});
