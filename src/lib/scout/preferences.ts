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
import { SCOUT_QUESTION_TOPICS } from '@/lib/memory/topics';
import { track } from '@/lib/track';
import { cleanMemoryText, remember } from '@/services/memory';

/**
 * The answer, in the user's words, as long-term memory too
 * (docs/impl/08-memory.md): the chat router and drafts read it there, and
 * Settings → Memory shows it. Only an answer that was understood is kept,
 * the same bar as the profile write. Never throws.
 */
async function rememberScoutAnswer(userId: string, questionId: string, value: string, sourceRef?: string): Promise<void> {
    const topic = SCOUT_QUESTION_TOPICS[questionId];
    // Kept as said: "yes" is the whole answer to "open to relocating?".
    const text = cleanMemoryText(value);
    if (!topic || !text) return;
    try {
        const saved = await remember(userId, {
            key: topic.key,
            label: topic.label,
            text,
            source: 'scout_answer',
            sourceRef: sourceRef ? `scout:${sourceRef}:${questionId}` : `scout:${questionId}`,
            // Private topics are always private; otherwise a refresh keeps
            // whatever the user chose in Settings → Memory.
            sensitivity: topic.sensitivity === 'private' ? 'private' : undefined,
        });
        if (saved) await track(userId, 'memory_saved', { key: topic.key, source: 'scout_answer' });
    } catch (error: unknown) {
        console.warn('[scout] could not remember the answer', { questionId, error: String(error) });
    }
}

export async function applyAnswerToProfile(userId: string, questionId: string, value: string, sourceRef?: string): Promise<void> {
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
    await rememberScoutAnswer(userId, questionId, value, sourceRef);
}
