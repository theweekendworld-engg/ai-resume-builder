/**
 * Evidence-gated skills.
 *
 * The first block is the 7 Aug audit failure, verbatim: the real candidate
 * corpus, the real posting, and the exact ten skills that shipped on a resume
 * without a shred of evidence behind them.
 */

import { describe, expect, test } from 'bun:test';

import { chooseSkills, isEvidenced } from './skills';
import { extractSkills } from '@/lib/radar/skills';

/** The audit candidate's actual history. */
const CORPUS = `
Rebuilt the freight billing service that issues customer invoices.
Cut invoice generation p95 from 4.2s to 900ms by replacing N+1 lookups with a batched query and a read-through cache.
Led the migration of 9 services from EC2 to Kubernetes with zero customer-visible downtime.
Introduced structured logging and traces across the billing domain, cutting mean time to diagnose from 45 minutes to 8.
Mentored 3 engineers; two were promoted within the year.
Built and owned the order settlement pipeline processing 1.2M orders per day.
Reduced settlement failures from 2.4% to 0.3% over two quarters by adding idempotent retries.
Wrote the Kafka consumer framework adopted by 6 teams.
`.toLowerCase();

/** What the Stripe posting asked for. */
const WANTED = ['Go', 'Java', 'PostgreSQL', 'Kafka', 'Kubernetes', 'AWS', 'Terraform', 'gRPC'];

describe('the audit failure cannot happen again', () => {
    const result = chooseSkills({ wanted: WANTED, corpus: CORPUS, candidateSkills: [], max: 20 });

    test('every skill that ships is evidenced', () => {
        const slugs = new Set(extractSkills(CORPUS, { max: 200 }));
        for (const skill of result.skills) {
            expect(isEvidenced(skill, CORPUS, slugs)).toBe(true);
        }
    });

    test.each(['Go', 'Java', 'PostgreSQL', 'AWS', 'Terraform', 'gRPC'])(
        '%s never reaches the resume — the candidate has never mentioned it',
        (skill) => {
            expect(result.skills).not.toContain(skill);
        },
    );

    test('the two they can actually evidence do ship', () => {
        expect(result.skills).toContain('Kafka');
        expect(result.skills).toContain('Kubernetes');
    });

    test('the rest come back as gaps, not as silence', () => {
        // The honest version of what the old code was reaching for: telling
        // the candidate what the posting wants that they cannot back up.
        expect(result.gaps).toContain('Go');
        expect(result.gaps).toContain('Terraform');
        expect(result.gaps).toContain('PostgreSQL');
    });
});

describe('the hard matching cases', () => {
    const slugs = (text: string) => new Set(extractSkills(text.toLowerCase(), { max: 200 }));

    test('"Go" does not match "going"', () => {
        // The naive substring check that would have made this whole module
        // pointless.
        const corpus = 'going to the shops, ongoing work, forgot the goal';
        expect(isEvidenced('Go', corpus, slugs(corpus))).toBe(false);
    });

    test('"Go" matches when it is actually the language', () => {
        const corpus = 'wrote the service in go and rust';
        expect(isEvidenced('Go', corpus, slugs(corpus))).toBe(true);
    });

    test('Postgres and PostgreSQL are the same skill', () => {
        const corpus = 'migrated the postgres cluster';
        expect(isEvidenced('PostgreSQL', corpus, slugs(corpus))).toBe(true);
    });

    test('C++ matches despite being regex syntax', () => {
        const corpus = 'ten years of c++ and embedded work';
        expect(isEvidenced('C++', corpus, slugs(corpus))).toBe(true);
    });

    test('a skill outside the curated map still matches by word boundary', () => {
        // Non-engineering professions live almost entirely in this tail, so it
        // has to work rather than merely exist.
        const corpus = 'built the three-statement model and ran financial modelling for the board';
        expect(isEvidenced('financial modelling', corpus, slugs(corpus))).toBe(true);
        expect(isEvidenced('discounted cash flow', corpus, slugs(corpus))).toBe(false);
    });

    test('a tail skill is not matched inside a longer word', () => {
        const corpus = 'we used sketchup for the site plan';
        expect(isEvidenced('Sketch', corpus, slugs(corpus))).toBe(false);
    });
});

describe('ordering and labels', () => {
    test('what the posting asked for leads', () => {
        const result = chooseSkills({
            wanted: ['Kubernetes'],
            corpus: CORPUS,
            candidateSkills: ['Kafka'],
            max: 20,
        });
        expect(result.skills[0]).toBe('Kubernetes');
    });

    test('the posting’s spelling wins', () => {
        // Matching the employer's vocabulary is the entire legitimate purpose
        // of ATS optimisation, and it is not a lie — same skill.
        const corpus = 'ran the postgres migration';
        const result = chooseSkills({
            wanted: ['PostgreSQL'],
            corpus,
            candidateSkills: ['Postgres'],
            max: 20,
        });
        expect(result.skills).toEqual(['PostgreSQL']);
    });

    test('the candidate’s own skills follow, and are evidence-checked too', () => {
        const result = chooseSkills({
            wanted: [],
            corpus: CORPUS,
            candidateSkills: ['Kafka', 'Rust'],
            max: 20,
        });
        expect(result.skills).toContain('Kafka');
        expect(result.skills).not.toContain('Rust');
    });

    test('the cap trims the tail, never the answers', () => {
        const result = chooseSkills({
            wanted: ['Kubernetes', 'Kafka'],
            corpus: CORPUS,
            candidateSkills: ['Docker', 'Redis'],
            max: 2,
        });
        expect(result.skills).toEqual(['Kubernetes', 'Kafka']);
    });

    test('gaps are not capped away — they are the useful output', () => {
        const result = chooseSkills({ wanted: WANTED, corpus: CORPUS, candidateSkills: [], max: 1 });
        expect(result.skills).toHaveLength(1);
        expect(result.gaps.length).toBeGreaterThan(4);
    });
});

describe('the section is filled from the candidate’s own text', () => {
    test('skills the corpus evidences appear even when nobody listed them', () => {
        // The first live v2 run produced a two-item skills list — Kafka and
        // Kubernetes — for a candidate whose history plainly shows more,
        // because the only inputs were the posting's list and a `technologies`
        // array from a project selection had not picked. A two-line skills
        // section reads as a broken tool.
        const result = chooseSkills({
            wanted: [],
            corpus: CORPUS,
            candidateSkills: [],
            max: 20,
        });
        // EC2 is the specific one: the corpus says "migrated 9 services from
        // EC2 to Kubernetes" and neither the posting nor any list named it.
        expect(result.skills).toContain('EC2');
        expect(result.skills).toContain('Kafka');
        expect(result.skills).toContain('Kubernetes');
    });

    test('but it cannot invent breadth the history does not have', () => {
        // The honest limit. This candidate writes in outcomes rather than
        // technologies, so their section is short — and the gap report is
        // where that gets said, not a padded list.
        const result = chooseSkills({ wanted: [], corpus: CORPUS, candidateSkills: [], max: 20 });
        expect(result.skills.length).toBeLessThan(8);
    });

    test('everything it adds is still evidence-gated', () => {
        const result = chooseSkills({ wanted: [], corpus: CORPUS, candidateSkills: [], max: 20 });
        const slugs = new Set(extractSkills(CORPUS, { max: 200 }));
        for (const skill of result.skills) {
            expect(isEvidenced(skill, CORPUS, slugs)).toBe(true);
        }
    });

    test('acronyms keep their real casing', () => {
        // Title-casing a slug renders "aws" as "Aws". A skills section that
        // misspells the technology it claims is worse than one that omits it.
        const result = chooseSkills({
            wanted: [],
            corpus: 'deployed to aws using terraform and wrote sql reports',
            candidateSkills: [],
            max: 20,
        });
        expect(result.skills).toContain('AWS');
        expect(result.skills).toContain('SQL');
        expect(result.skills).not.toContain('Aws');
    });

    test('an empty corpus still adds nothing', () => {
        expect(chooseSkills({ wanted: [], corpus: '', candidateSkills: [], max: 20 }).skills)
            .toEqual([]);
    });
});

describe('degenerate input', () => {
    test('an empty corpus evidences nothing', () => {
        const result = chooseSkills({ wanted: WANTED, corpus: '', candidateSkills: [], max: 20 });
        expect(result.skills).toEqual([]);
        expect(result.gaps).toHaveLength(WANTED.length);
    });

    test('a posting naming no skills still surfaces the candidate’s own', () => {
        const result = chooseSkills({
            wanted: [],
            corpus: CORPUS,
            candidateSkills: ['Kafka'],
            max: 20,
        });
        expect(result.skills).toContain('Kafka');
        expect(result.gaps).toEqual([]);
    });

    test('duplicates collapse across every source', () => {
        const result = chooseSkills({
            wanted: ['Kafka'],
            corpus: CORPUS,
            candidateSkills: ['Kafka', 'kafka'],
            max: 20,
        });
        // Named by the posting, named twice by the candidate, and present in
        // the corpus — still one line.
        expect(result.skills.filter((s) => s.toLowerCase() === 'kafka')).toHaveLength(1);
    });
});
