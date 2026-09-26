/**
 * Write a Scout answer back to the user's preferences, so the question is
 * asked once in a lifetime rather than once per job.
 *
 * Uses the same `applyAnswer` mapping the fit section applies to this run's
 * answers (`fit/answers.ts`), so what was saved and what was evaluated cannot
 * differ. Read-merge-write over the whole preferences object, parsed through
 * `parseUserGenerationPreferences` both ways: resume-formatting fields the
 * user set elsewhere survive untouched, and unknown keys cannot creep in.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import { applyAnswer, isPreferenceQuestionId } from '@/lib/scout/fit/answers';

export async function applyAnswerToProfile(userId: string, questionId: string, value: string): Promise<void> {
    if (!isPreferenceQuestionId(questionId)) return;

    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { preferences: true },
    });
    const current = parseUserGenerationPreferences(profile?.preferences);
    const next = applyAnswer(current, questionId, value);
    // An answer we could not understand is not saved: storing it as-is would
    // replace a real (if empty) preference with noise.
    if (!next) return;

    const preferences = next as unknown as Prisma.InputJsonValue;
    await prisma.userProfile.upsert({
        where: { userId },
        create: { userId, preferences },
        update: { preferences },
    });
}
