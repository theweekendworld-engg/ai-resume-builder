/**
 * The backfill eval corpus — sixteen scripted interviews.
 *
 * Deliberately NOT a `*.test.ts` file so the runner does not collect it.
 *
 * Each entry scripts BOTH sides of every model call in a whole conversation:
 * what the extraction model claims it found in an answer, and what the
 * conversational model proposes as the next question. That is what makes this
 * an eval rather than a mock — the transcripts are written to be adversarial,
 * so the assertions in `backfill.eval.test.ts` measure whether the system holds
 * the line when the model does not.
 *
 * Five failure modes are represented on purpose, because these are the five
 * that actually happen:
 *
 *   1. the model leads a number       ("would you say around 30%?")
 *   2. the model fabricates a metric  (a figure absent from the answer)
 *   3. the model derives a metric     (a percentage computed from two real ones)
 *   4. the model flatters             ("that's impressive!")
 *   5. the model asks two questions   (and loses the answer to the first)
 *
 * Roughly half the scripted models correct themselves when told; the other half
 * never do, which is what exercises the scripted-fallback floor.
 */

import { WinCategory, WinSensitivity } from '@prisma/client';
import type { BackfillExtraction } from '@/agents/backfillAgent';

type ExtractionWin = BackfillExtraction['wins'][number];
type ImpactShape = NonNullable<ExtractionWin['impact']>;

export type ScriptedQuestion = {
    acknowledgement: string;
    question: string;
    /**
     * What the model returns when its first attempt is rejected. Omit to model
     * a model that keeps making the same mistake — the scripted fallback is
     * what the user sees then, and that path needs coverage too.
     */
    retry?: { acknowledgement: string; question: string };
};

export type ScriptedAnswer = {
    answer: string;
    extraction: BackfillExtraction;
    /** What the model returns on the numeric guard's corrective retry. */
    extractionRetry?: BackfillExtraction;
};

export type EvalTranscript = {
    id: string;
    /** What is being reconstructed, and the employer row behind it. */
    company: string;
    role: string;
    startDate: string;
    endDate: string;
    /** Questions the model proposes, in order: opening first. */
    questions: ScriptedQuestion[];
    answers: ScriptedAnswer[];
    /** Free-text note on what this transcript is here to prove. */
    proves: string;
};

// ───────────────────────────────────────────────────────────────── builders

export function impact(input: Partial<ImpactShape> & { metric: string }): ImpactShape {
    return {
        metric: input.metric,
        baseline: input.baseline ?? null,
        result: input.result ?? null,
        delta: input.delta ?? null,
        scope: input.scope ?? null,
        timeframe: input.timeframe ?? null,
    };
}

export function win(input: {
    title: string;
    excerpt: string;
    narrative?: string;
    category?: WinCategory;
    skills?: string[];
    collaborators?: string[];
    sensitivity?: WinSensitivity;
    impact?: ImpactShape | null;
}): ExtractionWin {
    return {
        title: input.title,
        narrative: input.narrative ?? '',
        category: input.category ?? WinCategory.shipped,
        skills: input.skills ?? [],
        collaborators: input.collaborators ?? [],
        suggestedSensitivity: input.sensitivity ?? WinSensitivity.shareable,
        quantified: Boolean(input.impact),
        impact: input.impact ?? null,
        excerpt: input.excerpt,
    };
}

export function extraction(input: {
    wins?: ExtractionWin[];
    metricForPreviousWin?: ImpactShape | null;
    saidDontRemember?: boolean;
    vague?: boolean;
    coveredTopics?: BackfillExtraction['coveredTopics'];
} = {}): BackfillExtraction {
    return {
        wins: input.wins ?? [],
        metricForPreviousWin: input.metricForPreviousWin ?? null,
        saidDontRemember: input.saidDontRemember ?? false,
        vague: input.vague ?? false,
        coveredTopics: input.coveredTopics ?? [],
    };
}

/** A well-behaved question, used to pad a transcript past its interesting part. */
export function clean(question: string, acknowledgement = 'Noted.'): ScriptedQuestion {
    return { acknowledgement, question };
}

const FILLER: ScriptedQuestion[] = [
    clean('What else stands out from that period?'),
    clean('Who else was affected by that work?'),
    clean('Was any of that written down anywhere?'),
    clean('What took the most of your time there?'),
    clean('Did anything you built there outlive you?'),
    clean('What would your manager have said you owned?'),
    clean('Is there anything you would want on a resume from that year?'),
    clean('What changed for the team because of you?'),
    clean('Anything else worth recording?'),
    clean('What else should be on the record?'),
];

function pad(questions: ScriptedQuestion[]): ScriptedQuestion[] {
    return [...questions, ...FILLER];
}

// ═══════════════════════════════════════════════════════════════ the corpus

export const EVAL_TRANSCRIPTS: EvalTranscript[] = [
    // ── 1. the happy path, so the corpus has a baseline ─────────────────────
    {
        id: 'clean-two-year-employer',
        company: 'Acme',
        role: 'Senior Engineer',
        startDate: '2023-01',
        endDate: '2025-01',
        proves: 'a well-behaved model produces a clean 8-12 question session',
        questions: pad([
            clean('What are you most known for from your time at Acme?'),
            clean('Any sense of how much that moved?', 'You mentioned the checkout rewrite.'),
            clean('Was that just your own team, or wider?', 'Noted on the latency.'),
            clean("Whose work changed because of something you did there?", 'Understood.'),
        ]),
        answers: [
            {
                answer: 'I rewrote the checkout pricing lookup and led the payments migration.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Rewrote the checkout pricing lookup',
                            excerpt: 'I rewrote the checkout pricing lookup',
                            category: WinCategory.improved,
                        }),
                        win({
                            title: 'Led the payments migration',
                            excerpt: 'led the payments migration',
                            category: WinCategory.led,
                        }),
                    ],
                }),
            },
            {
                answer: 'Checkout p95 went from 800ms to 180ms.',
                extraction: extraction({
                    metricForPreviousWin: impact({
                        metric: 'checkout p95 latency',
                        baseline: '800ms',
                        result: '180ms',
                    }),
                }),
            },
            {
                answer: 'It unblocked the payments team and the mobile team.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Unblocked the payments and mobile teams',
                            excerpt: 'It unblocked the payments team and the mobile team',
                            category: WinCategory.influenced,
                        }),
                    ],
                    coveredTopics: ['scope'],
                }),
            },
            {
                answer: 'I mentored two engineers through the migration.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Mentored engineers through the payments migration',
                            excerpt: 'I mentored two engineers through the migration',
                            category: WinCategory.grew,
                        }),
                    ],
                }),
            },
        ],
    },

    // ── 2. the model leads a number, then corrects itself ───────────────────
    {
        id: 'leading-number-corrected',
        company: 'Northwind',
        role: 'Staff Engineer',
        startDate: '2022-03',
        endDate: '2024-06',
        proves: 'a led number is rejected and the corrected question is what ships',
        questions: pad([
            clean('What stands out from Northwind?'),
            {
                acknowledgement: 'You mentioned the support load.',
                question: 'Would you say around 30% fewer tickets?',
                retry: { acknowledgement: 'You mentioned the support load.', question: 'Any sense of the size of that drop?' },
            },
            {
                acknowledgement: 'Understood.',
                question: 'Was that roughly 40% of the queue?',
                retry: { acknowledgement: 'Understood.', question: 'Was that just your own team, or wider?' },
            },
        ]),
        answers: [
            {
                answer: 'I built the self-serve refund flow, which took a lot of load off support.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Built the self-serve refund flow',
                            excerpt: 'I built the self-serve refund flow',
                            category: WinCategory.shipped,
                        }),
                    ],
                }),
            },
            {
                answer: 'I never saw the number, honestly.',
                extraction: extraction({ vague: true }),
            },
            {
                answer: 'It covered the whole support org, not just my team.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Refund flow adopted across the support org',
                            excerpt: 'It covered the whole support org',
                            category: WinCategory.influenced,
                        }),
                    ],
                    coveredTopics: ['scope'],
                }),
            },
        ],
    },

    // ── 3. the model leads a number and never stops ─────────────────────────
    {
        id: 'leading-number-incorrigible',
        company: 'Globex',
        role: 'Engineering Manager',
        startDate: '2021-06',
        endDate: '2023-09',
        proves: 'when the model will not correct itself the scripted fallback ships instead',
        questions: pad([
            { acknowledgement: '', question: 'Would you say around five big projects at Globex?' },
            { acknowledgement: 'Noted.', question: 'Was it roughly 25% faster?' },
            { acknowledgement: 'Noted.', question: 'Something like 200 people?' },
            { acknowledgement: 'Noted.', question: 'Any ballpark on the savings?' },
        ]),
        answers: [
            {
                answer: 'I ran the platform team and we shipped the new deploy pipeline.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Shipped the new deploy pipeline',
                            excerpt: 'we shipped the new deploy pipeline',
                            category: WinCategory.shipped,
                        }),
                    ],
                }),
            },
            {
                answer: 'Deploys went from twenty minutes to four.',
                extraction: extraction({
                    metricForPreviousWin: impact({
                        metric: 'deploy time',
                        baseline: 'twenty minutes',
                        result: 'four',
                    }),
                }),
            },
            {
                answer: 'The whole engineering org used it.',
                extraction: extraction({ coveredTopics: ['scope'] }),
            },
        ],
    },

    // ── 4. the model fabricates a figure outright ───────────────────────────
    {
        id: 'fabricated-metric',
        company: 'Initech',
        role: 'Backend Engineer',
        startDate: '2022-01',
        endDate: '2024-01',
        proves: 'a metric the user never stated never reaches an ImpactMetric row',
        questions: pad([
            clean('What are you most known for from your time at Initech?'),
            clean('Any sense of the size of that?', 'Noted on the cache work.'),
        ]),
        answers: [
            {
                answer: 'I added a caching layer in front of the reporting API and it got much faster.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Added a caching layer to the reporting API',
                            excerpt: 'I added a caching layer in front of the reporting API',
                            category: WinCategory.improved,
                            // Nothing in the answer says any of this.
                            impact: impact({
                                metric: 'reporting API latency',
                                baseline: '2.4s',
                                result: '300ms',
                                delta: '-87%',
                            }),
                        }),
                    ],
                }),
                extractionRetry: extraction({
                    wins: [
                        win({
                            title: 'Added a caching layer to the reporting API',
                            excerpt: 'I added a caching layer in front of the reporting API',
                            category: WinCategory.improved,
                            impact: impact({ metric: 'reporting API latency', delta: '-87%' }),
                        }),
                    ],
                }),
            },
            {
                answer: 'I genuinely do not know, we never instrumented it.',
                extraction: extraction({ vague: true }),
            },
        ],
    },

    // ── 5. the model derives a percentage from two real figures ─────────────
    {
        id: 'derived-percentage',
        company: 'Umbrella',
        role: 'Platform Engineer',
        startDate: '2023-04',
        endDate: '2025-04',
        proves: 'a percentage computed from two stated numbers is still fabricated',
        questions: pad([
            clean('What are you most known for from your time at Umbrella?'),
            clean('Was that just your own team, or wider?', 'Noted on the build times.'),
        ]),
        answers: [
            {
                answer: 'I got CI build times down from 40 minutes to 12 minutes.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Cut CI build time',
                            excerpt: 'CI build times down from 40 minutes to 12 minutes',
                            category: WinCategory.improved,
                            // 40 and 12 are real; -70% is arithmetic the user never did.
                            impact: impact({
                                metric: 'CI build time',
                                baseline: '40 minutes',
                                result: '12 minutes',
                                delta: '-70%',
                            }),
                        }),
                    ],
                }),
                extractionRetry: extraction({
                    wins: [
                        win({
                            title: 'Cut CI build time',
                            excerpt: 'CI build times down from 40 minutes to 12 minutes',
                            category: WinCategory.improved,
                            impact: impact({
                                metric: 'CI build time',
                                baseline: '40 minutes',
                                result: '12 minutes',
                            }),
                        }),
                    ],
                }),
            },
            {
                answer: 'Every backend team felt it.',
                extraction: extraction({ coveredTopics: ['scope'] }),
            },
        ],
    },

    // ── 6. flattery ─────────────────────────────────────────────────────────
    {
        id: 'flattery',
        company: 'Hooli',
        role: 'Tech Lead',
        startDate: '2020-01',
        endDate: '2023-01',
        proves: 'no compliment survives to the user, corrected or not',
        questions: pad([
            clean('What are you most known for from your time at Hooli?'),
            {
                acknowledgement: "That's impressive!",
                question: 'What happened next?',
                retry: { acknowledgement: 'You rewrote the scheduler.', question: 'What happened next?' },
            },
            { acknowledgement: 'Amazing work.', question: 'Who else saw the benefit?' },
            { acknowledgement: 'Wow.', question: 'Was anything written down about it?' },
        ]),
        answers: [
            {
                answer: 'I rewrote the job scheduler from scratch.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Rewrote the job scheduler',
                            excerpt: 'I rewrote the job scheduler from scratch',
                            category: WinCategory.shipped,
                        }),
                    ],
                }),
            },
            {
                answer: 'It let us run nightly reports that used to fail.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Made nightly reports reliable',
                            excerpt: 'nightly reports that used to fail',
                            category: WinCategory.fixed,
                        }),
                    ],
                }),
            },
            {
                answer: 'Finance stopped chasing us every morning.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Removed a recurring escalation from finance',
                            excerpt: 'Finance stopped chasing us every morning',
                            category: WinCategory.influenced,
                        }),
                    ],
                    coveredTopics: ['scope'],
                }),
            },
        ],
    },

    // ── 7. two questions in one ─────────────────────────────────────────────
    {
        id: 'multi-part',
        company: 'Stark Industries',
        role: 'Senior Engineer',
        startDate: '2021-02',
        endDate: '2023-11',
        proves: 'a two-part question is rejected so the first half is not silently lost',
        questions: pad([
            clean('What are you most known for from your time at Stark Industries?'),
            {
                acknowledgement: 'You mentioned the migration.',
                question: 'How many people were waiting on it and who owned the rollout?',
                retry: {
                    acknowledgement: 'You mentioned the migration.',
                    question: 'Who was waiting on that migration?',
                },
            },
            {
                acknowledgement: 'Noted.',
                question: 'Was it your team? Or the whole org?',
            },
        ]),
        answers: [
            {
                answer: 'I ran the database migration off the legacy cluster.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Ran the migration off the legacy database cluster',
                            excerpt: 'I ran the database migration off the legacy cluster',
                            category: WinCategory.led,
                        }),
                    ],
                }),
            },
            {
                answer: 'The reporting team and the billing team were both blocked on it.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Unblocked the reporting and billing teams',
                            excerpt: 'The reporting team and the billing team were both blocked on it',
                            category: WinCategory.influenced,
                        }),
                    ],
                    coveredTopics: ['scope'],
                }),
            },
        ],
    },

    // ── 8. "I don't remember" ───────────────────────────────────────────────
    {
        id: 'dont-remember',
        company: 'Wayne Enterprises',
        role: 'Engineer',
        startDate: '2019-05',
        endDate: '2022-08',
        proves: 'not remembering advances without a re-ask',
        questions: pad([
            clean('What are you most known for from your time at Wayne Enterprises?'),
            clean('Any sense of the size of that?', 'Noted on the alerting work.'),
            clean('Was that just your own team, or wider?', 'Understood.'),
        ]),
        answers: [
            {
                answer: 'I replaced the alerting system and cut the on-call noise a lot.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Replaced the alerting system',
                            excerpt: 'I replaced the alerting system',
                            category: WinCategory.improved,
                        }),
                    ],
                }),
            },
            { answer: "I don't remember", extraction: extraction({ saidDontRemember: true, vague: true }) },
            { answer: "I don't remember", extraction: extraction({ saidDontRemember: true, vague: true }) },
        ],
    },

    // ── 9. a paragraph dump that answers three questions at once ────────────
    {
        id: 'paragraph-dump',
        company: 'Cyberdyne',
        role: 'Principal Engineer',
        startDate: '2020-09',
        endDate: '2024-03',
        proves: 'a dump is split into several drafts and the covered topics are skipped',
        questions: pad([
            clean('What are you most known for from your time at Cyberdyne?'),
            clean("Whose work changed because of something you did there?", 'Noted.'),
        ]),
        answers: [
            {
                answer:
                    'Three things really. I designed the event bus that every service now publishes to, ' +
                    'I cut our AWS bill from $90k a month to $61k a month by rightsizing the fleet, and ' +
                    'I ran the design review process for the whole platform group, which was about ' +
                    'fifteen engineers.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Designed the shared event bus',
                            excerpt: 'I designed the event bus that every service now publishes to',
                            category: WinCategory.shipped,
                        }),
                        win({
                            title: 'Cut the monthly AWS bill by rightsizing the fleet',
                            excerpt: 'I cut our AWS bill from $90k a month to $61k a month',
                            category: WinCategory.saved,
                            impact: impact({
                                metric: 'monthly AWS bill',
                                baseline: '$90k',
                                result: '$61k',
                            }),
                        }),
                        win({
                            title: 'Ran the design review process for the platform group',
                            excerpt: 'I ran the design review process for the whole platform group',
                            category: WinCategory.led,
                        }),
                    ],
                    coveredTopics: ['quantify', 'scope'],
                }),
            },
            {
                answer: 'Every service team had to adopt the bus, so all of them.',
                extraction: extraction({ coveredTopics: ['scope'] }),
            },
        ],
    },

    // ── 10. confidential disclosure ─────────────────────────────────────────
    {
        id: 'confidential',
        company: 'Soylent',
        role: 'Security Engineer',
        startDate: '2022-06',
        endDate: '2025-02',
        proves: 'confidential work is flagged and the protection is named inline',
        questions: pad([
            clean('What are you most known for from your time at Soylent?'),
            clean('Was that just your own team, or wider?', 'Understood.'),
        ]),
        answers: [
            {
                answer:
                    'I led the response to a security incident that we never disclosed publicly, ' +
                    'and rebuilt the credential rotation afterwards.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Led the response to a security incident',
                            excerpt: 'I led the response to a security incident',
                            category: WinCategory.led,
                            sensitivity: WinSensitivity.confidential,
                        }),
                        win({
                            title: 'Rebuilt credential rotation',
                            excerpt: 'rebuilt the credential rotation afterwards',
                            category: WinCategory.improved,
                        }),
                    ],
                }),
            },
            {
                answer: 'It touched every production service we run.',
                extraction: extraction({ coveredTopics: ['scope'] }),
            },
        ],
    },

    // ── 11. internal-only disclosure ────────────────────────────────────────
    {
        id: 'internal-only',
        company: 'Vandelay',
        role: 'Data Engineer',
        startDate: '2021-01',
        endDate: '2023-12',
        proves: 'internal financials are marked internal-only, and the user is told why',
        questions: pad([
            clean('What are you most known for from your time at Vandelay?'),
            clean("Whose work changed because of something you did there?", 'Noted.'),
        ]),
        answers: [
            {
                answer: 'I built the churn model the revenue team still uses for forecasting.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Built the churn model used for revenue forecasting',
                            excerpt: 'I built the churn model the revenue team still uses',
                            category: WinCategory.shipped,
                            sensitivity: WinSensitivity.internal_only,
                        }),
                    ],
                }),
            },
            {
                answer: 'Finance and the exec team both plan against it now.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Churn model adopted by finance and the exec team',
                            excerpt: 'Finance and the exec team both plan against it now',
                            category: WinCategory.influenced,
                            sensitivity: WinSensitivity.internal_only,
                        }),
                    ],
                    coveredTopics: ['scope'],
                }),
            },
        ],
    },

    // ── 12. a dry thread ────────────────────────────────────────────────────
    {
        id: 'dry-thread',
        company: 'Gringotts',
        role: 'Engineer',
        startDate: '2020-01',
        endDate: '2021-12',
        proves: 'two vague answers change the subject instead of pressing',
        questions: pad([
            clean('What are you most known for from your time at Gringotts?'),
            clean('Any sense of the size of that?', 'Noted.'),
            clean("Whose work changed because of something you did there?", 'Understood.'),
        ]),
        answers: [
            {
                answer: 'I mostly kept the ledger service running.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Kept the ledger service running',
                            excerpt: 'I mostly kept the ledger service running',
                            category: WinCategory.fixed,
                        }),
                    ],
                }),
            },
            { answer: 'not really', extraction: extraction({ vague: true }) },
            { answer: 'no', extraction: extraction({ vague: true }) },
            {
                answer: 'I did train the two new hires on the ledger internals.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Trained new hires on the ledger internals',
                            excerpt: 'I did train the two new hires on the ledger internals',
                            category: WinCategory.grew,
                        }),
                    ],
                }),
            },
        ],
    },

    // ── 13. no prior context at all ─────────────────────────────────────────
    {
        id: 'zero-prior-context',
        company: 'Tyrell',
        role: 'Engineer',
        startDate: '2018-01',
        endDate: '2020-01',
        proves: 'a subject with nothing on record opens on the anchor and invents no memory',
        questions: pad([
            clean('What are you most known for from your time at Tyrell?', ''),
            clean('Any sense of the size of that?', 'Noted on the retention job.'),
        ]),
        answers: [
            {
                answer: 'I wrote the data retention job that deletes expired records nightly.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Wrote the nightly data retention job',
                            excerpt: 'I wrote the data retention job that deletes expired records nightly',
                            category: WinCategory.shipped,
                        }),
                    ],
                }),
            },
            {
                answer: 'It cleared about 4TB on the first run.',
                extraction: extraction({
                    metricForPreviousWin: impact({ metric: 'data cleared', result: '4TB' }),
                }),
            },
        ],
    },

    // ── 14. a long, chatty session that must still wind down ────────────────
    {
        id: 'long-session-winds-down',
        company: 'Aperture',
        role: 'Engineering Lead',
        startDate: '2019-01',
        endDate: '2024-01',
        proves: 'the interview winds down before the hard cap even when the user keeps talking',
        questions: pad([clean('What are you most known for from your time at Aperture?')]),
        answers: Array.from({ length: 24 }, (_, index) => ({
            answer: `We shipped internal tool number ${index + 1} and the team relied on it heavily.`,
            extraction: extraction({
                wins: [
                    win({
                        title: `Shipped internal tool ${index + 1}`,
                        excerpt: `We shipped internal tool number ${index + 1}`,
                        category: WinCategory.shipped,
                    }),
                ],
            }),
        })),
    },

    // ── 15. the model asks about a figure the user DID give ─────────────────
    {
        id: 'echoing-the-users-own-number',
        company: 'Weyland',
        role: 'Senior Engineer',
        startDate: '2022-02',
        endDate: '2024-11',
        proves: 'repeating a number the user stated is allowed; introducing one is not',
        questions: pad([
            clean('What are you most known for from your time at Weyland?'),
            clean(
                'You said 800ms to 180ms — was that every region?',
                'Noted on the latency work.',
            ),
            {
                acknowledgement: 'Understood.',
                question: 'Did it also cover the 30 edge nodes?',
                retry: { acknowledgement: 'Understood.', question: 'Did it cover the edge nodes too?' },
            },
        ]),
        answers: [
            {
                answer: 'I brought checkout p95 down from 800ms to 180ms.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Brought checkout p95 down',
                            excerpt: 'checkout p95 down from 800ms to 180ms',
                            category: WinCategory.improved,
                            impact: impact({
                                metric: 'checkout p95',
                                baseline: '800ms',
                                result: '180ms',
                            }),
                        }),
                    ],
                    coveredTopics: ['quantify'],
                }),
            },
            {
                answer: 'Only the two US regions at first.',
                extraction: extraction({ coveredTopics: ['scope'] }),
            },
            {
                answer: 'Yes, eventually all of them.',
                extraction: extraction({}),
            },
        ],
    },

    // ── 16. a figure arrives after the win, then gets corrected ─────────────
    {
        id: 'metric-supersedes',
        company: 'Oscorp',
        role: 'Engineer',
        startDate: '2021-07',
        endDate: '2023-07',
        proves: 'a figure attaches to the right win, and a correction updates it in place',
        questions: pad([
            clean('What are you most known for from your time at Oscorp?'),
            clean('Any sense of the size of that?', 'Noted on the queue work.'),
            clean('Was that just your own team, or wider?', 'Understood.'),
        ]),
        answers: [
            {
                // No figure yet — this is what makes the next question a quantify.
                answer: 'I rebuilt the job queue and the backlog got much shorter.',
                extraction: extraction({
                    wins: [
                        win({
                            title: 'Rebuilt the job queue',
                            excerpt: 'I rebuilt the job queue and the backlog got much shorter',
                            category: WinCategory.improved,
                        }),
                    ],
                }),
            },
            {
                // Answers the quantify question, and refers to no win by id.
                answer: 'It went from 11 days down to 7 days.',
                extraction: extraction({
                    metricForPreviousWin: impact({
                        metric: 'backlog',
                        baseline: '11 days',
                        result: '7 days',
                    }),
                }),
            },
            {
                // Corrects the figure while answering the scope question.
                answer: 'It was the whole operations team — and by the end it was 11 days down to 5 days.',
                extraction: extraction({
                    metricForPreviousWin: impact({
                        metric: 'backlog',
                        baseline: '11 days',
                        result: '5 days',
                    }),
                    coveredTopics: ['scope'],
                }),
            },
        ],
    },
];
