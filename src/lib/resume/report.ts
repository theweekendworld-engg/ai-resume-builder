/**
 * The gap report, as it is stored and as the editor reads it.
 *
 * `tailorResume` computes all of this and, until now, threw it away — the
 * generation returned coverage, advice, skill gaps and dropped lines, and
 * nothing persisted or rendered any of it. The most useful output of the
 * rebuild was invisible to the person it was about.
 *
 * ── Why it lives on the Resume row ──────────────────────────────────────────
 *
 * It is a fact about THIS document against THAT posting, and it has to outlive
 * the GenerationSession that produced it. The editor is where a candidate acts
 * on a gap — days later, from a link, long after the session is history.
 *
 * ── Why it is flattened here ────────────────────────────────────────────────
 *
 * The in-memory report holds `JobRequirement` objects with ids that only mean
 * anything inside one generation run, and `ScoredBullet`s carrying strength
 * scores nobody should see. What a candidate needs is the posting's sentence
 * and whether it is answered. Persisting the internal shape would leak run-
 * local ids into a column read months later, and would tie a stored row to a
 * type that is free to change.
 */

import { z } from 'zod';

import { reconcileSkillGaps, type CoverageReport } from './coverage';
import type { PostingBrief } from './posting';
import type { TailorResult } from './tailor';

/** One thing the employer asked for, and whether the resume answers it. */
export const CoverageItemSchema = z.object({
    text: z.string(),
    kind: z.enum(['must', 'nice']),
    /**
     * True when the resume's DATE RANGE answers it rather than any line —
     * "6+ years building backend systems". The editor says so, because
     * "answered" with nothing to point at reads like a bug.
     */
    byDates: z.boolean(),
});

export const DroppedLineSchema = z.object({
    text: z.string(),
    reason: z.enum(['cap', 'weak']),
    /** The experience or project row it came from, so it can be put back. */
    targetId: z.string(),
    targetKind: z.enum(['experience', 'project']),
    targetLabel: z.string(),
});

export const ResumeCoverageSchema = z.object({
    version: z.literal(1),
    role: z.string(),
    company: z.string(),
    /** Null when the posting yielded no requirements — see `computeCoverage`. */
    score: z.number().nullable(),
    mustScore: z.number().nullable(),
    answered: z.array(CoverageItemSchema),
    unanswered: z.array(CoverageItemSchema),
    /** Wanted by the posting, unevidenced, therefore left off the document. */
    skillGaps: z.array(z.string()),
    dropped: z.array(DroppedLineSchema),
    advice: z.array(z.string()),
    generatedAt: z.string(),
});

export type ResumeCoverage = z.infer<typeof ResumeCoverageSchema>;
export type CoverageItem = z.infer<typeof CoverageItemSchema>;
export type DroppedLine = z.infer<typeof DroppedLineSchema>;

export function buildReport(
    result: Pick<TailorResult, 'coverage' | 'skillGaps' | 'advice' | 'dropped'> & {
        brief: Pick<PostingBrief, 'role' | 'company'>;
    },
    now: Date = new Date(),
): ResumeCoverage {
    const toItem = (
        requirement: { text: string; kind: 'must' | 'nice' },
        byDates: boolean,
    ): CoverageItem => ({ text: requirement.text, kind: requirement.kind, byDates });

    const answered: CoverageItem[] = result.coverage.answered.map((entry) =>
        // No bullet ids means nothing on the page states it and the dates
        // carry it. `computeCoverage` is the only thing that produces that.
        toItem(entry.requirement, entry.bulletIds.length === 0),
    );
    const unanswered: CoverageItem[] = result.coverage.unanswered.map((requirement) =>
        toItem(requirement, false),
    );

    return {
        version: 1,
        role: result.brief.role,
        company: result.brief.company,
        score: result.coverage.score,
        mustScore: result.coverage.mustScore,
        answered,
        unanswered,
        // Only the gaps that add something — see `reconcileSkillGaps`.
        skillGaps: reconcileSkillGaps(result.skillGaps, [...answered, ...unanswered]),
        dropped: result.dropped.map((line) => ({
            text: line.text,
            reason: line.reason,
            targetId: line.targetId,
            targetKind: line.targetKind,
            targetLabel: line.targetLabel,
        })),
        advice: [...result.advice],
        generatedAt: now.toISOString(),
    };
}

/**
 * Read a stored report back.
 *
 * Returns null rather than throwing on anything unrecognised. A resume
 * generated before this column existed, or by v1, simply has no report — and
 * a panel that cannot render is a panel that hides, not one that breaks the
 * editor around it.
 */
export function parseReport(value: unknown): ResumeCoverage | null {
    const parsed = ResumeCoverageSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

/** Everything still missing, musts first. What the panel leads with. */
export function openItems(report: ResumeCoverage): CoverageItem[] {
    return [...report.unanswered].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'must' ? -1 : 1;
        return 0;
    });
}

/**
 * A one-line verdict for the panel header.
 *
 * Deliberately unenthusiastic. A candidate at 60% does not need "Great work!",
 * and a candidate at 95% does not need congratulating by a tool — they need to
 * know whether to send it.
 */
export function verdict(report: ResumeCoverage): string {
    if (report.score === null) return 'We could not read requirements out of this posting.';

    const missingMusts = report.unanswered.filter((item) => item.kind === 'must').length;
    if (missingMusts === 0) return 'Every stated requirement is answered.';
    if (missingMusts === 1) return '1 stated requirement is unanswered.';
    return `${missingMusts} stated requirements are unanswered.`;
}
