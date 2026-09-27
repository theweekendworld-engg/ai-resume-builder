'use server';

/**
 * First run.
 *
 * ── What this is fixing ─────────────────────────────────────────────────────
 *
 * There was no path from signing up to seeing anything worth paying for. The
 * only onboarding was a modal on `/dashboard` asking for a name and a title,
 * which is data collection rather than value: a profile with a name and no
 * history still generates nothing.
 *
 * Worse, the funnel leaked at the seam. `/score` stashes the resume it just
 * read into sessionStorage and sends the user to
 * `/sign-up?redirect_url=/build`, where `BuildWizard` would have picked it up.
 * But the sign-up page set `forceRedirectUrl="/dashboard"`, and in Clerk that
 * takes precedence over the query parameter — so every single person who used
 * the free checker and clicked "Fix all of these" landed on an empty dashboard
 * with their parsed resume sitting unread in a browser tab's memory.
 *
 * ── What first value actually is ────────────────────────────────────────────
 *
 * A tailored resume, and it needs history to exist. So onboarding has exactly
 * one job: get the user's history in. Everything else — the name, the links,
 * the target level — can be edited later and none of it unblocks anything.
 *
 * Which makes the `/score` handoff the best onboarding in the product: their
 * resume has ALREADY been read. There is nothing to upload and nothing to
 * type, and the first thing they see after signing up is their own career
 * already in the tool.
 */

import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';

import { err, ok, type Result } from '@/lib/result';
import { ParsedResumeSchema } from '@/lib/aiSchemas';
import { checkEntitlement } from '@/lib/entitlements';
import { isUnlimited } from '@/lib/plans';
import { profileReadiness, type ProfileReadiness } from '@/lib/profileReadiness';
import {
    startFromParsed,
    startFromStash,
    startFromText,
    type StartOutcome,
} from '@/lib/onboarding/startFromResume';
import { SCORE_STASH_COOKIE, claimScoreStash, isStashId } from '@/lib/scoreStash';
import type { ScoreFix } from '@/lib/anonScoreSchema';
import { parseResumeText } from '@/lib/resumeParser';
import { importParsedResumeData } from '@/actions/resumeImport';
import { completeOnboarding } from '@/actions/profile';
import { prisma } from '@/lib/prisma';
import { track } from '@/lib/track';
import { isEnabled } from '@/lib/flags';
import { parseInternalPath } from '@/lib/safeNext';

const FEATURE = { feature: 'onboarding' } as const;

/** Below this there is no resume in the text, whatever the file was. */
const MIN_RESUME_CHARS = 120;

export type ImportOutcome = {
    experiences: number;
    projects: number;
    education: number;
    /** Read off the resume, so the welcome screen can name them back. */
    companies: string[];
};

/**
 * Parse already-extracted resume text and write it into the user's history.
 *
 * Takes TEXT rather than a file because the highest-value caller already has
 * it: `/score` extracted the PDF before scoring it, so asking the user to
 * upload the same document a second time would be the product forgetting
 * something it was told sixty seconds ago.
 */
export async function importResumeText(resumeText: string): Promise<Result<ImportOutcome>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const text = resumeText.trim();
    if (text.length < MIN_RESUME_CHARS) {
        return err('That does not look like a resume — there is too little text to read.', 'invalid_input');
    }

    let parsed;
    try {
        parsed = await parseResumeText(text.slice(0, 40_000), userId);
    } catch (error: unknown) {
        return err(
            error instanceof Error ? error.message : 'We could not read that resume.',
            'parse_failed',
        );
    }

    const result = await importParsedResumeData(parsed, {
        // Merge rather than overwrite: `upsertUserProfile` already skips
        // fields the user has filled in, and a first run should never clobber
        // something typed a moment earlier.
        mergeProfile: true,
        sections: { experience: true, education: true, projects: true, achievements: true },
    });
    if (!result.success) return err(result.error ?? 'Import failed', 'import_failed');

    const summary = result.summary;
    const outcome: ImportOutcome = {
        experiences: summary?.experience.created ?? 0,
        projects: summary?.projects.created ?? 0,
        education: summary?.education.created ?? 0,
        companies: parsed.experiences
            .map((item) => item.company?.trim())
            .filter((company): company is string => Boolean(company))
            .slice(0, 4),
    };

    await track(userId, 'onboarding_resume_imported', {
        ...FEATURE,
        ...outcome,
        companies: outcome.companies.length,
    });

    return ok(outcome);
}

export type WelcomeState = {
    /** Already run once. The screen redirects rather than asking again. */
    done: boolean;
    /** True when they already have history — the import step is unnecessary. */
    hasHistory: boolean;
    firstName: string;
    /** Whether to ask PRD 05 §5.3's one question. Off means skip that step. */
    missionsEnabled: boolean;
};

export async function getWelcomeState(): Promise<Result<WelcomeState>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const [profile, experiences, missionsEnabled] = await Promise.all([
        prisma.userProfile.findUnique({
            where: { userId },
            select: { onboardingComplete: true, fullName: true },
        }),
        prisma.userExperience.count({ where: { userId } }),
        isEnabled(userId, 'missions'),
    ]);

    return ok({
        done: profile?.onboardingComplete ?? false,
        hasHistory: experiences > 0,
        firstName: (profile?.fullName ?? '').trim().split(/\s+/)[0] ?? '',
        missionsEnabled,
    });
}

/**
 * Mark first run finished and say where to go.
 *
 * The destination depends on what they actually have, because landing someone
 * on an empty screen is how a good first run still fails:
 *
 *   history + missions  → Home, where the mission they just picked lives
 *   otherwise           → the dashboard, whose first-run card names the next step
 *
 * Imports do not come through here without a destination: they pass the
 * editor url of the resume they just created as `requestedNext`.
 */
export async function finishOnboarding(requestedNext?: string): Promise<Result<{ next: string }>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const done = await completeOnboarding();
    if (!done.success) return err(done.error ?? 'Could not finish setup', 'failed');

    const [experiences, missionsEnabled] = await Promise.all([
        prisma.userExperience.count({ where: { userId } }),
        isEnabled(userId, 'missions'),
    ]);

    // Where they were going before we interrupted them to set up an account.
    // "Get Career" means checkout, not the builder — the destination they
    // chose beats the one we would have picked. Re-parsed here rather than
    // trusted from the client, because a server action is a public endpoint.
    const intended = parseInternalPath(requestedNext);

    await track(userId, 'onboarding_completed', {
        ...FEATURE,
        hasHistory: experiences > 0,
        honoredIntent: intended !== null,
    });

    if (intended) return ok({ next: intended });
    // Never the builder by default: a job-description box is a dead end for
    // someone with no resume in the product yet (audit 2026-09-27, D). The
    // dashboard's first-run card names the one next step for their state.
    return ok({ next: experiences > 0 && missionsEnabled ? '/home' : '/dashboard' });
}

/** Leave without importing. Recorded, because a skip is a real signal. */
export async function skipOnboarding(requestedNext?: string): Promise<Result<{ next: string }>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');

    await track(userId, 'onboarding_skipped', FEATURE);
    return finishOnboarding(requestedNext);
}

// ═══════════════════════════════════════════ first run → a resume document

/**
 * Clear the stash cookie once it has done its job. Throws outside an action or
 * route scope (e.g. when a server component calls this), which is fine: the
 * claimed stash is bound to this user and reopening it reuses the resume.
 */
async function clearStashCookie(): Promise<void> {
    try {
        (await cookies()).delete(SCORE_STASH_COOKIE);
    } catch {
        // Not in a mutable-cookie scope.
    }
}

async function recordStart(userId: string, outcome: StartOutcome, via: 'stash' | 'text' | 'upload'): Promise<void> {
    await track(userId, 'onboarding_resume_imported', {
        ...FEATURE,
        via,
        experiences: outcome.outcome.experiences,
        projects: outcome.outcome.projects,
        education: outcome.outcome.education,
        fixes: outcome.fixes,
        reused: outcome.reused,
    });
}

/** The resume the user just checked on `/score` → history + a Resume they can open. */
export async function startOnboardingFromStash(stashId: string): Promise<Result<StartOutcome>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');
    if (!isStashId(stashId)) return err('That link is not valid.', 'invalid_input');
    const result = await startFromStash(userId, stashId);
    if (result.success) {
        await recordStart(userId, result.data, 'stash');
        await clearStashCookie();
    }
    return result;
}

/** Fallback for a handoff that only made it into this tab's sessionStorage. */
export async function startOnboardingFromText(resumeText: string, score?: number): Promise<Result<StartOutcome>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');
    if (typeof resumeText !== 'string' || resumeText.length > 60_000) return err('That is not a resume.', 'invalid_input');
    const safeScore = typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
    const result = await startFromText(userId, resumeText, safeScore);
    if (result.success) await recordStart(userId, result.data, 'text');
    return result;
}

/** An uploaded resume the client already parsed → history + a Resume. */
export async function startOnboardingFromUpload(parsed: unknown): Promise<Result<StartOutcome>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');
    const valid = ParsedResumeSchema.safeParse(parsed);
    if (!valid.success) return err('We could not read that resume.', 'invalid_input');
    const result = await startFromParsed(userId, valid.data);
    if (result.success) await recordStart(userId, result.data, 'upload');
    return result;
}

/** The fixes carried from `/score`, for the editor's checklist. Claims if unclaimed. */
export async function getScoreStashFixes(stashId: string): Promise<Result<{ fixes: ScoreFix[]; score: number }>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');
    if (!isStashId(stashId)) return err('That link is not valid.', 'invalid_input');
    const stash = await claimScoreStash(stashId, userId);
    if (!stash) return err('Those fixes are no longer available.', 'stash_missing');
    return ok({ fixes: stash.fixes, score: stash.score });
}

/** Cheap: does the profile have anything a resume could be built from? */
export async function getProfileReadinessState(): Promise<Result<ProfileReadiness>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');
    return ok(await profileReadiness(userId));
}

export type ActivationState = {
    hasHistory: boolean;
    resumes: number;
    /** Completed tailored generations, ever. */
    tailored: number;
    /** Null when the plan does not meter tailored resumes. */
    tailoredRemaining: number | null;
    tailoredLimit: number | null;
};

/** What the dashboard's first-run card needs to name ONE next step. */
export async function getActivationState(): Promise<Result<ActivationState>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');
    const [readiness, resumes, tailored, entitlement] = await Promise.all([
        profileReadiness(userId),
        prisma.resume.count({ where: { userId } }),
        prisma.generationSession.count({ where: { userId, status: 'completed' } }),
        checkEntitlement(userId, 'tailored_generation').catch(() => null),
    ]);
    const metered = entitlement && !isUnlimited(entitlement.limit);
    return ok({
        hasHistory: readiness.hasHistory,
        resumes,
        tailored,
        tailoredRemaining: metered ? entitlement!.remaining : null,
        tailoredLimit: metered ? entitlement!.limit : null,
    });
}
