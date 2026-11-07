/**
 * Eligibility, both sides: what a posting requires of who may hold the job
 * (`detectEligibility`, `detectRegionScope`) and what the user's own profile
 * says about it (`evaluateEligibility`). The JD strings are shaped like real
 * ones, including the post from QA 2026-11-07.
 */

import { describe, expect, test } from 'bun:test';
import { authorizationIn, evaluateEligibility, parseWorkAuthorization, workAuthQuestionPrompt } from './eligibility';
import { detectEligibility, detectRegionScope } from './jdSignals';
import { regionOf } from './region';

/** Pasted from the QA run, as the user sent it. */
export const FDE_POST = `Forward Deployed AI Engineer (#C3) | Claude
Remote, DMV preferred | $90/hr or $190K salary
jobs@iserveworld.com | chris.d@iserveworld.com
Build and deploy client-facing AI agents using Claude, MCP, RAG, and A2A or multi-agent patterns. Requires 3+ years in engineering, 2+ recent years building GenAI solutions, client-facing delivery experience, and a bachelor’s degree. Must obtain HHS Public Trust before onboarding.`;

const kinds = (text: string) => detectEligibility(text).map((r) => `${r.kind}:${r.region}`);

describe('detectEligibility', () => {
    test('the QA post: HHS Public Trust, and a DC-area preference', () => {
        const found = detectEligibility(FDE_POST);
        expect(found).toEqual([
            { kind: 'public_trust', region: 'us', quote: 'HHS Public Trust', label: 'HHS Public Trust' },
            { kind: 'region_only', region: 'us', quote: 'DMV preferred', label: 'the DC area (US)', preferred: true },
        ]);
    });

    test('citizenship and clearance, strictest first, each quoted', () => {
        const found = detectEligibility('Must be a U.S. citizen. An active Secret clearance is required; TS/SCI preferred.');
        expect(found.map((r) => r.kind)).toEqual(['clearance', 'citizenship']);
        expect(found[0]).toMatchObject({ quote: 'active Secret clearance', label: 'a Secret clearance', region: 'us' });
        expect(found[1]).toMatchObject({ quote: 'U.S. citizen', label: 'US citizenship' });
        expect(kinds('Candidates must hold TS/SCI with polygraph.')).toEqual(['clearance:us']);
        expect(kinds('US Citizenship required.')).toEqual(['citizenship:us']);
    });

    test('citizens or green card holders, and ITAR, are their own kind', () => {
        expect(kinds('Open to US citizens and green card holders only.')).toEqual(['citizen_or_resident:us']);
        expect(kinds('This position requires access to ITAR-controlled technical data.')).toEqual(['citizen_or_resident:us']);
    });

    test('work authorization, with and without a country', () => {
        expect(detectEligibility('Candidates must be authorized to work in the United States without sponsorship.')).toEqual([
            { kind: 'work_authorization', region: 'us', quote: 'authorized to work in the United States', label: 'authorization to work in the US' },
        ]);
        expect(kinds('You must be legally authorized to work in the UK.')).toEqual(['work_authorization:uk']);
        expect(kinds('We can only consider applicants who can work without visa sponsorship.')).toEqual(['work_authorization:null']);
    });

    test('region-only remote scopes', () => {
        expect(kinds('Location: Remote - US')).toEqual(['region_only:us']);
        expect(kinds('This is a remote role within the United States.')).toEqual(['region_only:us']);
        expect(kinds('US-based only. No exceptions.')).toEqual(['region_only:us']);
        expect(kinds('Remote (India). Must reside in India.')).toEqual(['region_only:india']);
        expect(detectEligibility('Remote (India)')[0].quote).toBe('Remote (India)');
    });

    test('negations and lookalikes are not restrictions', () => {
        expect(detectEligibility('No security clearance required. US citizenship is not required.')).toEqual([]);
        expect(detectEligibility('Join us remote-first! Contact us only by email.')).toEqual([]);
        expect(detectEligibility('A clean DMV record is required for this driving role.')).toEqual([]);
        expect(detectEligibility('We are building public trust in AI through open research.')).toEqual([]);
        expect(detectEligibility('Benefits include help with US citizenship paperwork for your family.')).toEqual([]);
        expect(detectEligibility('')).toEqual([]);
    });
});

describe('detectRegionScope', () => {
    test('the location field first, then the body', () => {
        expect(detectRegionScope({ location: 'Remote - US', text: '' })).toEqual({ region: 'us', quote: 'Remote - US', preferred: false });
        expect(detectRegionScope({ location: null, text: FDE_POST })).toEqual({ region: 'us', quote: 'DMV preferred', preferred: true });
        expect(detectRegionScope({ location: 'United States', text: '' })?.region).toBe('us');
    });

    test('a city is a location, not a scope; plain remote has none', () => {
        expect(detectRegionScope({ location: 'New York, NY', text: '' })).toBeNull();
        expect(detectRegionScope({ location: 'Remote', text: 'Work from anywhere.' })).toBeNull();
    });
});

describe('regionOf', () => {
    test.each([
        ['Bengaluru, India', 'india'], ['Bangalore', 'india'], ['Chennai', 'india'], ['Remote India', 'india'],
        ['San Francisco, CA', 'us'], ['Arlington, VA', 'us'], ['Washington, DC', 'us'], ['London', 'uk'], ['Toronto, Canada', 'canada'],
    ])('%s is in %s', (place, region) => expect(regionOf(place)).toBe(region as never));

    test('unplaceable is null, never a default market', () => {
        expect(regionOf('Remote')).toBeNull();
        expect(regionOf('Atlantis')).toBeNull();
        expect(regionOf('')).toBeNull();
    });
});

describe('parseWorkAuthorization', () => {
    test('status per region, from the words people type in Settings', () => {
        expect(authorizationIn(parseWorkAuthorization('US citizen'), 'us')).toBe('citizen');
        expect(authorizationIn(parseWorkAuthorization('Green card holder'), 'us')).toBe('permanent_resident');
        expect(authorizationIn(parseWorkAuthorization('H-1B'), 'us')).toBe('authorized');
        expect(authorizationIn(parseWorkAuthorization('Not authorized to work in the US'), 'us')).toBe('not_authorized');
        expect(authorizationIn(parseWorkAuthorization('Indian citizen; need H-1B sponsorship for the US'), 'us')).toBe('not_authorized');
        expect(authorizationIn(parseWorkAuthorization('Indian citizen'), 'us')).toBe('other_region');
        expect(authorizationIn(parseWorkAuthorization('I need visa sponsorship'), 'uk')).toBe('not_authorized');
        expect(parseWorkAuthorization('')).toBeNull();
        expect(parseWorkAuthorization('happy to discuss')).toBeNull();
    });
});

describe('evaluateEligibility', () => {
    const publicTrust = detectEligibility(FDE_POST);
    const base = { restrictions: publicTrust, workAuthorization: '', requiresSponsorship: 'unknown' as const, userLocation: 'Bengaluru, India', fallbackRegion: null };

    test('the QA user: based in Bengaluru, nothing stated, so they may not be eligible, and how to clear it', () => {
        const outcome = evaluateEligibility(base)!;
        expect(outcome.status).toBe('conflict');
        expect(outcome.detail).toStartWith('You may not be eligible: requires HHS Public Trust, which generally needs US citizenship or residency.');
        expect(outcome.detail).toContain('Bengaluru, India');
        expect(outcome.detail).toContain('Settings');
    });

    test('a stated US citizen is eligible; the statement is quoted back', () => {
        const outcome = evaluateEligibility({ ...base, workAuthorization: 'US citizen' })!;
        expect(outcome.status).toBe('match');
        expect(outcome.detail).toContain('"US citizen"');
    });

    test('nothing stated and nowhere known: a question, never a pass', () => {
        const outcome = evaluateEligibility({ ...base, userLocation: '' })!;
        expect(outcome).toMatchObject({ status: 'unknown', askable: true });
        const asked = workAuthQuestionPrompt(outcome);
        expect(asked.prompt).toBe('This role requires HHS Public Trust, which generally needs US citizenship or residency. Which describes you?');
        expect(asked.options.map((o) => o.label)).toEqual(['US citizen', 'Green card holder', 'Work visa', 'Not authorized']);
        // In the US but unstated is still a question for citizenship-type rules.
        expect(evaluateEligibility({ ...base, userLocation: 'Arlington, VA' })!.status).toBe('unknown');
    });

    test('what each standing satisfies', () => {
        const clearance = detectEligibility('Active Secret clearance required.');
        expect(evaluateEligibility({ ...base, restrictions: clearance, workAuthorization: 'Green card holder' })!.status).toBe('conflict');
        expect(evaluateEligibility({ ...base, workAuthorization: 'Green card holder' })!.status).toBe('match');
        expect(evaluateEligibility({ ...base, workAuthorization: 'Indian citizen' })!.status).toBe('conflict');
        const authorization = detectEligibility('Must be authorized to work in the United States.');
        expect(evaluateEligibility({ ...base, restrictions: authorization, workAuthorization: 'H-1B' })!.status).toBe('match');
        expect(evaluateEligibility({ ...base, restrictions: authorization, workAuthorization: 'H-1B', requiresSponsorship: 'yes' })!.status).toBe('conflict');
        expect(evaluateEligibility({ ...base, restrictions: authorization, userLocation: 'Austin, TX', requiresSponsorship: 'no' })!.status).toBe('match');
    });

    test('a region scope alone is the location check\'s business, not eligibility', () => {
        expect(evaluateEligibility({ ...base, restrictions: detectEligibility('Remote - US') })).toBeNull();
        expect(evaluateEligibility({ ...base, restrictions: [] })).toBeNull();
    });
});
