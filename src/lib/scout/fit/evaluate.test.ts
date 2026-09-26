import { describe, expect, test } from 'bun:test';
import { defaultUserGenerationPreferences, type UserGenerationPreferences } from '@/lib/userPreferences';
import type { JdData } from '@/lib/scout/types';
import { buildFitRecord, decideVerdict, evaluateFit, placeMatches, type FitRecord } from './evaluate';

function jd(overrides: Partial<JdData> = {}): JdData {
    return {
        role: 'Backend Engineer',
        company: 'Acme',
        seniority: 'mid',
        domain: 'payments',
        location: 'Bengaluru, Karnataka, India',
        workMode: 'hybrid',
        employmentType: 'Full-time',
        compensationText: null,
        experienceText: '3+ years of experience',
        requirements: [
            { id: 'r1', text: 'Strong experience with Go', kind: 'must' },
            { id: 'r2', text: 'Experience with PostgreSQL', kind: 'must' },
            { id: 'r3', text: 'Familiarity with Kubernetes', kind: 'nice' },
            { id: 'd1', text: 'Own services end to end', kind: 'responsibility' },
        ],
        skills: ['Go', 'PostgreSQL', 'Kubernetes'],
        responsibilities: ['Own services end to end'],
        applyUrl: null,
        ...overrides,
    };
}

function record(overrides: Partial<Parameters<typeof buildFitRecord>[0]> = {}): FitRecord {
    return buildFitRecord({
        profile: { location: 'Bengaluru', defaultTitle: 'Backend Engineer', defaultSummary: '', yearsExperience: '5' },
        experiences: [
            {
                company: 'Razorpay',
                role: 'Software Engineer',
                startDate: '2021',
                endDate: '',
                current: true,
                description: '',
                highlights: ['Built the settlement service in Go on PostgreSQL', 'Deployed services on Kubernetes'],
            },
            {
                company: 'Infosys',
                role: 'Associate Engineer',
                startDate: '2019',
                endDate: '2021',
                current: false,
                description: 'Maintained Java billing batch jobs',
                highlights: [],
            },
        ],
        projects: [],
        now: new Date('2026-09-23'),
        ...overrides,
    });
}

function prefs(overrides: Partial<UserGenerationPreferences> = {}): UserGenerationPreferences {
    return { ...defaultUserGenerationPreferences, preferredWorkModes: ['hybrid', 'remote'], ...overrides };
}

describe('record', () => {
    test('includes past roles, not only the current one', () => {
        const r = record();
        expect(r.corpus).toContain('java billing');
        expect(r.years).toBe(5);
        expect(r.yearsSource).toBe('stated');
    });

    test('derives years from role dates when none are stated', () => {
        const r = record({ profile: { location: '', defaultTitle: '', defaultSummary: '', yearsExperience: '' } });
        expect(r.years).toBe(7);
        expect(r.yearsSource).toBe('roles');
    });
});

describe('verdict', () => {
    test('a well-covered posting that fits preferences is strong, with quoted evidence', () => {
        const result = evaluateFit({ jd: jd(), jdText: '', record: record(), prefs: prefs(), answers: {} });
        expect(result.fit.verdict).toBe('strong');
        expect(result.fit.gaps).toHaveLength(0);
        const go = result.fit.matched.find((m) => m.requirementId === 'r1');
        expect(go?.evidence).toContain('settlement service in Go');
        expect(result.fit.notFitReasons).toEqual([]);
        expect(result.question).toBeNull();
    });

    test('responsibilities are not scored as requirements', () => {
        const result = evaluateFit({ jd: jd(), jdText: '', record: record(), prefs: prefs(), answers: {} });
        expect([...result.fit.matched, ...result.fit.gaps].map((m) => m.requirementId)).not.toContain('d1');
    });

    test('missing half the named must-haves is not a fit, and says which', () => {
        const result = evaluateFit({
            jd: jd({ skills: ['Rust', 'Cassandra', 'Kubernetes'], requirements: [
                { id: 'r1', text: 'Production Rust', kind: 'must' },
                { id: 'r2', text: 'Operating Cassandra', kind: 'must' },
            ] }),
            jdText: '',
            record: record(),
            prefs: prefs(),
            answers: {},
        });
        expect(result.fit.verdict).toBe('not_a_fit');
        expect(result.fit.gaps.every((gap) => gap.severity === 'blocking')).toBe(true);
        expect(result.fit.notFitReasons.join(' ')).toContain('Production Rust');
    });

    test('an onsite role for a remote-only candidate is not a fit on preference alone', () => {
        const result = evaluateFit({
            jd: jd({ workMode: 'onsite' }),
            jdText: '',
            record: record(),
            prefs: prefs({ preferredWorkModes: ['remote'] }),
            answers: {},
        });
        expect(result.fit.verdict).toBe('not_a_fit');
        expect(result.fit.notFitReasons[0]).toContain('Onsite');
    });

    test('a remote role for an onsite-preferring candidate is a soft conflict, not a block', () => {
        const result = evaluateFit({
            jd: jd({ workMode: 'remote' }),
            jdText: '',
            record: record(),
            prefs: prefs({ preferredWorkModes: ['onsite'] }),
            answers: {},
        });
        expect(result.fit.verdict).toBe('possible');
    });

    test('pay below the stated floor, same currency, is a blocking conflict', () => {
        const result = evaluateFit({
            jd: jd({ compensationText: '₹15-20 LPA' }),
            jdText: '',
            record: record(),
            prefs: prefs({ minCompensationText: '₹35 LPA' }),
            answers: {},
        });
        expect(result.fit.verdict).toBe('not_a_fit');
        expect(result.fit.preferenceChecks.find((c) => c.key === 'compensation')?.status).toBe('conflict');
    });

    test('pay in a different currency is unknown, never converted', () => {
        const result = evaluateFit({
            jd: jd({ compensationText: '$120k' }),
            jdText: '',
            record: record(),
            prefs: prefs({ minCompensationText: '₹35 LPA' }),
            answers: {},
        });
        expect(result.fit.preferenceChecks.find((c) => c.key === 'compensation')?.status).toBe('unknown');
    });

    test('far too few years is a blocking seniority conflict; one short is fine', () => {
        const junior = record({ profile: { location: 'Bengaluru', defaultTitle: 'Backend Engineer', defaultSummary: '', yearsExperience: '1' } });
        expect(evaluateFit({ jd: jd({ experienceText: '8+ years' }), jdText: '', record: junior, prefs: prefs(), answers: {} }).fit.verdict)
            .toBe('not_a_fit');
        const close = record({ profile: { location: 'Bengaluru', defaultTitle: 'Backend Engineer', defaultSummary: '', yearsExperience: '4' } });
        const seniority = evaluateFit({ jd: jd({ experienceText: '5+ years' }), jdText: '', record: close, prefs: prefs(), answers: {} })
            .fit.preferenceChecks.find((c) => c.key === 'seniority');
        expect(seniority?.status).toBe('match');
    });

    test('an empty record is unknown, not a fit or a miss', () => {
        const empty = buildFitRecord({
            profile: { location: '', defaultTitle: '', defaultSummary: '', yearsExperience: '' },
            experiences: [],
            projects: [],
        });
        const result = evaluateFit({ jd: jd(), jdText: '', record: empty, prefs: prefs(), answers: {} });
        expect(result.fit.verdict).toBe('unknown');
        expect(result.fit.score).toBeNull();
        expect(result.question).toBeNull();
    });

    test('decideVerdict: unknowns alone never make a role a non-fit', () => {
        expect(decideVerdict({
            checks: [{ key: 'location', status: 'unknown', detail: '', blocking: true }],
            coverage: { mustCovered: 2, mustTotal: 2, mustRatio: 1, niceRatio: null, uncoveredMusts: 0 },
            score: 90,
            recordEmpty: false,
        })).toBe('strong');
    });
});

describe('questions', () => {
    const elsewhere = { location: 'Pune, Maharashtra, India', workMode: 'onsite' as const };

    test('asks about relocation when it would decide the verdict', () => {
        const result = evaluateFit({
            jd: jd(elsewhere),
            jdText: '',
            record: record(),
            prefs: prefs({ preferredWorkModes: ['onsite', 'hybrid'] }),
            answers: {},
        });
        expect(result.question?.id).toBe('pref.relocate');
        expect(result.question?.step).toBe('fit');
        expect(result.question?.options?.map((o) => o.value)).toEqual(['yes', 'no', 'case_by_case']);
    });

    test('does not ask when the verdict is already decided on skills', () => {
        const result = evaluateFit({
            jd: jd({ ...elsewhere, skills: ['Rust', 'Cassandra'], requirements: [
                { id: 'r1', text: 'Production Rust', kind: 'must' },
                { id: 'r2', text: 'Operating Cassandra', kind: 'must' },
            ] }),
            jdText: '',
            record: record(),
            prefs: prefs({ preferredWorkModes: ['onsite'] }),
            answers: {},
        });
        expect(result.fit.verdict).toBe('not_a_fit');
        expect(result.question).toBeNull();
    });

    test('uses an answer instead of asking again', () => {
        const result = evaluateFit({
            jd: jd(elsewhere),
            jdText: '',
            record: record(),
            prefs: prefs({ preferredWorkModes: ['onsite', 'hybrid'] }),
            answers: { 'pref.relocate': 'no' },
        });
        expect(result.question).toBeNull();
        expect(result.fit.verdict).toBe('not_a_fit');
        expect(result.fit.notFitReasons[0]).toContain('not relocating');
    });

    test('asks at most one question per run, even if another unknown would matter', () => {
        // Relocation answered unintelligibly; the location check stays unknown,
        // and a second question is not asked.
        const result = evaluateFit({
            jd: jd({ ...elsewhere, compensationText: '₹20-30 LPA' }),
            jdText: '',
            record: record(),
            prefs: prefs({ preferredWorkModes: ['onsite'] }),
            answers: { 'pref.relocate': 'hmm' },
        });
        expect(result.question).toBeNull();
    });

    test('asks where the user wants to work when nothing is known', () => {
        const nowhere = record({ profile: { location: '', defaultTitle: 'Backend Engineer', defaultSummary: '', yearsExperience: '5' } });
        const result = evaluateFit({
            jd: jd(elsewhere),
            jdText: '',
            record: nowhere,
            prefs: prefs({ preferredWorkModes: ['onsite'] }),
            answers: {},
        });
        expect(result.question?.id).toBe('pref.location');
    });
});

describe('placeMatches', () => {
    test('aliases and country-level preferences', () => {
        expect(placeMatches('Bengaluru, Karnataka, India', ['Bangalore'])).toBe(true);
        expect(placeMatches('Gurugram, Haryana', ['Gurgaon'])).toBe(true);
        expect(placeMatches('Pune, Maharashtra, India', ['Remote India'])).toBe(true);
        expect(placeMatches('Pune, Maharashtra, India', ['Bengaluru'])).toBe(false);
        expect(placeMatches('New York, NY', ['Newark'])).toBe(false);
    });
});
