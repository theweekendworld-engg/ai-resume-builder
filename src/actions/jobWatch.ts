'use server';

/**
 * Job watch server actions (docs/prd/12-job-watch.md).
 *
 * Convention order: Clerk `auth()` → flag → zod → work → `Result`. Nothing
 * here is metered: watching is capped by plan in the service, and the
 * expensive step (scoring) runs in the nightly job against a per-plan budget.
 * "Full analysis and outreach" starts a Scout run, which meters itself.
 */

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { isEnabled } from '@/lib/flags';
import { kickQueue } from '@/lib/jobs/kick';
import { buildDedupeKey, enqueue } from '@/lib/jobs/runner';
import { err, ok, type Result } from '@/lib/result';
import {
    addWatchedCompany,
    dismissMatch,
    listMatches,
    listWatchedCompanies,
    removeWatchedCompany,
    trackMatch,
    type MatchView,
    type WatchedCompanyView,
} from '@/services/jobWatch';

export type { MatchView, WatchedCompanyView };

type Gate = { userId: string } | { error: Result<never> };

async function gateSurface(): Promise<Gate> {
    const { userId } = await auth();
    if (!userId) return { error: err('Not signed in', 'unauthenticated') };
    if (!(await isEnabled(userId, 'job_watch'))) return { error: err('Job watch is not available yet', 'not_available') };
    return { userId };
}

function invalidInput(error: z.ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
}

const IdSchema = z.string().min(1).max(64);

const AddSchema = z.object({
    companyName: z.string().trim().min(1).max(120),
    /** Any job link from the company's board: the reliable fallback when the name does not resolve. */
    careersUrl: z.string().trim().url().max(2_000).optional().or(z.literal('').transform(() => undefined)),
});

export async function addWatch(input: z.input<typeof AddSchema>): Promise<Result<{ company: WatchedCompanyView; note: string | null }>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = AddSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');
    return addWatchedCompany(gate.userId, parsed.data);
}

export async function removeWatch(id: string): Promise<Result<{ removed: boolean }>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = IdSchema.safeParse(id);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');
    return removeWatchedCompany(gate.userId, parsed.data);
}

export async function getWatchedCompanies(): Promise<Result<WatchedCompanyView[]>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    return ok(await listWatchedCompanies(gate.userId));
}

const ViewSchema = z.enum(['qualified', 'held', 'passed']);

export async function getMatches(view: z.input<typeof ViewSchema>): Promise<Result<MatchView[]>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = ViewSchema.safeParse(view);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');
    return ok(await listMatches(gate.userId, parsed.data));
}

export async function passOnMatch(matchId: string): Promise<Result<{ dismissed: boolean }>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = IdSchema.safeParse(matchId);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');
    return dismissMatch(gate.userId, parsed.data);
}

export async function trackWatchMatch(matchId: string): Promise<Result<{ workspaceId: string }>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const parsed = IdSchema.safeParse(matchId);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');
    return trackMatch(gate.userId, parsed.data);
}

/**
 * Run tonight's watch now, for this user only. Dedupe-keyed to the hour, so a
 * user hammering the button costs one run; the nightly run is a separate key
 * and still happens.
 */
export async function runWatchNow(): Promise<Result<{ queued: boolean }>> {
    const gate = await gateSurface();
    if ('error' in gate) return gate.error;
    const hour = new Date().toISOString().slice(0, 13);
    const { deduped } = await enqueue('job_watch', { userId: gate.userId }, { dedupeKey: buildDedupeKey('job_watch', [gate.userId, 'now', hour]) });
    await kickQueue('job_watch_now');
    return ok({ queued: !deduped });
}
