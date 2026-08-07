'use server';

/**
 * The gap report for one resume.
 *
 * Read-only and deliberately thin: everything interesting was computed during
 * generation and stored on the row. This exists so the editor panel does not
 * reach into Prisma, and so ownership is checked in exactly one place.
 */

import { auth } from '@clerk/nextjs/server';

import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { parseReport, type ResumeCoverage } from '@/lib/resume/report';

export async function getResumeCoverage(
    resumeId: string,
): Promise<Result<ResumeCoverage | null>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const resume = await prisma.resume.findFirst({
        where: { id: resumeId, userId },
        select: { coverageReport: true },
    });
    if (!resume) return err('Resume not found', 'not_found');

    // Null is a normal answer, not an error: a resume made before this existed,
    // by the v1 fallback, or reused from an earlier generation has no report.
    // The panel hides itself rather than showing an empty shell.
    return ok(parseReport(resume.coverageReport));
}
