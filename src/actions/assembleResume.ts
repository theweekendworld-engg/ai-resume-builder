'use server';

/**
 * Generate a resume by assembly, and store it.
 *
 * The entry point for the agentic path. Behind a flag and additive: the fixed
 * pipeline is untouched and remains the default until the eval corpus says
 * otherwise. Nothing here is reachable without `FEATURE_AGENTIC_RESUME=true`.
 *
 * The order — auth, gate, assemble, guard, persist — is deliberate. The gate
 * runs before the model, so a user out of quota never costs us a generation.
 * The guard runs before the write, so a document that cannot be defended never
 * reaches a row. And the write is single and last, so a failure anywhere leaves
 * the account exactly as it was.
 */

import { auth } from '@clerk/nextjs/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { gateMeteredAction, isEntitlementError } from '@/lib/entitlements';
import { assembleResume as runAssembly } from '@/lib/ai/resumeLoop';
import { resumeFromDraft } from '@/lib/resume/fromDraft';
import { getContactCard, listRoles } from '@/lib/resume/tools/evidence';
import { track } from '@/lib/track';

const InputSchema = z.object({
    jobDescription: z.string().min(40, 'Paste the full job posting.'),
    title: z.string().max(120).optional(),
});

export type AssembleResult = { resumeId: string; roles: number; toolCalls: number };

export async function generateResumeByAssembly(
    input: unknown,
): Promise<Result<AssembleResult>> {
    if (process.env.FEATURE_AGENTIC_RESUME !== 'true') {
        return err('Not available', 'not_found');
    }

    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
        return err(parsed.error.issues[0]?.message ?? 'Invalid request', 'invalid_input');
    }

    try {
        await gateMeteredAction(userId, 'tailored_generation');
    } catch (error) {
        if (isEntitlementError(error)) return err(error.message, 'quota_exceeded');
        throw error;
    }

    const [contact, roles] = await Promise.all([
        getContactCard(userId),
        listRoles(userId),
    ]);

    let assembly: Awaited<ReturnType<typeof runAssembly>>;
    try {
        assembly = await runAssembly({
            userId,
            jobDescription: parsed.data.jobDescription,
        });
    } catch (error) {
        // Includes the loop hitting its step ceiling without submitting. That is
        // a real failure and is reported as one rather than salvaged.
        return err(
            error instanceof Error ? error.message : 'Could not assemble a resume.',
            'internal_error',
        );
    }

    const checked = resumeFromDraft({
        draft: assembly.draft,
        contact,
        availableRoles: roles.length,
    });

    if (!checked.ok) {
        await track(userId, 'ai_guard_violation', {
            feature: 'resume',
            reason: checked.reason.kind,
            detail: checked.reason.detail,
        });
        return err(
            checked.reason.kind === 'fabrication'
                ? 'We could not verify every line against your record, so nothing was saved. Please try again.'
                : 'The assembly came back empty, so nothing was saved. Please try again.',
            'internal_error',
        );
    }

    const resume = await prisma.resume.create({
        data: {
            userId,
            title: parsed.data.title?.trim() || assembly.draft.headline || 'Tailored resume',
            content: checked.resume as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
    });

    await track(userId, 'resume_regenerated', {
        feature: 'resume',
        path: 'agentic',
        steps: assembly.steps,
        toolCalls: assembly.toolCalls.length,
        roles: checked.resume.experience.length,
    });

    return ok({
        resumeId: resume.id,
        roles: checked.resume.experience.length,
        toolCalls: assembly.toolCalls.length,
    });
}
