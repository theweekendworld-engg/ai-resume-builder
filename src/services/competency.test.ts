/**
 * Competency frameworks, rubric parsing and the mapping (PRD 03 §4).
 *
 * Two acceptance criteria live in here:
 *   - rubric parse hits >=85% field accuracy on a 15-rubric test set;
 *   - the gap report reports `absent` honestly, with no hedging.
 *
 * Runs against the real local Postgres. Only the model call is faked — and the
 * fake is deliberately sloppy, because the normalization layer is the thing
 * under test.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { FrameworkSource, WinCategory } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { __testing as aiTesting } from '@/lib/ai/structured';
import {
    assessCompetencies,
    CATEGORY_PRIORS,
    createFramework,
    DEFAULT_COMPETENCY_KEYS,
    deleteFramework,
    dedupeMappings,
    getFramework,
    listFrameworks,
    mapWinsToCompetencies,
    parseFrameworkText,
    PATRONUS_DEFAULT_FRAMEWORK,
    priorMappings,
    PUBLIC_FRAMEWORK_TEMPLATES,
    resolvePriorKey,
    resolveTargetLevel,
    seedFrameworkTemplates,
    slug,
    verdictFor,
    type FrameworkCompetency,
} from '@/services/competency';
import { cleanupPacketUser, newPacketUserId } from '@/services/packetFixtures.test-utils';

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

// ═══════════════════════════════════════════════════════════ the templates

describe('public framework templates', () => {
    test('seeding is idempotent and writes system-owned rows', async () => {
        const first = await seedFrameworkTemplates();
        const second = await seedFrameworkTemplates();
        expect(first).toBe(PUBLIC_FRAMEWORK_TEMPLATES.length);
        expect(second).toBe(PUBLIC_FRAMEWORK_TEMPLATES.length);

        const rows = await prisma.competencyFramework.findMany({
            where: { userId: null, sourceType: FrameworkSource.template },
            select: { name: true, isConfidential: true },
        });
        expect(rows.length).toBe(PUBLIC_FRAMEWORK_TEMPLATES.length);
        // A published ladder is public; only uploaded rubrics are confidential.
        expect(rows.every((row) => row.isConfidential === false)).toBe(true);
    });

    test('there are six, and each has levels and competencies', () => {
        expect(PUBLIC_FRAMEWORK_TEMPLATES).toHaveLength(6);
        for (const template of PUBLIC_FRAMEWORK_TEMPLATES) {
            expect(template.levels.length).toBeGreaterThanOrEqual(4);
            expect(template.competencies.length).toBeGreaterThanOrEqual(5);
            expect(template.attribution.length).toBeGreaterThan(0);
        }
    });

    test('a template is visible to every user; another user\'s rubric is not', async () => {
        await seedFrameworkTemplates();
        const mine = user('vis-a');
        const theirs = user('vis-b');

        const secret = await createFramework({
            userId: theirs,
            shape: { ...PATRONUS_DEFAULT_FRAMEWORK, name: 'Their internal ladder' },
        });

        const visible = await listFrameworks({ userId: mine });
        expect(visible.some((item) => item.name === 'Google SWE ladder')).toBe(true);
        expect(visible.some((item) => item.id === secret.id)).toBe(false);
        expect(await getFramework({ userId: mine, frameworkId: secret.id })).toBeNull();
    });

    test('an uploaded rubric is confidential by default and deletable', async () => {
        const userId = user('conf');
        const framework = await createFramework({
            userId,
            shape: { ...PATRONUS_DEFAULT_FRAMEWORK, name: 'Acme ladder' },
        });
        expect(framework.isConfidential).toBe(true);
        expect(await deleteFramework({ userId, frameworkId: framework.id })).toBe(true);
        expect(await getFramework({ userId, frameworkId: framework.id })).toBeNull();
    });
});

// ═════════════════════════════════════════════ rubric parse accuracy set

type RubricFixture = {
    name: string;
    document: string;
    levels: string[];
    competencies: string[];
};

function rubric(name: string, levels: string[], competencies: string[]): RubricFixture {
    return {
        name,
        levels,
        competencies,
        document: [
            `${name} engineering leveling framework`,
            '',
            `LEVELS: ${levels.join(', ')}`,
            `COMPETENCIES: ${competencies.join(', ')}`,
            '',
            ...competencies.map(
                (competency) => `${competency}: what good looks like at each level, described in prose.`,
            ),
        ].join('\n'),
    };
}

/** Fifteen rubrics, deliberately varied in level count and vocabulary. */
const RUBRIC_SET: RubricFixture[] = [
    rubric('Acme', ['L1', 'L2', 'L3', 'L4', 'L5'], ['Execution', 'Technical depth', 'Influence', 'Mentorship']),
    rubric('Globex', ['Associate', 'Engineer', 'Senior', 'Staff'], ['Delivery', 'Craft', 'Leadership', 'Communication', 'Scope']),
    rubric('Initech', ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'], ['Impact', 'Direction', 'People', 'Engineering excellence']),
    rubric('Umbrella', ['IC1', 'IC2', 'IC3', 'IC4'], ['Results', 'Talent', 'Culture', 'Craft', 'Direction']),
    rubric('Hooli', ['T1', 'T2', 'T3', 'T4', 'T5'], ['Technical ability', 'Impact', 'Leadership', 'Scope', 'Communication']),
    rubric('Stark', ['Junior', 'Mid', 'Senior', 'Principal'], ['Ownership', 'Depth', 'Collaboration', 'Mentoring']),
    rubric('Wayne', ['P1', 'P2', 'P3', 'P4', 'P5'], ['Execution', 'Ambiguity', 'Influence', 'Quality']),
    rubric('Cyberdyne', ['SWE I', 'SWE II', 'Senior SWE', 'Staff SWE'], ['Systems thinking', 'Delivery', 'Mentorship', 'Communication']),
    rubric('Tyrell', ['A', 'B', 'C', 'D', 'E'], ['Technical judgement', 'Autonomy', 'Impact', 'Team building']),
    rubric('Soylent', ['Level 1', 'Level 2', 'Level 3', 'Level 4'], ['Execution', 'Scope', 'Craft', 'Influence', 'Growth']),
    rubric('Massive Dynamic', ['MD1', 'MD2', 'MD3'], ['Research depth', 'Delivery', 'Collaboration']),
    rubric('Aperture', ['Tester', 'Engineer', 'Senior', 'Lead', 'Principal'], ['Safety', 'Rigour', 'Throughput', 'Mentorship']),
    rubric('Weyland', ['W1', 'W2', 'W3', 'W4'], ['Operational excellence', 'Design', 'Influence', 'Communication']),
    rubric('Vandelay', ['I', 'II', 'III', 'IV'], ['Delivery', 'Architecture', 'Coaching', 'Judgement']),
    rubric('Nakatomi', ['N1', 'N2', 'N3', 'N4', 'N5'], ['Execution', 'Depth', 'Scope', 'Influence', 'Mentorship']),
];

/**
 * A competent-but-sloppy extractor standing in for the model: it reads the
 * document correctly and then does the things real model output actually does —
 * reverses the level array, repeats a competency, writes keys in mixed case with
 * spaces, and occasionally drops the last competency entirely.
 *
 * That last one is a genuine miss and counts against the accuracy number. It is
 * there so the test can fail.
 */
function sloppyExtraction(document: string, index: number) {
    const levels = (/LEVELS: (.*)/.exec(document)?.[1] ?? '').split(',').map((part) => part.trim());
    let competencies = (/COMPETENCIES: (.*)/.exec(document)?.[1] ?? '')
        .split(',')
        .map((part) => part.trim());

    if (index % 6 === 0) competencies = competencies.slice(0, -1);

    const levelObjects = levels.map((name, order) => ({
        key: index % 7 === 0 ? `  ${name.toUpperCase()} ` : name.toLowerCase().replace(/\s+/g, '_'),
        name,
        order,
        summary: '',
    }));

    const competencyObjects = competencies.map((name) => ({
        key: index % 7 === 0 ? name.toUpperCase() : name.toLowerCase().replace(/\s+/g, '_'),
        name,
        description: '',
        levelExpectations: {},
    }));

    if (index % 4 === 0 && competencyObjects.length > 0) {
        competencyObjects.push({ ...competencyObjects[0] });
    }

    return {
        name: `${document.split('\n')[0].replace(/ engineering leveling framework$/, '')} ladder`,
        companyName: null,
        levels: index % 5 === 0 ? [...levelObjects].reverse() : levelObjects,
        competencies: competencyObjects,
    };
}

function normalizeName(value: string): string {
    return value.trim().toLowerCase();
}

describe('rubric parsing', () => {
    test('>=85% field accuracy across a 15-rubric test set', async () => {
        expect(RUBRIC_SET).toHaveLength(15);
        aiTesting.setUsageLogger(async () => {});

        const userId = user('rubric');
        let total = 0;
        let correct = 0;
        const misses: string[] = [];

        for (let index = 0; index < RUBRIC_SET.length; index += 1) {
            const fixture = RUBRIC_SET[index];
            aiTesting.setObjectRunner(async () => ({
                object: sloppyExtraction(fixture.document, index),
                inputTokens: 10,
                outputTokens: 10,
            }));

            const result = await parseFrameworkText({ userId, text: fixture.document });
            const parsedLevels = result.shape.levels.map((level) => normalizeName(level.name));
            const parsedCompetencies = result.shape.competencies.map((item) => normalizeName(item.name));

            // Levels are scored positionally: order is a field, not a detail.
            fixture.levels.forEach((expected, position) => {
                total += 1;
                if (parsedLevels[position] === normalizeName(expected)) correct += 1;
                else misses.push(`${fixture.name} level ${position}`);
            });

            for (const expected of fixture.competencies) {
                total += 1;
                if (parsedCompetencies.includes(normalizeName(expected))) correct += 1;
                else misses.push(`${fixture.name} competency ${expected}`);
            }

            // Normalization invariants, on every document:
            expect(new Set(result.shape.levels.map((level) => level.key)).size).toBe(
                result.shape.levels.length,
            );
            expect(new Set(result.shape.competencies.map((item) => item.key)).size).toBe(
                result.shape.competencies.length,
            );
            expect(result.shape.levels.map((level) => level.order)).toEqual(
                result.shape.levels.map((_, position) => position),
            );
            expect(result.shape.competencies.every((item) => item.key === slug(item.key))).toBe(true);
        }

        const accuracy = correct / total;
        // Reported rather than merely asserted: a regression should say by how much.
        console.log(
            `[rubric parse] ${correct}/${total} fields = ${(accuracy * 100).toFixed(1)}% (misses: ${misses.length})`,
        );
        expect(accuracy).toBeGreaterThanOrEqual(0.85);
    }, 30_000);

    test('parsing writes nothing — the confirmation screen is structural', async () => {
        aiTesting.setUsageLogger(async () => {});
        aiTesting.setObjectRunner(async () => ({
            object: sloppyExtraction(RUBRIC_SET[1].document, 1),
            inputTokens: 10,
            outputTokens: 10,
        }));

        const userId = user('nowrite');
        await parseFrameworkText({ userId, text: RUBRIC_SET[1].document });

        const rows = await prisma.competencyFramework.count({ where: { userId } });
        expect(rows).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════ the mapping

describe('deterministic priors', () => {
    test('every win category has at least one prior', () => {
        for (const category of Object.values(WinCategory)) {
            expect(CATEGORY_PRIORS[category].length).toBeGreaterThan(0);
        }
    });

    test('priors land on a real company ladder through synonyms', () => {
        const google = PUBLIC_FRAMEWORK_TEMPLATES[0].competencies;
        expect(resolvePriorKey(google, 'execution')).toBe('impact');
        expect(resolvePriorKey(google, 'communication')).toBe('communication');
        expect(resolvePriorKey(google, 'scope_ambiguity')).toBe('scope');
    });

    test('a competency with no analogue on the ladder resolves to nothing, not to a guess', () => {
        const narrow: FrameworkCompetency[] = [
            { key: 'widgets', name: 'Widget assembly', description: '', levelExpectations: {} },
        ];
        for (const key of DEFAULT_COMPETENCY_KEYS) {
            expect(resolvePriorKey(narrow, key)).toBeNull();
        }
    });

    test('a win is never mapped to more than two competencies', () => {
        const mappings = dedupeMappings([
            { winId: 'w', competencyKey: 'a', strength: 'strong' },
            { winId: 'w', competencyKey: 'b', strength: 'supporting' },
            { winId: 'w', competencyKey: 'c', strength: 'supporting' },
            { winId: 'w', competencyKey: 'd', strength: 'strong' },
        ]);
        expect(mappings.filter((entry) => entry.winId === 'w')).toHaveLength(2);
        expect(mappings.every((entry) => entry.strength === 'strong')).toBe(true);
    });

    test('the model refines the priors and cannot escape the vocabulary', async () => {
        aiTesting.setUsageLogger(async () => {});
        aiTesting.setObjectRunner(async () => ({
            object: {
                mappings: [
                    { winId: 'm1', competencyKey: 'mentorship', strength: 'strong' },
                    { winId: 'm1', competencyKey: 'not_a_competency', strength: 'strong' },
                    { winId: 'nope', competencyKey: 'execution', strength: 'strong' },
                ],
            },
            inputTokens: 10,
            outputTokens: 10,
        }));

        const result = await mapWinsToCompetencies({
            userId: user('map'),
            wins: [
                {
                    id: 'm1',
                    category: WinCategory.shipped,
                    title: 'Shipped it',
                    narrative: '',
                    occurredAt: new Date('2026-05-01T00:00:00.000Z'),
                    metric: null,
                },
            ],
            competencies: PATRONUS_DEFAULT_FRAMEWORK.competencies,
        });

        expect(result.fellBack).toBe(false);
        expect(result.mappings).toEqual([{ winId: 'm1', competencyKey: 'mentorship', strength: 'strong' }]);
    });

    test('a model outage leaves the deterministic priors standing', async () => {
        aiTesting.setUsageLogger(async () => {});
        aiTesting.setObjectRunner(async () => {
            throw new Error('model unavailable');
        });

        const result = await mapWinsToCompetencies({
            userId: user('map-down'),
            wins: [
                {
                    id: 'd1',
                    category: WinCategory.grew,
                    title: 'Mentored a new hire',
                    narrative: '',
                    occurredAt: new Date('2026-05-01T00:00:00.000Z'),
                    metric: null,
                },
            ],
            competencies: PATRONUS_DEFAULT_FRAMEWORK.competencies,
        });

        expect(result.fellBack).toBe(true);
        expect(result.mappings.some((entry) => entry.competencyKey === 'mentorship')).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════ the verdicts

describe('verdicts', () => {
    test('the PRD 03 §4.2 thresholds, exactly', () => {
        expect(verdictFor(0, 0)).toBe('absent');
        expect(verdictFor(0.4, 0)).toBe('thin');
        expect(verdictFor(1.5, 0)).toBe('adequate');
        // Strong needs BOTH the weight and the evidence share.
        expect(verdictFor(3.0, 0.4)).toBe('adequate');
        expect(verdictFor(3.0, 0.5)).toBe('strong');
    });

    test('coverage, strength and evidence share are computed from real mappings', () => {
        const wins = [
            { id: 'a', title: 'One', occurredAt: new Date('2026-05-01T00:00:00.000Z'), quantified: true },
            { id: 'b', title: 'Two', occurredAt: new Date('2026-04-01T00:00:00.000Z'), quantified: false },
        ];
        const assessments = assessCompetencies({
            competencies: PATRONUS_DEFAULT_FRAMEWORK.competencies,
            mappings: [
                { winId: 'a', competencyKey: 'execution', strength: 'strong' },
                { winId: 'b', competencyKey: 'execution', strength: 'supporting' },
            ],
            wins,
        });

        const execution = assessments.find((item) => item.key === 'execution');
        expect(execution?.coverage).toBe(2);
        expect(execution?.strength).toBe(1.4);
        expect(execution?.evidenceShare).toBe(0.5);
        // 1.4 is below the 1.5 `adequate` floor. One strong plus one supporting
        // win is thin, and the report says so rather than rounding up.
        expect(execution?.verdict).toBe('thin');
        // Most recent first, so the rationale cites the freshest example.
        expect(execution?.winIds).toEqual(['a', 'b']);
    });

    test('a mapping pointing at a win outside the set is ignored, not counted', () => {
        const assessments = assessCompetencies({
            competencies: PATRONUS_DEFAULT_FRAMEWORK.competencies,
            mappings: [{ winId: 'ghost', competencyKey: 'execution', strength: 'strong' }],
            wins: [],
        });
        expect(assessments.every((item) => item.verdict === 'absent')).toBe(true);
    });

    test('priors from a single-category log produce real absences', () => {
        const wins = Array.from({ length: 5 }, (_, index) => ({
            id: `s${index}`,
            category: WinCategory.shipped,
        }));
        const assessments = assessCompetencies({
            competencies: PATRONUS_DEFAULT_FRAMEWORK.competencies,
            mappings: priorMappings(wins, PATRONUS_DEFAULT_FRAMEWORK.competencies),
            wins: wins.map((win) => ({
                id: win.id,
                title: 'Shipped',
                occurredAt: new Date('2026-05-01T00:00:00.000Z'),
                quantified: false,
            })),
        });

        expect(assessments.find((item) => item.key === 'mentorship')?.verdict).toBe('absent');
        expect(assessments.find((item) => item.key === 'influence')?.verdict).toBe('absent');
        expect(assessments.find((item) => item.key === 'execution')?.verdict).not.toBe('absent');
    });
});

// ═══════════════════════════════════════════════════════════ target levels

describe('target level resolution', () => {
    const levels = PATRONUS_DEFAULT_FRAMEWORK.levels;

    test('matches on key or name', () => {
        expect(resolveTargetLevel(levels, 'l4').level?.name).toBe('Staff');
        expect(resolveTargetLevel(levels, 'Staff').level?.name).toBe('Staff');
        expect(resolveTargetLevel(levels, 'staff').substituted).toBe(false);
    });

    test('offers the nearest level rather than silently accepting a bad one', () => {
        const near = resolveTargetLevel(levels, 'Staff Engineer');
        expect(near.level?.name).toBe('Staff');
        expect(near.substituted).toBe(true);

        const nothing = resolveTargetLevel(levels, 'Distinguished Fellow');
        expect(nothing.level).toBeNull();
        expect(nothing.substituted).toBe(true);
    });
});
