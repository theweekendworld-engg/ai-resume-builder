/**
 * Skill extraction.
 *
 * The negative cases matter more than the positive ones here. A skill we fail
 * to spot costs one posting of coverage; a skill we hallucinate puts a false
 * entry at the top of a demand chart.
 */

import { describe, expect, test } from 'bun:test';
import { extractSkills, knownSkills, normalizeSkill } from './skills';

describe('aliases collapse to one canonical slug', () => {
    test.each([
        ['postgres', 'postgresql'],
        ['psql', 'postgresql'],
        ['PostgreSQL', 'postgresql'],
        ['k8s', 'kubernetes'],
        ['react.js', 'react'],
        ['Google Cloud Platform', 'gcp'],
    ])('%s → %s', (raw, slug) => {
        expect(normalizeSkill(raw)).toBe(slug);
    });

    test('an unknown skill is null, not invented', () => {
        expect(normalizeSkill('telepathy')).toBeNull();
    });

    test('the longest alias wins', () => {
        // "google cloud platform" must not be shortened to "google cloud".
        expect(extractSkills('Experience with Google Cloud Platform.')).toContain('gcp');
    });
});

describe('extraction from prose', () => {
    test('finds several skills in one posting', () => {
        const out = extractSkills('You will work in TypeScript and Python, on Kubernetes, with Postgres.');
        expect(out).toContain('typescript');
        expect(out).toContain('python');
        expect(out).toContain('kubernetes');
        expect(out).toContain('postgresql');
    });

    test('output is sorted and de-duplicated, so a stored value is comparable', () => {
        const out = extractSkills('React, react.js, and more React.');
        expect(out).toEqual(['react']);
        expect([...out].sort()).toEqual(out);
    });

    test('punctuation-bearing names are matched despite word boundaries', () => {
        // `\bc++\b` can never match — `+` is not a word character.
        expect(extractSkills('Strong C++ background.')).toContain('cpp');
        expect(extractSkills('Built on .NET 8.')).toContain('csharp');
    });
});

describe('the ambiguous short names', () => {
    test('"Go" the language is matched only with a disambiguating neighbour', () => {
        expect(extractSkills('Experience with Golang services.')).toContain('go');
        expect(extractSkills('You will be a Go developer.')).toContain('go');
        expect(extractSkills('Languages: Python, Go, Rust')).toContain('go');
    });

    test('"go" the verb is not a programming language', () => {
        // The failure this guards: a chart topped by the word "going".
        expect(extractSkills('We are going to grow the team and go to market.')).not.toContain('go');
        expect(extractSkills('A great place to go far.')).not.toContain('go');
    });

    test('"rust" inside another word is not Rust', () => {
        expect(extractSkills('We build trust with customers.')).not.toContain('rust');
        expect(extractSkills('Systems programming in Rust.')).toContain('rust');
    });

    test('a bare "R" is not the R language', () => {
        expect(extractSkills('R&D team, reporting to the VP.')).not.toContain('r_lang');
        expect(extractSkills('Statistical work in R and Python.')).toContain('r_lang');
    });
});

describe('the company-name false positive', () => {
    // Found in real data: `figma` extracted from 176 of 176 Figma postings,
    // including a Compensation Partner and an Account Executive role.
    const posting = 'Join Figma to build tools. You will use React and TypeScript.';

    test('a company does not count as a skill on its own board', () => {
        const out = extractSkills(posting, { companyName: 'Figma' });
        expect(out).not.toContain('figma');
        expect(out).toContain('react');
    });

    test('but it does count on someone else’s board — that is the demand signal', () => {
        expect(extractSkills(posting, { companyName: 'Ramp' })).toContain('figma');
    });

    test('a suffixed legal name still suppresses the skill', () => {
        expect(extractSkills(posting, { companyName: 'Figma, Inc.' })).not.toContain('figma');
    });

    test('a company whose name is not a known skill changes nothing', () => {
        const withCo = extractSkills(posting, { companyName: 'Acme Corp' });
        expect(withCo).toContain('figma');
        expect(withCo).toContain('react');
    });
});

describe('shape guarantees', () => {
    test('empty input yields an empty list, never a throw', () => {
        expect(extractSkills('')).toEqual([]);
    });

    test('the max is respected', () => {
        const everything = knownSkills().join(' ') + ' python typescript kubernetes';
        expect(extractSkills(everything, { max: 5 }).length).toBeLessThanOrEqual(5);
    });

    test('the same text always yields the same list', () => {
        const text = 'Python, Kafka, Terraform, and React.';
        const runs = Array.from({ length: 4 }, () => extractSkills(text).join(','));
        expect(new Set(runs).size).toBe(1);
    });
});
