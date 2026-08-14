import { describe, test, expect } from 'bun:test';
import { config } from '@/lib/config';
import { TASK_KEYS, isTaskKey, resolveTaskModel, type TaskKey } from './tasks';

describe('task -> model map', () => {
    const R1_TASKS: TaskKey[] = [
        'winDraft',
        'winStructure',
        'digestCompose',
        'monthReview',
        'packetThemes',
        'packetMap',
        'packetCompose',
        'interviewTurn',
        'interviewExtract',
        'radarNormalize',
        'radarReason',
    ];

    test('every R1 task key from P0.4 exists', () => {
        for (const task of R1_TASKS) {
            expect(TASK_KEYS).toContain(task);
        }
    });

    test('TASK_KEYS and config.openai.models are the same set', () => {
        expect([...TASK_KEYS].sort() as string[]).toEqual(Object.keys(config.openai.models).sort());
    });

    test('every task resolves to a non-empty model id', () => {
        for (const task of TASK_KEYS) {
            const model = resolveTaskModel(task);
            expect(typeof model).toBe('string');
            expect(model.length).toBeGreaterThan(0);
        }
    });

    test('every R1 task key is env-overridable', async () => {
        // asserted against the source rather than the loaded module: config.ts is
        // evaluated once at import, so an env change here would not be observable.
        const source = await Bun.file(new URL('../config.ts', import.meta.url).pathname).text();
        const expectedEnvVars = [
            'OPENAI_MODEL_WIN_DRAFT',
            'OPENAI_MODEL_WIN_STRUCTURE',
            'OPENAI_MODEL_DIGEST_COMPOSE',
            'OPENAI_MODEL_MONTH_REVIEW',
            'OPENAI_MODEL_PACKET_THEMES',
            'OPENAI_MODEL_PACKET_MAP',
            'OPENAI_MODEL_PACKET_COMPOSE',
            'OPENAI_MODEL_INTERVIEW_TURN',
            'OPENAI_MODEL_INTERVIEW_EXTRACT',
            'OPENAI_MODEL_RADAR_NORMALIZE',
            'OPENAI_MODEL_RADAR_REASON',
        ];
        for (const envVar of expectedEnvVars) {
            expect(source).toContain(envVar);
        }
    });

    test('isTaskKey rejects anything not in the map', () => {
        expect(isTaskKey('winDraft')).toBe(true);
        expect(isTaskKey('gpt-5')).toBe(false);
        expect(isTaskKey(undefined)).toBe(false);
    });

    test('resolveTaskModel throws for an unmapped task rather than guessing', () => {
        expect(() => resolveTaskModel('nope' as TaskKey)).toThrow(/No model configured/);
    });
});
