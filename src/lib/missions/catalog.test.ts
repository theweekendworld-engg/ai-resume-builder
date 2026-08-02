/**
 * The catalog is data, and these are the rules that keep it honest.
 *
 * Two of them exist because the failure mode is silent. A mission whose
 * `automatic` step names an event nobody emits, or whose `threshold` step
 * names a query the evaluator cannot run, looks completely fine in review and
 * then never completes for a real user — three months into a program they
 * committed to.
 */

import { describe, expect, test } from 'bun:test';
import { MissionType } from '@prisma/client';

import { SERVER_EVENTS } from '@/lib/track';
import {
    MISSION_CATALOG,
    MIN_NON_MANUAL_RATIO,
    SELECTABLE_MISSIONS,
    THRESHOLD_QUERIES,
    isBuiltMissionType,
    missionTemplate,
    nonManualRatio,
} from './catalog';

const templates = Object.values(MISSION_CATALOG);
const EVENTS = new Set<string>(SERVER_EVENTS);
const QUERIES = new Set<string>(THRESHOLD_QUERIES);

describe('every step can actually complete', () => {
    test.each(templates.map((t) => [t.type, t] as const))(
        '%s: automatic steps name events that exist',
        (_type, template) => {
            for (const step of template.steps) {
                if (step.condition.kind !== 'automatic') continue;
                expect(EVENTS.has(step.condition.event)).toBe(true);
            }
        },
    );

    test.each(templates.map((t) => [t.type, t] as const))(
        '%s: threshold steps name queries the evaluator supports',
        (_type, template) => {
            for (const step of template.steps) {
                if (step.condition.kind !== 'threshold') continue;
                expect(QUERIES.has(step.condition.query)).toBe(true);
                expect(step.condition.target).toBeGreaterThan(0);
            }
        },
    );

    test('every event named by the catalog has a real emitter in src/', async () => {
        // The strongest version of the check: an event in SERVER_EVENTS that
        // nothing calls `track()` with is just as dead as one that does not
        // exist. Greps the tree rather than trusting the enum.
        const { readdirSync, readFileSync, statSync } = await import('node:fs');
        const { join } = await import('node:path');

        const walk = (dir: string): string[] =>
            readdirSync(dir).flatMap((entry) => {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) return walk(full);
                return full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
            });

        const sources = walk('src')
            .filter((file) => !file.includes('.test.') && !file.endsWith('src/lib/track.ts'))
            .map((file) => readFileSync(file, 'utf8'))
            .join('\n');

        const needed = new Set(
            templates.flatMap((template) =>
                template.steps.flatMap((step) =>
                    step.condition.kind === 'automatic' ? [step.condition.event] : [],
                ),
            ),
        );

        const orphaned = [...needed].filter((event) => !sources.includes(`'${event}'`));
        expect(orphaned).toEqual([]);
    });
});

describe('§4 — a mission is not a to-do list', () => {
    test.each(templates.map((t) => [t.type, t] as const))(
        '%s: at least 60%% of steps are automatic or threshold',
        (_type, template) => {
            expect(nonManualRatio(template)).toBeGreaterThanOrEqual(MIN_NON_MANUAL_RATIO);
        },
    );
});

describe('structure', () => {
    test.each(templates.map((t) => [t.type, t] as const))('%s: step keys are unique', (_type, template) => {
        const keys = template.steps.map((step) => step.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    test('every template is filed under its own type', () => {
        for (const [key, template] of Object.entries(MISSION_CATALOG)) {
            expect(template.type).toBe(key as MissionType);
        }
    });

    test('every selectable mission has a template', () => {
        for (const type of SELECTABLE_MISSIONS) {
            expect(missionTemplate(type)).not.toBeNull();
        }
    });

    test('keep_warm is not selectable — it is the resting state', () => {
        // §3 M7: "not shown as a mission with progress; it's the resting
        // state". It is instantiated for everyone, never chosen.
        expect(SELECTABLE_MISSIONS).not.toContain(MissionType.keep_warm);
        expect(missionTemplate(MissionType.keep_warm)).not.toBeNull();
    });

    test('keep_warm has no attested step — it is never finished by hand', () => {
        const warm = MISSION_CATALOG[MissionType.keep_warm];
        expect(warm.steps.every((step) => step.condition.kind !== 'attested')).toBe(true);
    });
});

describe('negotiate_offer is a declared type with no template', () => {
    test('missionTemplate returns null rather than throwing', () => {
        // It cannot be built until something writes OfferDataPoint — see the
        // note in catalog.ts. A stored row of this type must degrade, not
        // crash, so the enum can stay stable for the migration that adds it.
        expect(isBuiltMissionType(MissionType.negotiate_offer)).toBe(false);
        expect(missionTemplate(MissionType.negotiate_offer)).toBeNull();
    });

    test('it is not offered to users', () => {
        expect(SELECTABLE_MISSIONS).not.toContain(MissionType.negotiate_offer);
    });
});
