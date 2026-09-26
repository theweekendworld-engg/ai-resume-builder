import { afterAll, describe, expect, test } from 'bun:test';
import { prisma } from '@/lib/prisma';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import { applyAnswerToProfile } from './preferences';

const USER = `itest-prefs-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const NEW_USER = `${USER}-new`;

afterAll(async () => {
    await prisma.userProfile.deleteMany({ where: { userId: { in: [USER, NEW_USER] } } });
});

describe('applyAnswerToProfile', () => {
    test('merges the answer without touching other preferences', async () => {
        await prisma.userProfile.create({
            data: { userId: USER, preferences: { defaultTemplate: 'modern', preferredWorkModes: ['remote'], desiredCompensation: '40 LPA' } },
        });
        await applyAnswerToProfile(USER, 'pref.relocate', 'no');
        await applyAnswerToProfile(USER, 'pref.location', 'Bengaluru and Pune');

        const saved = parseUserGenerationPreferences((await prisma.userProfile.findUnique({ where: { userId: USER } }))?.preferences);
        expect(saved.willingToRelocate).toBe('no');
        expect(saved.targetLocations).toEqual(['Bengaluru', 'Pune']);
        expect(saved.defaultTemplate).toBe('modern');
        expect(saved.preferredWorkModes).toEqual(['remote']);
        expect(saved.desiredCompensation).toBe('40 LPA');
    });

    test('an unintelligible answer and an unknown question id change nothing', async () => {
        const before = (await prisma.userProfile.findUnique({ where: { userId: USER } }))?.preferences;
        await applyAnswerToProfile(USER, 'pref.minComp', 'lots');
        await applyAnswerToProfile(USER, 'not.a.question', 'x');
        expect((await prisma.userProfile.findUnique({ where: { userId: USER } }))?.preferences).toEqual(before!);
    });

    test('creates the profile when the user has none yet', async () => {
        await applyAnswerToProfile(NEW_USER, 'pref.workMode', 'remote, hybrid');
        const saved = parseUserGenerationPreferences((await prisma.userProfile.findUnique({ where: { userId: NEW_USER } }))?.preferences);
        expect(saved.preferredWorkModes).toEqual(['remote', 'hybrid']);
    });
});
