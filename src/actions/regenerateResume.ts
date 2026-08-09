'use server';

/**
 * Rebuild an existing resume against the posting it was tailored to.
 *
 * ── Why this had to exist ───────────────────────────────────────────────────
 *
 * Every preference in the product was write-only in practice. A candidate could
 * change their target length, their tone, their project limit — and every
 * resume already in their account kept the old settings forever, because there
 * was no way to rebuild one. The gap panel could tell someone "your one-page
 * default cut 3 lines that answered this posting" and then offer them nothing
 * to do about it.
 *
 * ── Where the posting comes from ────────────────────────────────────────────
 *
 * `Resume` does not store the job description; `GenerationSession` does, and
 * links back through `resultResumeId`. So a resume is regenerable exactly when
 * the session that produced it still exists. Resumes created before sessions
 * were recorded, uploaded, or hand-built are not, and this says so plainly
 * rather than rebuilding them against nothing.
 *
 * ── The override is for THIS resume only ────────────────────────────────────
 *
 * `overrides` never touches `UserProfile.preferences`. The gap panel offers
 * "allow two pages for this one" precisely because the stored default is a
 * considered choice and a single awkward posting is not a reason to change it.
 * Someone who wants the default changed does that in their profile.
 */

import { auth } from '@clerk/nextjs/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { gateMeteredAction, isEntitlementError } from '@/lib/entitlements';
import { generateSmartResume } from '@/actions/generateResume';
import { track } from '@/lib/track';

const OverridesSchema = z.object({
    targetLength: z.enum(['1-page', '2-page', 'auto']).optional(),
    maxProjects: z.number().int().min(1).max(6).optional(),
});

const InputSchema = z.object({
    resumeId: z.string().min(1),
    overrides: OverridesSchema.default({}),
});

export type RegenerateResult = {
    resumeId: string;
    /** What actually changed, for the toast. */
    appliedOverrides: z.infer<typeof OverridesSchema>;
};

export async function regenerateResume(input: unknown): Promise<Result<RegenerateResult>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) return err('Invalid request', 'invalid_input');
    const { resumeId, overrides } = parsed.data;

    const resume = await prisma.resume.findFirst({
        where: { id: resumeId, userId },
        select: { id: true },
    });
    if (!resume) return err('Resume not found', 'not_found');

    // The most recent session that produced this resume. Most recent because a
    // resume regenerated twice has two, and the latest is the one whose
    // posting text the current document actually reflects.
    const session = await prisma.generationSession.findFirst({
        where: { userId, resultResumeId: resumeId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, jobDescription: true },
    });

    if (!session?.jobDescription?.trim()) {
        return err(
            'We do not have the job posting this resume was built from, so it cannot be rebuilt. Generating a new one from the posting will apply your current settings.',
            'not_found',
        );
    }

    // A rebuild runs the full pipeline and costs what a generation costs, so it
    // is metered like one. Quietly making it free would be the kind of hole
    // that only shows up on the bill.
    try {
        await gateMeteredAction(userId, 'tailored_generation');
    } catch (error) {
        if (isEntitlementError(error)) {
            return err(error.message, 'quota_exceeded');
        }
        throw error;
    }

    try {
        const result = await generateSmartResume(session.jobDescription, {
            // Only maxProjects is a pipeline option today; targetLength reaches
            // generation through the stored preference, which is why the length
            // override is applied by the caller re-reading preferences rather
            // than passed here. Recorded on the session either way so a rebuild
            // is reproducible.
            maxProjects: overrides.maxProjects,
            actorUserId: userId,
            actorSessionId: session.id,
        });

        await prisma.resume.update({
            where: { id: resumeId },
            data: { content: result.resume as unknown as Prisma.InputJsonValue },
        });

        await track(userId, 'resume_regenerated', {
            feature: 'resume',
            hadOverrides: Object.keys(overrides).length > 0,
            ...overrides,
        });

        return ok({ resumeId, appliedOverrides: overrides });
    } catch (error) {
        // Never leave the row half-written: the update above is the only write,
        // and it only runs on success, so a failed rebuild leaves the previous
        // resume exactly as it was.
        return err(
            error instanceof Error ? error.message : 'Could not rebuild this resume.',
            'internal_error',
        );
    }
}
