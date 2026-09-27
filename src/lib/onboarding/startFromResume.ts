/**
 * First run → a real resume document, in one step.
 *
 * Plain server code (not a server action): the actions in
 * `src/actions/onboarding.ts` take identity from the session and call these
 * with it. Dependencies are injectable so the path is testable without a model.
 *
 * ── What changed ────────────────────────────────────────────────────────────
 *
 * Onboarding used to read the resume into history and then send the user to a
 * job-description box. Someone who came to FIX their resume left with no
 * resume at all, and the fixes from `/score` had been cleared on the way
 * (audit 2026-09-27, B and D). Now every path in creates a Resume the user can
 * open, and a score stash carries its fixes to it.
 */

import { Prisma } from '@prisma/client';
import type { ParsedResumeData } from '@/lib/aiSchemas';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { resumeDataFromParsed, resumeTitleFromParsed } from '@/lib/resume/fromParsed';
import { claimScoreStash, recordStashResume } from '@/lib/scoreStash';

/** Below this there is no resume in the text, whatever the file was. */
export const MIN_RESUME_CHARS = 120;

export type ImportOutcome = {
    experiences: number;
    projects: number;
    education: number;
    /** Read off the resume, so the welcome screen can name them back. */
    companies: string[];
};

export type StartOutcome = {
    resumeId: string;
    outcome: ImportOutcome;
    /** Fixes carried from the free check (0 without a stash). */
    fixes: number;
    score: number | null;
    /** True when this stash already made a resume and it was reopened. */
    reused: boolean;
};

export type StartDeps = {
    parse: (text: string, userId: string) => Promise<ParsedResumeData>;
    /** Writes history. Returns created counts; must dedupe (the real one does). */
    importHistory: (parsed: ParsedResumeData) => Promise<{ success: boolean; experiences: number; projects: number; education: number; error?: string }>;
};

async function defaultDeps(): Promise<StartDeps> {
    const [{ parseResumeText }, { importParsedResumeData }] = await Promise.all([
        import('@/lib/resumeParser'),
        import('@/actions/resumeImport'),
    ]);
    return {
        parse: (text, userId) => parseResumeText(text.slice(0, 40_000), userId),
        importHistory: async (parsed) => {
            const result = await importParsedResumeData(parsed, {
                // Merge rather than overwrite: a first run never clobbers what
                // the user typed a moment earlier.
                mergeProfile: true,
                sections: { experience: true, education: true, projects: true, achievements: true },
            });
            return {
                success: result.success,
                error: result.error,
                experiences: result.summary?.experience.created ?? 0,
                projects: result.summary?.projects.created ?? 0,
                education: result.summary?.education.created ?? 0,
            };
        },
    };
}

let depsOverride: StartDeps | null = null;
export const __testing = {
    setDeps(next: StartDeps | null) {
        depsOverride = next;
    },
};

async function deps(): Promise<StartDeps> {
    return depsOverride ?? defaultDeps();
}

function companiesOf(parsed: ParsedResumeData): string[] {
    return parsed.experiences
        .map((item) => item.company?.trim())
        .filter((company): company is string => Boolean(company))
        .slice(0, 4);
}

async function createResumeDocument(userId: string, parsed: ParsedResumeData, score: number | null): Promise<string> {
    const resume = await prisma.resume.create({
        data: {
            userId,
            title: resumeTitleFromParsed(parsed),
            targetRole: parsed.personalInfo.title?.trim() || null,
            content: resumeDataFromParsed(parsed) as unknown as Prisma.InputJsonValue,
            atsScore: score === null ? null : Math.round(score),
        },
        select: { id: true },
    });
    return resume.id;
}

/** Parsed resume (from an upload) → history + a Resume. */
export async function startFromParsed(
    userId: string,
    parsed: ParsedResumeData,
    score: number | null = null,
): Promise<Result<StartOutcome>> {
    const d = await deps();
    const imported = await d.importHistory(parsed);
    if (!imported.success) return err(imported.error ?? 'Could not save that resume.', 'import_failed');
    const resumeId = await createResumeDocument(userId, parsed, score);
    return ok({
        resumeId,
        outcome: {
            experiences: imported.experiences,
            projects: imported.projects,
            education: imported.education,
            companies: companiesOf(parsed),
        },
        fixes: 0,
        score,
        reused: false,
    });
}

/** Raw resume text → parse once → history + a Resume. */
export async function startFromText(userId: string, text: string, score: number | null = null): Promise<Result<StartOutcome>> {
    const trimmed = text.trim();
    if (trimmed.length < MIN_RESUME_CHARS) {
        return err('That does not look like a resume: there is too little text to read.', 'invalid_input');
    }
    const d = await deps();
    let parsed: ParsedResumeData;
    try {
        parsed = await d.parse(trimmed, userId);
    } catch (error: unknown) {
        return err(error instanceof Error ? error.message : 'We could not read that resume.', 'parse_failed');
    }
    return startFromParsed(userId, parsed, score);
}

/**
 * A `/score` stash → claim it → history + a Resume, carrying the fixes.
 * Idempotent: the same stash reopens the same resume.
 */
export async function startFromStash(userId: string, stashId: string): Promise<Result<StartOutcome>> {
    const stash = await claimScoreStash(stashId, userId);
    if (!stash) {
        return err('That checked resume is no longer available. Upload it again and we will pick up from there.', 'stash_missing');
    }

    if (stash.resumeId) {
        const existing = await prisma.resume.findFirst({ where: { id: stash.resumeId, userId }, select: { id: true } });
        if (existing) {
            return ok({
                resumeId: existing.id,
                outcome: { experiences: 0, projects: 0, education: 0, companies: [] },
                fixes: stash.fixes.length,
                score: stash.score,
                reused: true,
            });
        }
    }

    const started = await startFromText(userId, stash.extractedText, stash.score);
    if (!started.success) return started;
    await recordStashResume(stash.id, userId, started.data.resumeId);
    return ok({ ...started.data, fixes: stash.fixes.length });
}
