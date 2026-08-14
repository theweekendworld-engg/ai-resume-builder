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
import {
    detectPreferenceConflicts,
    type PreferenceConflict,
} from '@/lib/resume/preferenceConflicts';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';

export type ResumeCoverageView = {
    report: ResumeCoverage;
    /**
     * What the user's stored defaults cost on this posting. Computed here
     * rather than stored on the row because preferences change after a resume
     * is generated, and a warning about a limit you have since raised is worse
     * than no warning.
     */
    conflicts: PreferenceConflict[];
};

export async function getResumeCoverage(
    resumeId: string,
): Promise<Result<ResumeCoverageView | null>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const [resume, profile] = await Promise.all([
        prisma.resume.findFirst({
            where: { id: resumeId, userId },
            select: { coverageReport: true },
        }),
        prisma.userProfile.findUnique({
            where: { userId },
            select: { preferences: true },
        }),
    ]);
    if (!resume) return err('Resume not found', 'not_found');

    // Null is a normal answer, not an error: a resume made before this existed,
    // by the v1 fallback, or reused from an earlier generation has no report.
    // The panel hides itself rather than showing an empty shell.
    const report = parseReport(resume.coverageReport);
    if (!report) return ok(null);

    const preferences = parseUserGenerationPreferences(profile?.preferences);

    return ok({
        report,
        conflicts: detectPreferenceConflicts({
            preferences,
            dropped: report.dropped,
            // Optional on the stored shape: reports written before
            // `answeredByCut` existed simply have none, which is a smaller
            // warning rather than a broken one.
            answeredByCut: report.answeredByCut ?? [],
        }),
    });
}
