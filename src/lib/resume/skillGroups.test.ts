import { describe, expect, test } from 'bun:test';

import { allSkillSlugs } from '@/lib/radar/skills';
import { groupSkills, isRenderableSkill, __testing } from './skillGroups';
import { contactParts, normalizeUrl } from './contact';

describe('skills are grouped, not listed', () => {
    test('an engineer gets the rows a reader scans for', () => {
        const groups = groupSkills([
            'Go', 'Python', 'TypeScript',
            'PostgreSQL', 'Redis',
            'Kubernetes', 'Docker', 'AWS',
            'React',
        ]);
        expect(groups.map((g) => g.label)).toEqual([
            'Languages',
            'Databases & Data',
            'Cloud & Infrastructure',
            'Frontend',
        ]);
        expect(groups[0].skills).toEqual(['Go', 'Python', 'TypeScript']);
    });

    test('a designer gets design rows, and no empty engineering ones', () => {
        // The old LaTeX grouping knew forty engineering terms and put
        // everything else in "Other Tools" — so this entire section was one
        // bucket with a label that told the reader nothing.
        const groups = groupSkills([
            'Design systems', 'User research', 'Usability testing',
            'Figma', 'Sketch',
        ]);
        expect(groups.map((g) => g.label)).toEqual(['Design', 'Design Tools']);
        expect(groups.some((g) => g.label === 'Languages')).toBe(false);
    });

    test('a marketer too', () => {
        const groups = groupSkills(['Paid acquisition', 'SEO', 'HubSpot', 'Google Analytics']);
        expect(groups.map((g) => g.label)).toEqual(['Growth & Marketing', 'Marketing Platforms']);
    });

    test('one group is rendered without a label', () => {
        // A single bold "Languages:" above the only row is a label that
        // carries no information. Six skills, all languages, read as a list.
        const groups = groupSkills(['Go', 'Python', 'Java']);
        expect(groups).toHaveLength(1);
        expect(groups[0].label).toBe('');
    });

    test('the same skill spelled two ways occupies one row, once', () => {
        // "Postgres" and "PostgreSQL" in different rows is how it would have
        // looked — the old dedupe was on the raw lowercase string.
        const groups = groupSkills(['Postgres', 'PostgreSQL', 'Go']);
        const all = groups.flatMap((g) => g.skills);
        expect(all.filter((s) => /postgres/i.test(s))).toHaveLength(1);
    });

    test('canonical spelling wins — the resume says PostgreSQL, not postgres', () => {
        const groups = groupSkills(['postgres', 'aws', 'ec2']);
        const all = groups.flatMap((g) => g.skills);
        expect(all).toContain('PostgreSQL');
        expect(all).toContain('AWS');
        expect(all).toContain('EC2');
    });

    test('an unrecognised skill lands in a named row, never lost', () => {
        const groups = groupSkills(['Go', 'Erlang']);
        expect(groups.flatMap((g) => g.skills)).toContain('Erlang');
    });
});

describe('a sentence can never reach the page as a skill', () => {
    // A live resume shipped a SKILLS section reading "BA/BS in computer
    // science or related degree · Experience working on infrastructure for
    // distributed systems or cloud-native applications · …" — the posting's
    // requirement list, verbatim. `posting.isPlausibleSkill` is the real gate;
    // this is the check at the last point before ink, so a resume generated
    // before that gate existed still cannot print one.
    test.each([
        'BA/BS in computer science or related degree',
        'Experience working on infrastructure for distributed systems',
        'Writing well thought out design documents',
        'Designing for reliability and scale',
    ])('%p is refused', (sentence) => {
        expect(isRenderableSkill(sentence)).toBe(false);
    });

    test('the wreckage of a comma-split is refused', () => {
        // "Strong coding skills (examples given: Go, Python, Java, C++)" split
        // on commas leaves these two orphans with unbalanced brackets.
        expect(isRenderableSkill('Strong coding skills (examples given: Go')).toBe(false);
        expect(isRenderableSkill('C++)')).toBe(false);
    });

    test('but real multi-word skills survive', () => {
        for (const skill of ['Google Cloud Platform', 'React Native', 'Adobe Creative Suite', 'C++', 'CI/CD']) {
            expect(isRenderableSkill(skill), skill).toBe(true);
        }
    });

    test('the section drops them rather than printing them', () => {
        const groups = groupSkills([
            'Go',
            'BA/BS in computer science or related degree',
            'Python',
        ]);
        const all = groups.flatMap((g) => g.skills);
        expect(all).toEqual(['Go', 'Python']);
    });
});

describe('every taxonomy slug has a home', () => {
    test('no slug falls into the catch-all by accident', () => {
        // A slug added to the Radar taxonomy and missed here renders under
        // "Also", which looks exactly like the bug this module exists to fix.
        // `allSkillSlugs`, not `knownSkills` — the latter omits the AMBIGUOUS
        // table, which is where Go, Rust, R and C live. Testing against it
        // passed while four of the commonest languages were uncategorised.
        const uncategorised = allSkillSlugs().filter((slug) => !__testing.CATEGORY_BY_SLUG[slug]);
        expect(
            uncategorised,
            `${uncategorised.length} slug(s) have no category: ${uncategorised.join(', ')}`,
        ).toEqual([]);
    });

    test('every category used is one that renders', () => {
        const declared = new Set(__testing.CATEGORIES.map((c) => c.key));
        const used = new Set(Object.values(__testing.CATEGORY_BY_SLUG));
        const orphans = [...used].filter((key) => !declared.has(key));
        expect(orphans, `categories with no render order: ${orphans.join(', ')}`).toEqual([]);
    });
});

describe('contact links', () => {
    test('a bare handle does not become a broken link', () => {
        // The LaTeX header did `https://` + the value with any scheme stripped,
        // so someone who typed `priyar` got `https://priyar` at the top of
        // their resume — a 404 in the first line a recruiter clicks.
        expect(normalizeUrl('priyar')).toBeNull();
        const parts = contactParts({ github: 'priyar' });
        expect(parts[0]).toEqual({ label: 'priyar' });
    });

    test('the three ways people actually type a profile all work', () => {
        for (const value of [
            'linkedin.com/in/priya',
            'www.linkedin.com/in/priya',
            'https://linkedin.com/in/priya',
        ]) {
            expect(normalizeUrl(value), value).toMatch(/^https:\/\//);
        }
    });

    test('links carry a label, not the URL', () => {
        const parts = contactParts({ linkedin: 'linkedin.com/in/priya' });
        expect(parts[0].label).toBe('LinkedIn');
        expect(parts[0].href).toBe('https://linkedin.com/in/priya');
    });

    test('email and phone are addressable', () => {
        const parts = contactParts({ email: 'p@example.com', phone: '+91 76440 53913' });
        expect(parts[0]).toEqual({ label: 'p@example.com', href: 'mailto:p@example.com' });
        expect(parts[1].href).toBe('tel:+917644053913');
    });

    test('nothing empty is rendered', () => {
        expect(contactParts({ email: '  ', github: '', location: undefined })).toEqual([]);
    });
});
