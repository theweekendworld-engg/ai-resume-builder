import { describe, expect, test } from 'bun:test';
import { defaultUserGenerationPreferences, type UserGenerationPreferences } from '@/lib/userPreferences';
import type { JdData } from '@/lib/scout/types';
import { buildFitRecord, decideVerdict, evaluateFit, MAX_RECORD_WINS, placeMatches, WORK_LOG_SOURCE, type FitRecord } from './evaluate';

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

    test('derives full-time years from role dates when none are stated', () => {
        // "2019"–"2021" then "2021"–now, read from mid-year: Jul 2019 to Sep 2026.
        const r = record({ profile: { location: '', defaultTitle: '', defaultSummary: '', yearsExperience: '' } });
        expect(r.years).toBe(7.2);
        expect(r.yearsSource).toBe('roles');
        expect(r.internshipMonths).toBe(0);
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

    test('far too few years is a blocking seniority conflict; a year short is unmet but not a downgrade', () => {
        const junior = record({ profile: { location: 'Bengaluru', defaultTitle: 'Backend Engineer', defaultSummary: '', yearsExperience: '1' } });
        expect(evaluateFit({ jd: jd({ experienceText: '8+ years' }), jdText: '', record: junior, prefs: prefs(), answers: {} }).fit.verdict)
            .toBe('not_a_fit');
        const close = record({ profile: { location: 'Bengaluru', defaultTitle: 'Backend Engineer', defaultSummary: '', yearsExperience: '4' } });
        const result = evaluateFit({ jd: jd({ experienceText: '5+ years' }), jdText: '', record: close, prefs: prefs(), answers: {} });
        // 4 is not 5+: the check says so. The verdict is not dropped for it twice.
        expect(result.fit.preferenceChecks.find((c) => c.key === 'seniority')).toMatchObject({ status: 'conflict', detail: 'Asks for 5+ years; you have 4 years, as stated on your profile' });
        expect(result.fit.verdict).toBe('strong');
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

describe('confirmed Wins in the record', () => {
    const kafka = jd({
        requirements: [
            { id: 'r1', text: 'Strong experience with Go', kind: 'must' },
            { id: 'r2', text: 'Experience with PostgreSQL', kind: 'must' },
            { id: 'r3', text: 'Built event pipelines on Kafka', kind: 'must' },
        ],
        skills: ['Go', 'PostgreSQL', 'Kafka'],
    });

    test('a Win is an evidence line, labelled as the work log, after the roles', () => {
        const r = record({ wins: [{ title: 'Moved settlement onto Kafka', narrative: 'Replaced the nightly batch with a Kafka event pipeline; reconciliation now runs hourly.' }] });
        const line = r.lines.find((l) => l.source === WORK_LOG_SOURCE);
        expect(line?.text).toStartWith('Moved settlement onto Kafka. Replaced the nightly batch');
        expect(r.lines.findIndex((l) => l.source === WORK_LOG_SOURCE)).toBeGreaterThan(r.lines.findIndex((l) => l.source.includes(' at ')));
        expect(r.corpus).toContain('kafka');
    });

    test('evidence that lives only in a Win lifts coverage and the score', () => {
        const without = evaluateFit({ jd: kafka, jdText: '', record: record(), prefs: prefs(), answers: {} });
        const withWin = evaluateFit({
            jd: kafka, jdText: '', prefs: prefs(), answers: {},
            record: record({ wins: [{ title: 'Moved settlement onto Kafka', narrative: '' }] }),
        });
        expect(withWin.coverage.mustCovered).toBeGreaterThan(without.coverage.mustCovered);
        expect(withWin.fit.score!).toBeGreaterThan(without.fit.score!);
        expect(withWin.fit.matched.some((m) => m.evidence.includes('Kafka') && m.evidence.includes(WORK_LOG_SOURCE))).toBe(true);
    });

    test('a record of Wins alone is not empty', () => {
        const winsOnly = buildFitRecord({
            profile: { location: '', defaultTitle: '', defaultSummary: '', yearsExperience: '' },
            experiences: [],
            projects: [],
            wins: [{ title: 'Shipped the Go ledger rewrite', narrative: '' }],
        });
        expect(winsOnly.empty).toBe(false);
    });

    test('capped, long narratives cut, blank titles skipped', () => {
        const many = Array.from({ length: MAX_RECORD_WINS + 5 }, (_, i) => ({ title: `Win ${i}`, narrative: 'x'.repeat(1_000) }));
        const r = record({ wins: [{ title: '  ', narrative: 'ignored' }, ...many] });
        const winLines = r.lines.filter((l) => l.source === WORK_LOG_SOURCE);
        expect(winLines).toHaveLength(MAX_RECORD_WINS);
        expect(winLines[0].text.length).toBeLessThan(320);
    });
});

// ───────────────────────────────────────── QA 2026-11-07: the FDE post

describe('the Forward Deployed AI Engineer post (QA 2026-11-07)', () => {
    const POST = `Forward Deployed AI Engineer (#C3) | Claude
Remote, DMV preferred | $90/hr or $190K salary
jobs@iserveworld.com | chris.d@iserveworld.com
Build and deploy client-facing AI agents using Claude, MCP, RAG, and A2A or multi-agent patterns. Requires 3+ years in engineering, 2+ recent years building GenAI solutions, client-facing delivery experience, and a bachelor’s degree. Must obtain HHS Public Trust before onboarding.`;

    const fde = jd({
        role: 'Forward Deployed AI Engineer',
        company: 'iServeWorld',
        location: null,
        workMode: 'remote',
        compensationText: '$90/hr',
        experienceText: '3+ years',
        requirements: [
            { id: 'r1', text: '3+ years in engineering', kind: 'must' },
            { id: 'r2', text: '2+ recent years building GenAI solutions', kind: 'must' },
            { id: 'r3', text: 'Client-facing delivery experience', kind: 'must' },
            { id: 'r4', text: "Bachelor's degree", kind: 'must' },
            { id: 'r5', text: 'Must obtain HHS Public Trust before onboarding', kind: 'must' },
        ],
        skills: ['Claude', 'MCP', 'RAG'],
    });

    /** Two internships, then full-time from June 2024. Bengaluru. Nothing stated about years or authorization. */
    function qaRecord(overrides: { location?: string; plivoStart?: string } = {}): FitRecord {
        return buildFitRecord({
            profile: { location: overrides.location ?? 'Bengaluru, India', defaultTitle: 'Software Engineer', defaultSummary: '', yearsExperience: '' },
            experiences: [
                { company: 'Swachh.io', role: 'SDE Intern', startDate: 'May 2023', endDate: 'Jul 2023', current: false, description: '', highlights: ['Built a FastAPI backend'] },
                { company: '2Sigma School', role: 'SDE Intern', startDate: 'Mar 2024', endDate: 'May 2024', current: false, description: '', highlights: ['Built LLM grading on GPT-4'] },
                { company: 'Hyperbots', role: 'Software Engineer I', startDate: 'Jun 2024', endDate: 'Aug 2025', current: false, description: '', highlights: ['Built GenAI invoice agents with RAG on Claude', 'Delivered client-facing deployments for enterprise customers'] },
                { company: 'Plivo', role: 'Software Engineer I', startDate: overrides.plivoStart ?? 'Sep 2025', endDate: '', current: true, description: '', highlights: ['Built voice AI agents with LLMs and MCP tools'] },
            ],
            projects: [],
            education: [{ institution: 'VIT', degree: 'B.Tech', fieldOfStudy: 'Computer Science' }],
            now: new Date('2026-11-07'),
        });
    }

    function judge(r: FitRecord, entries: Record<string, string>) {
        const out = new Map<string, { requirementId: string; lineIndex: number | null; strength: 'direct' | 'partial' | null; source: 'model' }>();
        for (const [id, fragment] of Object.entries(entries)) {
            const index = r.lines.findIndex((line) => line.text.includes(fragment));
            if (index < 0) throw new Error(`no line has "${fragment}"`);
            out.set(id, { requirementId: id, lineIndex: index, strength: 'direct', source: 'model' });
        }
        return out;
    }

    const lines = { r2: 'GenAI invoice agents', r3: 'client-facing deployments', r4: 'B.Tech' };

    test('tenure is full-time only: about 2 years, plus internships, and 3+ is unmet', () => {
        const r = qaRecord();
        expect(r.yearsSource).toBe('roles');
        expect(r.years).toBe(2.4);
        const result = evaluateFit({ jd: fde, jdText: POST, record: r, prefs: prefs({ preferredWorkModes: ['remote'] }), answers: {}, judgements: judge(r, lines) });
        expect(result.fit.preferenceChecks.find((c) => c.key === 'seniority')).toEqual({
            key: 'seniority', status: 'conflict', detail: 'Asks for 3+ years; you have about 2 years full-time (plus internships)',
        });
        expect(result.fit.gaps.map((g) => g.requirementId)).toContain('r1');
        expect(JSON.stringify(result.fit.matched)).not.toMatch(/3 years of experience/);
    });

    test('"2+ recent years building GenAI" from a 15-month role is partial; a role that spans it is direct', () => {
        const short = qaRecord();
        const partial = evaluateFit({ jd: fde, jdText: POST, record: short, prefs: prefs(), answers: {}, judgements: judge(short, lines) });
        expect(partial.fit.matched.find((m) => m.requirementId === 'r2')?.strength).toBe('partial');

        // The same bullet, in a current role that has run 2.5 years: the dates cover it.
        const long = qaRecord({ plivoStart: 'May 2024' });
        const plivoLine = { ...lines, r2: 'voice AI agents with LLMs' };
        const direct = evaluateFit({ jd: fde, jdText: POST, record: long, prefs: prefs(), answers: {}, judgements: judge(long, plivoLine) });
        expect(direct.fit.matched.find((m) => m.requirementId === 'r2')?.strength).toBe('direct');
    });

    test('HHS Public Trust is an eligibility conflict that leads, not a must-have among nine', () => {
        const r = qaRecord();
        const result = evaluateFit({ jd: fde, jdText: POST, record: r, prefs: prefs(), answers: {}, judgements: judge(r, lines) });
        const eligibility = result.fit.preferenceChecks[0];
        expect(eligibility.key).toBe('eligibility');
        expect(eligibility.status).toBe('conflict');
        expect(eligibility.detail).toStartWith('You may not be eligible: requires HHS Public Trust, which generally needs US citizenship or residency.');
        expect(result.fit.notFitReasons[0]).toBe(eligibility.detail);
        // Not scored as a requirement at all.
        expect([...result.fit.matched, ...result.fit.gaps].map((entry) => entry.requirementId)).not.toContain('r5');
        expect(result.coverage.mustTotal).toBe(4);
        expect(result.fit.verdict).toBe('not_a_fit');
    });

    test('remote within the US is a location conflict for someone in Bengaluru, not a pass', () => {
        const r = qaRecord();
        const result = evaluateFit({ jd: fde, jdText: POST, record: r, prefs: prefs(), answers: {}, judgements: judge(r, lines) });
        expect(result.fit.preferenceChecks.find((c) => c.key === 'location')).toEqual({
            key: 'location', status: 'conflict', detail: 'Remote within the US (DMV preferred); you are based in Bengaluru, India',
        });
    });

    test('a US citizen in Virginia passes both, and only the years remain', () => {
        const r = qaRecord({ location: 'Arlington, VA' });
        const result = evaluateFit({
            jd: fde, jdText: POST, record: r, prefs: prefs({ workAuthorization: 'US citizen', minCompensationText: '$80/hr' }), answers: {}, judgements: judge(r, lines),
        });
        expect(result.fit.preferenceChecks.find((c) => c.key === 'eligibility')?.status).toBe('match');
        expect(result.fit.preferenceChecks.find((c) => c.key === 'location')?.status).toBe('match');
        expect(result.fit.verdict).not.toBe('not_a_fit');
        expect(result.question).toBeNull();
    });

    test('nothing known about where or who: asked, never passed', () => {
        const r = qaRecord({ location: '' });
        const result = evaluateFit({ jd: fde, jdText: POST, record: r, prefs: prefs({ minCompensationText: '$80/hr' }), answers: {}, judgements: judge(r, lines) });
        expect(result.fit.preferenceChecks.find((c) => c.key === 'eligibility')?.status).toBe('unknown');
        expect(result.fit.preferenceChecks.find((c) => c.key === 'location')?.status).toBe('unknown');
        expect(['pref.location', 'pref.workAuth']).toContain(result.question?.id ?? '');
    });

    test('the work authorization question offers the four standings and its answer settles the check', () => {
        const r = qaRecord({ location: 'Arlington, VA' });
        const asked = evaluateFit({ jd: fde, jdText: POST, record: r, prefs: prefs({ minCompensationText: '$80/hr' }), answers: {}, judgements: judge(r, lines) });
        expect(asked.question?.id).toBe('pref.workAuth');
        expect(asked.question?.options?.map((o) => o.value)).toEqual(['US citizen', 'US permanent resident', 'Authorized to work in the US on a visa', 'Not authorized to work in the US']);
        const answered = evaluateFit({ jd: fde, jdText: POST, record: r, prefs: prefs({ minCompensationText: '$80/hr' }), answers: { 'pref.workAuth': 'US citizen' }, judgements: judge(r, lines) });
        expect(answered.fit.preferenceChecks.find((c) => c.key === 'eligibility')?.status).toBe('match');
    });

    test('a few months short of the years is partial credit, not a gap and not a pass', () => {
        // Full-time from Jan 2024: 34 months by Nov 2026, for a 3+ year ask.
        const r = buildFitRecord({
            profile: { location: 'Arlington, VA', defaultTitle: 'Software Engineer', defaultSummary: '', yearsExperience: '' },
            experiences: [{ company: 'Acme', role: 'Software Engineer', startDate: 'Jan 2024', endDate: '', current: true, description: '', highlights: ['Built Go services'] }],
            projects: [],
            now: new Date('2026-11-07'),
        });
        const result = evaluateFit({ jd: jd({ experienceText: '3+ years', requirements: [{ id: 't', text: '3+ years of professional experience', kind: 'must' }] }), jdText: '', record: r, prefs: prefs(), answers: {} });
        expect(result.fit.matched.find((m) => m.requirementId === 't')).toMatchObject({ strength: 'partial' });
        expect(result.fit.matched.find((m) => m.requirementId === 't')?.evidence).toContain('a few months short of 3');
        expect(result.fit.preferenceChecks.find((c) => c.key === 'seniority')?.status).toBe('unknown');
    });

    test('plain remote, with no region, still does not decide on location', () => {
        const result = evaluateFit({ jd: jd({ workMode: 'remote', location: 'Remote' }), jdText: 'Remote, work from anywhere.', record: record(), prefs: prefs(), answers: {} });
        expect(result.fit.preferenceChecks.find((c) => c.key === 'location')).toMatchObject({ status: 'match', detail: 'Remote, with no region stated, so location should not decide it' });
    });
});
