/**
 * Review packet — the hard gates.
 *
 * The one test in here that is a launch blocker is the 20-packet eval corpus:
 * zero numbers may appear in a packet that are not present in a source Win. The
 * corpus is adversarial on purpose — every scenario's model output *tries* to
 * fabricate, and the pass condition is that none of it survives.
 *
 * Runs against the real local Postgres. Only the model call is faked.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { WinCategory, WinSensitivity } from '@prisma/client';
import { __testing as aiTesting } from '@/lib/ai/structured';
import {
    applyUserEdits,
    assemblePacket,
    auditPacketNumbers,
    bulletFor,
    categoryThemes,
    composePacketProse,
    countWords,
    groupWinsIntoThemes,
    guardSourceText,
    loadPacketWins,
    renderMarkdown,
    renderPlainText,
    runTruthfulnessPass,
    scorePacketWin,
    selectPacketWins,
    stripBanned,
    writeHonestRead,
    writeWhatWouldCloseIt,
    type Composition,
    type ThemeGrouping,
} from '@/services/reviewPacket';
import { assessCompetencies, PATRONUS_DEFAULT_FRAMEWORK, priorMappings } from '@/services/competency';
import {
    cleanupPacketUser,
    EVAL_CORPUS,
    makeConfirmedWin,
    newPacketUserId,
    packetWin,
} from '@/services/packetFixtures.test-utils';

const users: string[] = [];

function user(label: string): string {
    const id = newPacketUserId(label);
    users.push(id);
    return id;
}

afterEach(async () => {
    aiTesting.reset();
    while (users.length > 0) {
        const id = users.pop();
        if (id) await cleanupPacketUser(id);
    }
});

// ═══════════════════════════════════════════════════════════ selection

describe('win selection', () => {
    const periodEnd = new Date('2026-07-31T00:00:00.000Z');

    test('a quantified, sourced, recent win outranks a bare old one', () => {
        const strong = packetWin({
            occurredAt: new Date('2026-07-01T00:00:00.000Z'),
            quantified: true,
            hasEvidence: true,
        });
        const weak = packetWin({
            occurredAt: new Date('2026-02-01T00:00:00.000Z'),
            quantified: false,
            hasEvidence: false,
        });
        expect(scorePacketWin(strong, periodEnd)).toBeGreaterThan(scorePacketWin(weak, periodEnd));
    });

    test('caps at 40 and reports how many it left out', () => {
        const wins = Array.from({ length: 213 }, (_, index) =>
            packetWin({
                id: `sel${index}`,
                occurredAt: new Date(2026, 0, 1 + (index % 180)),
                quantified: index % 3 === 0,
            }),
        );
        const { selected, omitted } = selectPacketWins(wins, periodEnd);
        expect(selected).toHaveLength(40);
        expect(omitted).toBe(173);
    });

    test('under the cap, nothing is dropped and order is newest first', () => {
        const wins = [
            packetWin({ id: 'old', occurredAt: new Date('2026-01-01T00:00:00.000Z') }),
            packetWin({ id: 'new', occurredAt: new Date('2026-06-01T00:00:00.000Z') }),
        ];
        const { selected, omitted } = selectPacketWins(wins, periodEnd);
        expect(omitted).toBe(0);
        expect(selected.map((entry) => entry.id)).toEqual(['new', 'old']);
    });
});

// ═══════════════════════════════════════════════════════ theme grouping

describe('theme grouping', () => {
    const wins = [
        packetWin({ id: 't1', category: WinCategory.improved, title: 'Cut p95 from 800ms to 180ms' }),
        packetWin({ id: 't2', category: WinCategory.fixed, title: 'Fixed the retry storm' }),
        packetWin({ id: 't3', category: WinCategory.grew, title: 'Mentored a new hire' }),
    ];

    test('a model outage falls back to category grouping with no error', async () => {
        aiTesting.setObjectRunner(async () => {
            throw new Error('model unavailable');
        });
        aiTesting.setUsageLogger(async () => {});

        const grouping = await groupWinsIntoThemes({ userId: user('fallback'), wins });

        expect(grouping.fellBack).toBe(true);
        expect(grouping.themes.length).toBeGreaterThan(0);
        // Every win is still accounted for.
        const claimed = grouping.themes.flatMap((theme) => theme.winIds);
        expect(new Set([...claimed, ...grouping.unthemed]).size).toBe(wins.length);
    });

    test('never returns more than five themes', () => {
        const spread = Object.values(WinCategory).map((category, index) =>
            packetWin({ id: `spread${index}`, category }),
        );
        const grouping = categoryThemes(spread);
        expect(grouping.themes.length).toBeLessThanOrEqual(5);
        // Eight areas is real, useful feedback — say it rather than invent coherence.
        expect(grouping.coherenceNote).toContain('spread across');
    });

    test('a theme referencing a win outside scope has that id dropped', async () => {
        aiTesting.setObjectRunner(async () => ({
            object: {
                themes: [
                    {
                        title: 'Made the checkout path reliable',
                        outcomeSentence: 'Removed the top sources of checkout failure.',
                        winIds: ['t1', 't2', 'not-in-scope'],
                        scope: null,
                        strength: 'headline',
                    },
                ],
                unthemed: [],
                coherenceNote: null,
            },
            inputTokens: 10,
            outputTokens: 10,
        }));
        aiTesting.setUsageLogger(async () => {});

        const grouping = await groupWinsIntoThemes({ userId: user('scope'), wins });

        expect(grouping.fellBack).toBe(false);
        expect(grouping.themes[0].winIds).toEqual(['t1', 't2']);
        expect(grouping.unthemed).toEqual(['t3']);
    });

    test('a win never appears in two themes', async () => {
        aiTesting.setObjectRunner(async () => ({
            object: {
                themes: [
                    { title: 'One', outcomeSentence: 'a', winIds: ['t1', 't2'], scope: null, strength: 'headline' },
                    { title: 'Two', outcomeSentence: 'b', winIds: ['t2', 't3'], scope: null, strength: 'supporting' },
                ],
                unthemed: [],
                coherenceNote: null,
            },
            inputTokens: 10,
            outputTokens: 10,
        }));
        aiTesting.setUsageLogger(async () => {});

        const grouping = await groupWinsIntoThemes({ userId: user('dupe'), wins });
        const all = grouping.themes.flatMap((theme) => theme.winIds);
        expect(new Set(all).size).toBe(all.length);
    });
});

// ═══════════════════════════════════════════════ THE ZERO-FABRICATION GATE

describe('no fabricated quantities (PRD 03 §11 hard gate)', () => {
    /** Run one corpus scenario through the real generation path. */
    async function runScenario(scenario: (typeof EVAL_CORPUS)[number], userId: string) {
        const { wins } = scenario;

        aiTesting.setUsageLogger(async () => {});
        aiTesting.setObjectRunner(async ({ schema }) => {
            // One runner serves both calls; the schema tells us which is asking.
            const themeShape = schema.safeParse({
                themes: [
                    {
                        title: scenario.themeTitle,
                        outcomeSentence: scenario.outcomeSentence,
                        winIds: wins.map((entry) => entry.id),
                        scope: scenario.scope,
                        strength: 'headline',
                    },
                ],
                unthemed: [],
                coherenceNote: null,
            });
            if (themeShape.success) {
                return { object: themeShape.data, inputTokens: 10, outputTokens: 10 };
            }
            return {
                object: {
                    summary: scenario.summary,
                    themeOutcomes: [
                        { index: 0, outcomeSentence: scenario.outcomeSentence, impact: scenario.scope },
                    ],
                    growth: scenario.growth,
                },
                inputTokens: 10,
                outputTokens: 10,
            };
        });

        const grouping = await groupWinsIntoThemes({ userId, wins });

        let composition: Composition | null = null;
        try {
            composition = await composePacketProse({
                userId,
                type: 'performance_review',
                audience: 'manager',
                wins,
                themes: grouping.themes,
                assessments: [],
                targetLevel: null,
            });
        } catch {
            composition = null;
        }

        const content = assemblePacket({
            type: 'performance_review',
            audience: 'manager',
            periodStart: new Date('2026-02-01T00:00:00.000Z'),
            periodEnd: new Date('2026-07-31T00:00:00.000Z'),
            employerName: 'Acme',
            framework: null,
            targetLevel: null,
            wins,
            grouping,
            composition,
            assessments: [],
            omittedWinCount: 0,
        });

        return runTruthfulnessPass({ packetId: `eval-${scenario.name}`, content, wins });
    }

    test('zero fabricated numbers across the 20-packet eval corpus', async () => {
        expect(EVAL_CORPUS).toHaveLength(20);
        const userId = user('eval');
        const failures: { scenario: string; violations: unknown[] }[] = [];

        for (const scenario of EVAL_CORPUS) {
            const content = await runScenario(scenario, userId);

            // The independent digit check — deliberately not the same code path
            // as the guard inside `generateStructured`.
            const violations = auditPacketNumbers(content, scenario.wins);
            if (violations.length > 0) failures.push({ scenario: scenario.name, violations });
        }

        expect(failures).toEqual([]);
    }, 60_000);

    test('every number that does survive is one the log contains', async () => {
        const scenario = EVAL_CORPUS.find((entry) => entry.name === 'clean, multiple metrics');
        expect(scenario).toBeDefined();
        const content = await runScenario(scenario!, user('eval-clean'));

        const source = guardSourceText(scenario!.wins);
        expect(source).toContain('1.2GB');
        // The bullets are the wins' own words, so the real figures are still there.
        const rendered = renderMarkdown(content, scenario!.wins, { includeConfidential: true });
        expect(rendered).toContain('1.2GB');
        expect(auditPacketNumbers(content, scenario!.wins)).toEqual([]);
    }, 20_000);

    test('a bullet is the win verbatim, so it can never carry a made-up figure', () => {
        const win = packetWin({
            title: 'Cut checkout p95 latency',
            metric: 'p95 800ms → 180ms',
            evidenceLabel: 'PR #482',
            quantified: true,
        });
        const bullet = bulletFor(win);
        expect(bullet.sourceWinIds).toEqual([win.id]);
        expect(bullet.text).toContain('p95 800ms → 180ms');
        expect(bullet.text).toContain('PR #482');
    });

    test('banned superlatives are stripped, not merely discouraged', () => {
        expect(stripBanned('An exceptional, world-class result')).toBe('An , result');
    });
});

// ═══════════════════════════════════════════════════ truthfulness pass

describe('truthfulness pass', () => {
    const wins = [packetWin({ id: 'v1', title: 'Cut p95 from 800ms to 180ms', metric: 'p95 800ms → 180ms', quantified: true })];

    function contentWith(text: string, sourceWinIds: string[]) {
        const grouping: ThemeGrouping = {
            themes: [
                {
                    title: 'Made checkout fast',
                    outcomeSentence: text,
                    winIds: sourceWinIds,
                    scope: null,
                    strength: 'headline',
                },
            ],
            unthemed: [],
            coherenceNote: null,
            fellBack: false,
            costUsd: 0,
        };
        return assemblePacket({
            type: 'performance_review',
            audience: 'manager',
            periodStart: new Date('2026-02-01T00:00:00.000Z'),
            periodEnd: new Date('2026-07-31T00:00:00.000Z'),
            employerName: null,
            framework: null,
            targetLevel: null,
            wins,
            grouping,
            composition: null,
            assessments: [],
            omittedWinCount: 0,
        });
    }

    test('a sentence with no source win fails closed to needs_confirmation', () => {
        const content = contentWith('Something happened.', []);
        const verified = runTruthfulnessPass({ packetId: 'p1', content, wins });
        expect(verified.themes[0].outcome.ground).toBe('needs_confirmation');
        expect(verified.warnings.length).toBeGreaterThan(0);
    });

    test('a sentence carrying an unsourced figure resolves to unsupported', () => {
        const content = contentWith('Latency improved by 91%.', ['v1']);
        const verified = runTruthfulnessPass({ packetId: 'p2', content, wins });
        expect(verified.themes[0].outcome.ground).toBe('unsupported');
        expect(verified.warnings[0].reason).toContain('91%');
    });

    test('a sentence quoting the log is grounded', () => {
        const content = contentWith('Cut p95 from 800ms to 180ms.', ['v1']);
        const verified = runTruthfulnessPass({ packetId: 'p3', content, wins });
        expect(verified.themes[0].outcome.ground).toBe('grounded');
        expect(verified.warnings).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════ export

describe('markdown export', () => {
    const wins = [
        packetWin({
            id: 'x1',
            title: 'Cut checkout p95',
            metric: 'p95 800ms → 180ms',
            quantified: true,
            occurredAt: new Date('2026-07-10T00:00:00.000Z'),
        }),
        packetWin({
            id: 'x2',
            title: 'Renegotiated the vendor contract',
            sensitivity: WinSensitivity.confidential,
            occurredAt: new Date('2026-06-10T00:00:00.000Z'),
        }),
    ];

    function build() {
        const grouping: ThemeGrouping = {
            themes: [
                {
                    title: 'Made checkout reliable at peak',
                    outcomeSentence: 'Removed the top source of checkout failures.',
                    winIds: ['x1', 'x2'],
                    scope: null,
                    strength: 'headline',
                },
            ],
            unthemed: [],
            coherenceNote: null,
            fellBack: false,
            costUsd: 0,
        };
        return assemblePacket({
            type: 'performance_review',
            audience: 'manager',
            periodStart: new Date('2026-02-01T00:00:00.000Z'),
            periodEnd: new Date('2026-07-31T00:00:00.000Z'),
            employerName: 'Acme',
            framework: null,
            targetLevel: null,
            wins,
            grouping,
            composition: {
                summary: 'I focused on checkout reliability.',
                themeOutcomes: new Map([
                    [0, { outcomeSentence: 'Removed the top source of checkout failures.', impact: null }],
                ]),
                growth: 'I want more cross-team scope.',
                degraded: false,
                costUsd: 0,
            },
            assessments: [],
            omittedWinCount: 0,
        });
    }

    test('uses only structure Google Docs and Lattice keep: headings, bullets, bold', () => {
        const markdown = renderMarkdown(build(), wins, { includeConfidential: true });
        expect(markdown).toMatch(/^# Performance review · Feb – Jul 2026 · Acme/m);
        expect(markdown).toContain('## Summary');
        expect(markdown).toContain('### Made checkout reliable at peak');
        expect(markdown).toMatch(/^- /m);
        // No tables and no raw HTML — both survive the paste badly.
        expect(markdown).not.toContain('|---');
        expect(markdown).not.toMatch(/<[a-z]+[ >]/);
    });

    test('confidential wins are marked when included and gone when excluded', () => {
        const included = renderMarkdown(build(), wins, { includeConfidential: true });
        expect(included).toContain('🔒');
        expect(included).toContain('Renegotiated the vendor contract');

        const excluded = renderMarkdown(build(), wins, { includeConfidential: false });
        expect(excluded).not.toContain('Renegotiated the vendor contract');
        // The rest of the packet survives the exclusion.
        expect(excluded).toContain('Cut checkout p95');
    });

    test('plain text is the same document without the syntax', () => {
        const text = renderPlainText(build(), wins, { includeConfidential: true });
        expect(text).not.toContain('##');
        expect(text).toContain('Summary');
        expect(text).toContain('• ');
    });
});

// ═══════════════════════════════════════════════════════════ user edits

describe('user edits', () => {
    test('survive regeneration by block key and keep their provenance', () => {
        const wins = [packetWin({ id: 'u1' })];
        const grouping: ThemeGrouping = {
            themes: [
                { title: 'A theme', outcomeSentence: 'Generated text.', winIds: ['u1'], scope: null, strength: 'headline' },
            ],
            unthemed: [],
            coherenceNote: null,
            fellBack: false,
            costUsd: 0,
        };
        const content = assemblePacket({
            type: 'performance_review',
            audience: 'manager',
            periodStart: new Date('2026-02-01T00:00:00.000Z'),
            periodEnd: new Date('2026-07-31T00:00:00.000Z'),
            employerName: null,
            framework: null,
            targetLevel: null,
            wins,
            grouping,
            composition: null,
            assessments: [],
            omittedWinCount: 0,
        });

        const edited = applyUserEdits(content, {
            'theme:0:outcome': 'My own words.',
            'theme:0:title': 'My own title',
        });

        expect(edited.themes[0].outcome.text).toBe('My own words.');
        expect(edited.themes[0].title).toBe('My own title');
        expect(edited.themes[0].outcome.sourceWinIds).toEqual(['u1']);
        expect(edited.wordCount).toBe(countWords(edited));
    });
});

// ═══════════════════════════════════════════════════════ the honest read

describe('the gap report tone', () => {
    const competencies = PATRONUS_DEFAULT_FRAMEWORK.competencies;

    test('reports absent for a competency with zero mapped wins — no hedging', () => {
        const wins = [
            packetWin({ id: 'g1', category: WinCategory.shipped }),
            packetWin({ id: 'g2', category: WinCategory.shipped }),
            packetWin({ id: 'g3', category: WinCategory.shipped }),
        ];
        const assessments = assessCompetencies({
            competencies,
            mappings: priorMappings(wins, competencies),
            wins: wins.map((win) => ({ id: win.id, title: win.title, occurredAt: win.occurredAt, quantified: false })),
        });

        const mentorship = assessments.find((item) => item.key === 'mentorship');
        expect(mentorship?.verdict).toBe('absent');
        expect(mentorship?.rationale).toBe('No evidence logged for mentorship in this period.');
        // No score out of 100 anywhere.
        expect(JSON.stringify(assessments)).not.toMatch(/\bscore\b/i);
    });

    test('names the strong case and the one that is not, and never flatters', () => {
        // Four quantified `led` wins make scope & ambiguity strong and leave
        // execution and mentorship with nothing at all.
        const wins = Array.from({ length: 4 }, (_, index) =>
            packetWin({ id: `h${index}`, category: WinCategory.led, quantified: true }),
        );
        const assessments = assessCompetencies({
            competencies,
            mappings: priorMappings(wins, competencies),
            wins: wins.map((win) => ({ id: win.id, title: win.title, occurredAt: win.occurredAt, quantified: true })),
        });
        expect(assessments.find((item) => item.key === 'scope_ambiguity')?.verdict).toBe('strong');

        const read = writeHonestRead({
            assessments,
            competencies,
            targetLevel: PATRONUS_DEFAULT_FRAMEWORK.levels[3],
            winsById: new Map(wins.map((win) => [win.id, win])),
        });

        expect(read[0]).toBe('Your scope & ambiguity case is strong. Your execution case is not.');
        expect(read.join(' ')).toContain('gap that decides this');
        // Never flattering, and never double-punctuated by the quoted expectation.
        expect(read.join(' ')).not.toMatch(/great|excellent|impressive|outstanding/i);
        expect(read.join(' ')).not.toContain('.".');
    });

    test('with nothing above the bar it says so plainly, rather than hedging', () => {
        const wins = [packetWin({ id: 'n1', category: WinCategory.shipped })];
        const assessments = assessCompetencies({
            competencies,
            mappings: priorMappings(wins, competencies),
            wins: wins.map((win) => ({ id: win.id, title: win.title, occurredAt: win.occurredAt, quantified: false })),
        });
        const read = writeHonestRead({
            assessments,
            competencies,
            targetLevel: PATRONUS_DEFAULT_FRAMEWORK.levels[3],
            winsById: new Map(wins.map((win) => [win.id, win])),
        });
        expect(read[0]).toContain('no case here yet');
    });

    test('what would close it is concrete, never "continue learning"', () => {
        const wins = [packetWin({ id: 'k1', category: WinCategory.shipped })];
        const assessments = assessCompetencies({
            competencies,
            mappings: priorMappings(wins, competencies),
            wins: wins.map((win) => ({ id: win.id, title: win.title, occurredAt: win.occurredAt, quantified: false })),
        });
        const actions = writeWhatWouldCloseIt(assessments);
        expect(actions.length).toBeGreaterThan(0);
        expect(actions.join(' ')).not.toMatch(/continue learning|keep growing/i);
    });
});

// ═════════════════════════════════════════════════ against the database

describe('loadPacketWins (real database)', () => {
    let userId: string;

    beforeEach(() => {
        userId = user('load');
    });

    test('reads confirmed wins in the period, including internal-only and confidential', async () => {
        await makeConfirmedWin(userId, {
            title: 'Cut checkout p95 from 800ms to 180ms',
            occurredAt: new Date('2026-05-01T00:00:00.000Z'),
            impact: { metric: 'p95 latency', baseline: '800ms', result: '180ms' },
        });
        await makeConfirmedWin(userId, {
            title: 'Renegotiated the vendor contract',
            occurredAt: new Date('2026-06-01T00:00:00.000Z'),
            sensitivity: WinSensitivity.confidential,
        });
        await makeConfirmedWin(userId, {
            title: 'Outside the period',
            occurredAt: new Date('2025-01-01T00:00:00.000Z'),
        });

        const wins = await loadPacketWins({
            userId,
            periodStart: new Date('2026-02-01T00:00:00.000Z'),
            periodEnd: new Date('2026-07-31T00:00:00.000Z'),
        });

        expect(wins).toHaveLength(2);
        expect(wins.map((win) => win.title).sort()).toEqual([
            'Cut checkout p95 from 800ms to 180ms',
            'Renegotiated the vendor contract',
        ]);
        // The metric round-trips into the shape a bullet can use verbatim.
        const quantified = wins.find((win) => win.quantified);
        expect(quantified?.metric).toBe('p95 latency 800ms → 180ms');
        // Confirming wrote evidence, so the bullets can carry a source chip.
        expect(wins.every((win) => win.hasEvidence)).toBe(true);
    });

    test('an unconfirmed draft is not packet material', async () => {
        const { createWinRecord } = await import('@/services/winGraph');
        await createWinRecord({
            userId,
            title: 'A draft nobody confirmed',
            occurredAt: new Date('2026-05-01T00:00:00.000Z'),
            category: WinCategory.shipped,
            source: 'manual',
            employerId: null,
        });

        const wins = await loadPacketWins({
            userId,
            periodStart: new Date('2026-02-01T00:00:00.000Z'),
            periodEnd: new Date('2026-07-31T00:00:00.000Z'),
        });
        expect(wins).toEqual([]);
    });
});
