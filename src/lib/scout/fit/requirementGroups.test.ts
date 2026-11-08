import { describe, expect, test } from 'bun:test';
import type { JdData, ScoutRequirement } from '@/lib/scout/types';
import { defaultUserGenerationPreferences } from '@/lib/userPreferences';
import { buildFitRecord, evaluateFit } from './evaluate';
import { fallbackJudgements, lineForOption, planMatching } from './match';
import { groupRequirements, optionsIn, partsOf } from './requirementGroups';

/** The Sarvam posting from the live test (2026-11-08), as the page read. */
const SARVAM = `About the role
Sarvam is building voice AI for India. You will own the real-time voice stack.
What we're looking for:
• 2+ years of backend engineering
• Experience with real-time audio or telephony (RTP, SIP, FreeSWITCH)
• Comfortable with Kubernetes and AWS
• Go or Python
• Experience with LLM-based agents is a plus`;

const must = (id: string, text: string): ScoutRequirement => ({ id, text, kind: 'must' });
const texts = (list: ScoutRequirement[]) => list.map((r) => r.text);

describe('a requirement\'s own examples and alternatives', () => {
    test('the Sarvam line: parenthesised examples and the "or" in the parent are all options', () => {
        expect(optionsIn('Experience with real-time audio or telephony (RTP, SIP, FreeSWITCH)'))
            .toEqual(['RTP', 'SIP', 'FreeSWITCH', 'real-time audio', 'telephony']);
    });

    test('"such as" lists, with C# kept apart from C and a slash pair split', () => {
        expect(optionsIn('Experience developing applications using languages such as Python, Java, C#, or JavaScript/TypeScript'))
            .toEqual(['Python', 'Java', 'C#', 'JavaScript', 'TypeScript']);
    });

    test('"and" is not a choice; "or" is', () => {
        expect(optionsIn('Comfortable with Kubernetes and AWS')).toEqual([]);
        expect(optionsIn('Go or Python')).toEqual(['Go', 'Python']);
        expect(optionsIn('Proficiency in Go or Python')).toEqual(['Go', 'Python']);
    });

    test('not examples: qualifiers in parentheses, "or more", degrees, "would like", CI/CD', () => {
        expect(optionsIn('Kubernetes (preferred)')).toEqual([]);
        expect(optionsIn('Production Go (3+ years)')).toEqual([]);
        expect(optionsIn('One or more years of experience with Go')).toEqual([]);
        expect(optionsIn("Bachelor's or Master's degree in Computer Science or a related field")).toEqual([]);
        expect(optionsIn('We would like you to know Go')).toEqual([]);
        expect(optionsIn('Experience with cloud platforms (AWS, GCP, or Azure) and CI/CD')).toEqual(['AWS', 'GCP', 'Azure']);
    });

    test('what a sibling names, ready to compare with a list', () => {
        expect(partsOf('SIP')).toEqual(['sip']);
        expect(partsOf('Experience with SIP')).toEqual(['sip']);
        expect(partsOf('Knowledge of RTP and SIP')).toEqual(['rtp', 'sip']);
        expect(partsOf('Proficiency in C#')).toEqual(['csharp']);
        expect(partsOf('JavaScript/TypeScript')).toEqual(['javascript', 'typescript']);
    });
});

describe('groupRequirements', () => {
    test('the Sarvam over-split: four must-haves become one, and "Go or Python" one; Kubernetes and AWS stay two', () => {
        const grouped = groupRequirements([
            must('r1', '2+ years of backend engineering'),
            must('r2', 'Experience with real-time audio or telephony (RTP, SIP, FreeSWITCH)'),
            must('r3', 'RTP'),
            must('r4', 'SIP'),
            must('r5', 'FreeSWITCH'),
            must('r6', 'Kubernetes'),
            must('r7', 'AWS'),
            must('r8', 'Go'),
            must('r9', 'Python'),
        ], SARVAM);

        expect(grouped.map((r) => r.id)).toEqual(['r1', 'r2', 'r6', 'r7', 'r8']);
        const telephony = grouped.find((r) => r.id === 'r2')!;
        expect(telephony.text).toBe('Experience with real-time audio or telephony (RTP, SIP, FreeSWITCH)');
        expect(telephony.anyOf).toEqual(['RTP', 'SIP', 'FreeSWITCH', 'real-time audio', 'telephony']);
        expect(grouped.find((r) => r.id === 'r8')).toEqual({ id: 'r8', text: 'Go or Python', kind: 'must', anyOf: ['Go', 'Python'] });
        expect(grouped.find((r) => r.id === 'r6')?.anyOf).toBeUndefined();
    });

    test('a parent the model trimmed gets its examples back from the posting', () => {
        const grouped = groupRequirements([
            must('r2', 'Experience with real-time audio or telephony'),
            must('r3', 'Experience with RTP'),
            must('r4', 'SIP'),
        ], SARVAM);
        expect(grouped).toHaveLength(1);
        expect(grouped[0].text).toBe('Experience with real-time audio or telephony (RTP, SIP, FreeSWITCH)');
        expect(grouped[0].anyOf).toContain('SIP');
    });

    test('children split off a parent the model dropped come back as the posting\'s own requirement', () => {
        const grouped = groupRequirements([{ id: 'r3', text: 'RTP', kind: 'nice' }, must('r4', 'SIP')], SARVAM);
        expect(grouped).toEqual([{
            id: 'r3',
            text: 'Experience with real-time audio or telephony (RTP, SIP, FreeSWITCH)',
            kind: 'must',
            anyOf: ['RTP', 'SIP', 'FreeSWITCH', 'real-time audio', 'telephony'],
        }]);
    });

    test('the languages line: one requirement any of five languages meets', () => {
        const posting = 'Minimum qualifications\n- Experience developing applications using languages such as Python, Java, C#, or JavaScript/TypeScript.\n- Experience with SQL and NoSQL databases.';
        const grouped = groupRequirements([
            must('r1', 'Experience developing applications using languages such as Python, Java, C#, or JavaScript/TypeScript'),
            must('r2', 'Python'),
            must('r3', 'Proficiency in Java'),
            must('r4', 'C#'),
            must('r5', 'JavaScript/TypeScript'),
            must('r6', 'Experience with SQL and NoSQL databases'),
        ], posting);
        expect(grouped.map((r) => r.id)).toEqual(['r1', 'r6']);
        expect(grouped[0].anyOf).toEqual(['Python', 'Java', 'C#', 'JavaScript', 'TypeScript']);
    });

    test('a skill the posting also names on its own stays a requirement of its own', () => {
        const posting = 'Strong Python skills are required.\nExperience with languages such as Python or Java for services.';
        const grouped = groupRequirements([
            must('r1', 'Strong Python skills'),
            must('r2', 'Experience with languages such as Python or Java'),
            must('r3', 'Java'),
        ], posting);
        expect(texts(grouped)).toEqual(['Strong Python skills', 'Experience with languages such as Python or Java']);
    });

    test('two lists joined by "and" need both halves: examples still fold in, but one example cannot meet it', () => {
        const grouped = groupRequirements([
            must('r1', 'Experience with message queues (Kafka, RabbitMQ) and caching (Redis)'),
            must('r2', 'Kafka'),
            must('r3', 'Experience with Go or Python and Kubernetes'),
            must('r4', 'Python'),
        ]);
        expect(grouped.map((r) => [r.id, r.anyOf ?? null])).toEqual([['r1', null], ['r3', null]]);
    });

    test('genuine conjunctions in one requirement are left alone', () => {
        const grouped = groupRequirements([must('r1', 'Comfortable with Kubernetes and AWS')], 'You are comfortable with Kubernetes and AWS.');
        expect(grouped).toEqual([must('r1', 'Comfortable with Kubernetes and AWS')]);
    });

    test('idempotent, and responsibilities pass through', () => {
        const input = [
            must('r2', 'Experience with real-time audio or telephony'),
            must('r4', 'SIP'),
            { id: 'd1', text: 'Own SIP trunking (RTP, SRTP)', kind: 'responsibility' as const },
        ];
        const once = groupRequirements(input, SARVAM);
        expect(groupRequirements(once, SARVAM)).toEqual(once);
        expect(once.at(-1)).toEqual({ id: 'd1', text: 'Own SIP trunking (RTP, SRTP)', kind: 'responsibility' });
    });

    test('without the posting text, a requirement\'s own list still absorbs its examples', () => {
        const grouped = groupRequirements([
            must('r1', 'Experience with real-time audio or telephony (RTP, SIP, FreeSWITCH)'),
            must('r2', 'SIP'),
        ]);
        expect(grouped.map((r) => r.id)).toEqual(['r1']);
    });
});

// ───────────────────────────────────────────────────────────── matching

function jd(requirements: ScoutRequirement[], skills: string[] = []): JdData {
    return {
        role: 'Voice AI Engineer', company: 'Sarvam', seniority: 'mid', domain: 'voice', location: 'Bengaluru',
        workMode: 'onsite', employmentType: null, compensationText: null, experienceText: null,
        requirements, skills, responsibilities: [], applyUrl: null,
    };
}

/** The owner's record shape (resume_ai_voice): SIP is not in it; RTP and FreeSWITCH are. */
const owner = buildFitRecord({
    profile: { location: 'Bengaluru', defaultTitle: 'Software Engineer', defaultSummary: '', yearsExperience: '' },
    experiences: [
        {
            company: 'Plivo', role: 'Software Engineer I', startDate: 'Sep 2025', endDate: '', current: true, description: '',
            highlights: [
                'Optimized the voice media path (RTP handling, kernel and socket tuning, codec/transcoding hot paths) and shipped neural noise cancellation as a FreeSWITCH module in C, used on 7.5M calls.',
                'Built an agentic AI support platform using RAG over production logs, internal docs and microservice codebases.',
            ],
        },
        {
            company: 'Hyperbots', role: 'Software Engineer I', startDate: 'Jun 2024', endDate: 'Aug 2025', current: false, description: '',
            highlights: ['Built and ran 5 microservices in Java (Spring Boot) handling 100K+ events a day.'],
        },
    ],
    projects: [],
    now: new Date('2026-11-08'),
});

describe('matching an any-of requirement', () => {
    const telephony: ScoutRequirement = {
        id: 'r2', kind: 'must',
        text: 'Experience with real-time audio or telephony (RTP, SIP, FreeSWITCH)',
        anyOf: ['RTP', 'SIP', 'FreeSWITCH', 'real-time audio', 'telephony'],
    };
    const languages: ScoutRequirement = {
        id: 'r3', kind: 'must',
        text: 'Experience developing applications using languages such as Python, Java, C#, or JavaScript/TypeScript',
        anyOf: ['Python', 'Java', 'C#', 'JavaScript', 'TypeScript'],
    };

    test('one listed example in the record settles it directly, with no model call; SIP is never asked for', () => {
        const plan = planMatching(jd([telephony, languages], ['RTP', 'SIP', 'FreeSWITCH', 'Python', 'Java', 'C#']), owner);
        expect(plan.toAsk).toEqual([]);
        expect(owner.lines[plan.prefiltered.get('r2')!.lineIndex!].text).toContain('RTP handling');
        expect(owner.lines[plan.prefiltered.get('r3')!.lineIndex!].text).toContain('Java (Spring Boot)');
    });

    test('the fit shows no gap for SIP, and Kubernetes and AWS are still two checks', () => {
        const requirements = groupRequirements([
            must('r1', 'Experience with real-time audio or telephony (RTP, SIP, FreeSWITCH)'),
            must('r2', 'RTP'), must('r3', 'SIP'), must('r4', 'FreeSWITCH'),
            must('r5', 'Kubernetes'), must('r6', 'AWS'),
        ], SARVAM);
        const result = evaluateFit({
            jd: jd(requirements, ['RTP', 'SIP', 'FreeSWITCH', 'Kubernetes', 'AWS']),
            jdText: SARVAM,
            record: owner,
            prefs: { ...defaultUserGenerationPreferences, preferredWorkModes: ['onsite'] },
            answers: {},
            judgements: new Map(),
        });
        expect(result.fit.matched.find((m) => m.requirementId === 'r1')?.strength).toBe('direct');
        expect(result.fit.gaps.map((g) => g.text)).toEqual(['Kubernetes', 'AWS']);
        expect(JSON.stringify(result.fit.gaps)).not.toContain('SIP');
    });

    test('with no named option in the record, the model is asked, told any one is enough', () => {
        const plan = planMatching(jd([{ ...telephony, anyOf: ['SIP', 'telephony'] }]), owner);
        expect(plan.toAsk.map((r) => r.id)).toEqual(['r2']);
    });

    test('the keyword fallback credits any one named option, as partial', () => {
        const judged = fallbackJudgements([telephony], owner);
        expect(judged.get('r2')).toMatchObject({ strength: 'partial', source: 'fallback' });
    });

    test('"Go" is matched as written, never inside "go-to-market"', () => {
        const record = { lines: [{ text: 'Owned the go-to-market launch', source: 'x' }, { text: 'Services in Go and Postgres', source: 'y' }], corpus: '' };
        expect(lineForOption(record, 'Go')).toBe(1);
        expect(lineForOption({ ...record, lines: record.lines.slice(0, 1) }, 'Go')).toBeNull();
        // A plain phrase is the model's to read, not a keyword.
        expect(lineForOption({ lines: [{ text: 'real-time audio pipelines', source: 'z' }], corpus: '' }, 'real-time audio')).toBeNull();
    });
});
