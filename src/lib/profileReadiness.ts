import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';

/**
 * Does this user have any history to build a resume FROM?
 *
 * Generation against an empty profile produced a resume with nothing true in
 * it and spent one of Free's ten tailored resumes doing so (audit 2026-09-27,
 * D). Cheap: three counts, no model. `requireProfileHistory` is the server-side
 * guard for generation entry points to call BEFORE metering.
 */
export type ProfileReadiness = {
    hasHistory: boolean;
    experiences: number;
    projects: number;
    education: number;
};

export async function profileReadiness(userId: string): Promise<ProfileReadiness> {
    const [experiences, projects, education] = await Promise.all([
        prisma.userExperience.count({ where: { userId } }),
        prisma.userProject.count({ where: { userId } }),
        prisma.userEducation.count({ where: { userId } }),
    ]);
    return { hasHistory: experiences + projects > 0, experiences, projects, education };
}

export const EMPTY_PROFILE_MESSAGE =
    'Add your work history first: upload your resume and we will read your roles and projects in. A tailored resume needs something true to tailor.';

export async function requireProfileHistory(userId: string): Promise<Result<ProfileReadiness>> {
    const readiness = await profileReadiness(userId);
    if (!readiness.hasHistory) return err(EMPTY_PROFILE_MESSAGE, 'empty_profile');
    return ok(readiness);
}
