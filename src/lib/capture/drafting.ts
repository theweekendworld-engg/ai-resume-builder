/**
 * Signal → Win draft — PRD 02 §4.2.
 *
 * This is the highest-risk fabrication surface in the entire product: it is
 * where a made-up number would reach a real resume. Three mechanisms stand
 * between the model and the record, and none of them is the prompt:
 *
 *   1. **The grounding source is narrower than the model input.** The model is
 *      told the file counts and the merge date because they help it judge
 *      significance, but the numeric guard's source text is ONLY the PR title,
 *      body and linked issue (plus the review body for `pr_reviewed`). So a
 *      draft that says "across 7 files" is stripped even though 7 was in the
 *      prompt. That asymmetry is deliberate and it is what makes the §12 launch
 *      gate ("zero drafted Wins contain a number absent from the PR title, body
 *      or linked issue") mean exactly what it says.
 *   2. **`generateStructured`'s guard** runs the corrective retry and then
 *      strips (ADR-6). We do not re-ask nicely.
 *   3. **`sanitizeCaptureDraft`** resolves the post-strip wreckage downward: a
 *      metric with its figure removed becomes no metric at all, never a
 *      half-populated one.
 *
 * Confidence is NOT in the schema. It is computed by `confidence.ts` from the
 * §4.3 formula, because a model's self-reported confidence tracks fluency
 * rather than significance and would rank the digest badly.
 */

import { z } from 'zod';
import { WinCategory, WinSensitivity } from '@prisma/client';
import { generateStructured, type StructuredUsage } from '@/lib/ai/structured';
import { checkNumericGuard, extractQuantities, type GuardViolation } from '@/lib/ai/guard';
import { WinDraftSchema } from '@/services/winDrafting';
import { scoreConfidence, type ConfidenceBreakdown } from './confidence';
import { parseGithubMetadata, type GithubSignalMetadata } from './github/types';
import type { RawSignal, SignalGroup } from './types';

// ═══════════════════════════════════════════════════════════════ the schema

/**
 * The §01 §8.1 draft schema minus what capture already knows.
 *
 * `occurredAtHint`/`explicitDate` are dropped because the merge date is a fact,
 * not a guess. `confidence` is dropped because we compute it. `shouldDraft` and
 * `dismissReason` are added per §4.2 — the model's most useful output on a thin
 * PR is "this is not a Win", and we want that in a field rather than inferred
 * from a low score.
 */
export const CaptureDraftSchema = WinDraftSchema.omit({
    occurredAtHint: true,
    explicitDate: true,
    confidence: true,
}).extend({
    shouldDraft: z.boolean(),
    dismissReason: z.string().nullable(),
});

export type CaptureDraft = z.infer<typeof CaptureDraftSchema>;

// ═══════════════════════════════════════════════════════════════ the prompt

export const CAPTURE_DRAFT_SYSTEM = [
    'You turn one merged pull request, code review, or closed issue into a single structured "Win"',
    'for a working professional\'s private career record. You are not writing marketing copy and you',
    'are not writing a changelog. You are writing the one sentence this person would say in a',
    'performance review, and it has to be true.',
    '',
    'THE RULES. Breaking any one of them makes the output unusable.',
    '',
    '1. ONLY USE WHAT IS IN THE PULL REQUEST. If the description is empty and the title is "fix",',
    '   set shouldDraft=false with dismissReason="no context". We do not manufacture significance.',
    '2. READ THE "SO WHAT" FROM THE LINKED ISSUE when the PR body is thin. That is where the user',
    '   impact usually lives — "checkout times out during peak" is the reason the work mattered.',
    '3. NUMBERS MAY ONLY COME FROM THE TEXT. A PR titled "reduce latency" with no measurement',
    '   produces quantified=false and a quantifyPrompt — never an invented percentage. Do not',
    '   compute, infer, round or derive a figure from other figures. A percentage calculated from',
    '   two stated numbers is still a fabricated number. Do not quote the file, addition or',
    '   deletion counts you were given: they describe the diff, not the outcome.',
    '4. A REVIEW (role: reviewer) IS ALWAYS category "influenced", and the narrative must quote the',
    '   substance of what you actually argued. If the review said only "LGTM", set shouldDraft=false',
    '   with dismissReason="no substance".',
    '5. IF suggestedSensitivity IS "confidential", THE TITLE MUST STAY GENERIC. Never put a private',
    '   repo\'s customer names, unreleased product names or incident specifics in the title; those',
    '   belong in the narrative, which is never shared outside the record.',
    '6. The title is a factual statement, not a brag. Never "successfully", "spearheaded",',
    '   "leveraged", "utilized", "world-class", "robust". Say what happened, in the past tense.',
    '7. quantifyPrompt must be answerable in under five words ("How much faster?"). Set it only when',
    '   quantified is false; otherwise null.',
    '',
    'CATEGORY — pick exactly one:',
    '  shipped    — delivered something new that users or systems now depend on',
    '  improved   — made an existing thing measurably better',
    '  fixed      — resolved an incident, bug or risk',
    '  led        — owned a project, drove a decision, ran a process',
    '  influenced — changed what someone else did (review, design doc, mentoring, cross-team)',
    '  grew       — developed a person or the team',
    '  learned    — acquired a skill or domain that expanded your range',
    '  saved      — reduced cost, time or headcount need',
    'Resolve ties toward the RARER category: `influenced` beats `shipped`.',
    '',
    'SENSITIVITY — propose, never decide. `internal_only` for internal metrics or org detail,',
    '`confidential` for unreleased product, security incidents, personnel matters or named clients,',
    '`shareable` otherwise. A private repo is a strong hint, not a verdict. The user always wins.',
    '',
    'SKILLS are technologies and practices evidenced by the work, at most eight, no version numbers.',
    'COLLABORATORS are people named in the text. Never invent a name and never guess a team.',
].join('\n');

// ═══════════════════════════════════════════════════════ candidate context

export type CandidateContext = {
    group: SignalGroup;
    /** "Senior Backend Engineer at Acme", or null if we do not know yet. */
    roleContext: string | null;
    /** Every signal's provider metadata, aligned with `group.signals`. */
    metadata: GithubSignalMetadata[];
    primaryMetadata: GithubSignalMetadata;
};

export function buildCandidateContext(group: SignalGroup, roleContext: string | null): CandidateContext {
    const metadata = group.signals.map((signal) => parseGithubMetadata(signal.metadata));
    return {
        group,
        roleContext,
        metadata,
        primaryMetadata: parseGithubMetadata(group.primary.metadata),
    };
}

/**
 * THE grounding source. Everything a number in the output is allowed to come
 * from, and nothing else.
 *
 * Note the exclusions, each of which is a number the model can see but may not
 * use: file counts, addition/deletion counts, review-comment counts, the PR
 * number, and the merge date. They are context for judgement, not evidence for
 * a claim.
 */
export function groundingSource(context: CandidateContext): string {
    const parts: string[] = [];
    for (const [index, signal] of context.group.signals.entries()) {
        const meta = context.metadata[index];
        parts.push(signal.title, signal.body);
        if (meta.linkedIssue) parts.push(meta.linkedIssue.title, meta.linkedIssue.body);
        if (meta.role === 'reviewer' && meta.reviewBody) parts.push(meta.reviewBody);
    }
    return parts.filter((part) => part && part.trim()).join('\n\n');
}

function formatSignalBlock(signal: RawSignal, meta: GithubSignalMetadata, index: number, total: number): string {
    const lines: string[] = [];
    if (total > 1) lines.push(`--- part ${index + 1} of ${total} ---`);
    lines.push(`repo: ${meta.repo || 'unknown'} (${meta.repoPrivate ? 'private' : 'public'})`);
    lines.push(`role: ${meta.role}`);
    lines.push(`title: ${JSON.stringify(signal.title)}`);
    lines.push(`body: ${signal.body ? signal.body : '(empty)'}`);
    if (meta.labels.length > 0) lines.push(`labels: [${meta.labels.join(', ')}]`);
    lines.push(`${signal.kind === 'issue_closed' ? 'closed' : 'merged'}: ${signal.occurredAt.toISOString().slice(0, 10)}`);
    if (meta.filesChanged > 0 || meta.additions > 0 || meta.deletions > 0) {
        lines.push(
            `files_changed: ${meta.filesChanged}    additions: ${meta.additions}    deletions: ${meta.deletions}`,
        );
    }
    if (meta.linkedIssue) {
        lines.push(`linked_issue: ${JSON.stringify(meta.linkedIssue.title)} (#${meta.linkedIssue.number})`);
        if (meta.linkedIssue.body) lines.push(`linked_issue_body: ${meta.linkedIssue.body}`);
    }
    if (meta.role === 'reviewer') {
        lines.push(`review_state: ${meta.reviewState ?? 'COMMENTED'}`);
        lines.push(`your_review: ${meta.reviewBody || '(empty)'}`);
    }
    if (meta.reviewCommentsByOthers > 0) {
        lines.push(`review_comments_by_others: ${meta.reviewCommentsByOthers}`);
    }
    return lines.join('\n');
}

export function buildDraftPrompt(context: CandidateContext): string {
    const total = context.group.signals.length;
    const blocks = context.group.signals.map((signal, index) =>
        formatSignalBlock(signal, context.metadata[index], index, total),
    );

    const preamble =
        total > 1
            ? [
                  `These ${total} pull requests are one effort: same repository, same area of the code,`,
                  'landed within a few days of each other. Draft ONE Win describing the effort as a whole,',
                  'not a list of the parts.',
                  '',
              ].join('\n')
            : '';

    return [
        preamble,
        context.roleContext ? `The person who did this work: ${context.roleContext}\n` : '',
        blocks.join('\n\n'),
        '',
        'Every number you write must appear in a title, a body, or a linked issue above.',
        'The file, addition, deletion and comment counts are NOT usable as evidence — they describe',
        'the size of the change, not its outcome.',
    ]
        .filter((part) => part !== '')
        .join('\n');
}

// ═══════════════════════════════════════════════════════════ post-processing

/** Numeric runs in the text that the source does not justify. */
function unsupportedNumbers(text: string, sourceText: string): string[] {
    const check = checkNumericGuard({ value: text }, { sourceText, fields: ['value'] });
    return check.violations.map((violation) => violation.quantity.raw);
}

/**
 * Skills are not guarded at model time — stripping the whole entry would turn
 * "React 18" into nothing when the honest answer is "React". So the version
 * gets removed and the skill survives.
 */
export function sanitizeSkills(skills: readonly string[], sourceText: string): string[] {
    const out: string[] = [];
    for (const raw of skills) {
        const skill = raw.trim();
        if (!skill) continue;
        if (unsupportedNumbers(skill, sourceText).length === 0) {
            out.push(skill);
            continue;
        }
        const stripped = skill.replace(/\s*v?\d[\d.,]*\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
        if (stripped.length >= 2) out.push(stripped);
    }
    return [...new Set(out)].slice(0, 8);
}

const BRAG_WORDS =
    /\b(successfully|spearhead(?:ed)?|leverag(?:e|ed|ing)|utiliz(?:e|ed|ing)|world-class|best-in-class|cutting-edge|robustly|seamlessly)\b/gi;

function stripBragWords(text: string): string {
    return text.replace(BRAG_WORDS, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').trim();
}

export type SanitizedDraft = CaptureDraft & { confidence: number };

/**
 * Resolve the model's output — and whatever the guard left of it — downward
 * into something that is true.
 *
 * Fail-closed everywhere: a blanked title means no draft, a stripped impact
 * means `quantified: false`, a review with nothing quotable means no draft.
 */
export function sanitizeCaptureDraft(params: {
    draft: CaptureDraft;
    context: CandidateContext;
    sourceText: string;
    violations: GuardViolation[];
    confidence: number;
}): SanitizedDraft | { rejected: true; reason: string } {
    const draft: CaptureDraft = { ...params.draft };
    const violatedFields = new Set(params.violations.map((violation) => violation.field));

    if (!draft.shouldDraft) {
        return { rejected: true, reason: draft.dismissReason?.trim() || 'model declined' };
    }

    draft.title = stripBragWords(draft.title ?? '');
    draft.narrative = stripBragWords(draft.narrative ?? '');

    // The guard blanks a title it could not fix. A Win with no title is not a
    // degraded Win, it is not a Win.
    if (!draft.title.trim()) return { rejected: true, reason: 'title did not survive the numeric guard' };

    // Rule 4: a review must quote substance. If the guard or the model left the
    // narrative empty there is nothing quoted, so there is nothing to confirm.
    if (params.context.primaryMetadata.role === 'reviewer' && draft.narrative.trim().length < 40) {
        return { rejected: true, reason: 'review narrative quotes no substance' };
    }

    if (violatedFields.has('impact') || !draft.impact || !draft.impact.metric.trim()) {
        draft.impact = null;
    }
    draft.quantified = draft.impact !== null;
    if (draft.quantified) {
        draft.quantifyPrompt = null;
    } else if (!draft.quantifyPrompt?.trim()) {
        draft.quantifyPrompt = 'What changed, in numbers?';
    }

    // Rule 5: a confidential Win keeps its specifics out of the title.
    if (draft.suggestedSensitivity === WinSensitivity.confidential) {
        draft.title = genericizeTitle(draft.title, params.context);
    }

    draft.skills = sanitizeSkills(draft.skills ?? [], params.sourceText);
    draft.collaborators = (draft.collaborators ?? []).map((name) => name.trim()).filter(Boolean).slice(0, 6);
    draft.category = normalizeCategory(draft.category, params.context);

    return { ...draft, confidence: params.confidence };
}

/**
 * §4.2 rule 5, enforced rather than requested. The narrative keeps the detail;
 * the title loses anything that looks like a proper noun we did not already
 * know about, because the title is the string that ends up in a shared packet.
 */
export function genericizeTitle(title: string, context: CandidateContext): string {
    const repoWords = new Set(
        context.primaryMetadata.repo
            .split(/[/\-_]/)
            .map((word) => word.toLowerCase())
            .filter(Boolean),
    );
    const words = title.split(/\s+/);
    const cleaned = words.filter((word, index) => {
        if (index === 0) return true; // sentence-initial capital is not a proper noun
        const bare = word.replace(/[^\p{L}\p{Nd}]/gu, '');
        if (!bare || bare.length < 3) return true;
        if (!/^\p{Lu}/u.test(bare)) return true;
        return !repoWords.has(bare.toLowerCase());
    });
    const result = cleaned.join(' ').replace(/\s{2,}/g, ' ').trim();
    return result || title;
}

/** A review is `influenced`, always (§4.2 rule 4). */
function normalizeCategory(category: WinCategory, context: CandidateContext): WinCategory {
    if (context.primaryMetadata.role === 'reviewer') return WinCategory.influenced;
    return category;
}

// ═══════════════════════════════════════════════════════════════ the call

export type DraftOutcome =
    | { drafted: true; draft: SanitizedDraft; usage: StructuredUsage; degraded: boolean; violations: GuardViolation[] }
    | { drafted: false; reason: string; usage: StructuredUsage | null; degraded: boolean };

/** Facts the confidence formula reads, assembled from the whole group. */
export function confidenceFactsFor(context: CandidateContext): Parameters<typeof scoreConfidence>[0] {
    const bodies = context.group.signals.map((signal) => signal.body).join('\n');
    const linked = context.metadata
        .map((meta) => (meta.linkedIssue ? `${meta.linkedIssue.title}\n${meta.linkedIssue.body}` : ''))
        .filter(Boolean)
        .join('\n');
    const reviewBodies = context.metadata.map((meta) => meta.reviewBody).filter(Boolean).join('\n');

    return {
        title: context.group.primary.title,
        // A review's substance lives in the review, not in someone else's PR body.
        body: context.primaryMetadata.role === 'reviewer' ? `${reviewBodies}\n${bodies}` : bodies,
        linkedIssueText: linked || null,
        labels: context.metadata.flatMap((meta) => meta.labels),
        filesChanged: Math.max(...context.metadata.map((meta) => meta.filesChanged), 0),
        reviewCommentsByOthers: Math.max(...context.metadata.map((meta) => meta.reviewCommentsByOthers), 0),
    };
}

export function scoreCandidate(context: CandidateContext): ConfidenceBreakdown {
    return scoreConfidence(confidenceFactsFor(context));
}

/**
 * One candidate, one model call (plus whatever corrective retries the guard
 * demands). Never throws for an expected outcome — a candidate the model
 * declines is a `drafted: false`, not an exception, because a single bad PR
 * must not fail the run that carries the other thirty-nine.
 */
export async function draftCandidate(params: {
    userId: string;
    context: CandidateContext;
    confidence: number;
    sessionId?: string;
}): Promise<DraftOutcome> {
    const sourceText = groundingSource(params.context);

    // Rule 1, applied before we spend anything: no words, no Win.
    if (sourceText.replace(/\s+/g, ' ').trim().length < 12) {
        return { drafted: false, reason: 'no context', usage: null, degraded: false };
    }

    let result;
    try {
        result = await generateStructured({
            task: 'winDraft',
            feature: 'github_capture',
            userId: params.userId,
            schema: CaptureDraftSchema,
            system: CAPTURE_DRAFT_SYSTEM,
            prompt: buildDraftPrompt(params.context),
            // The narrower-than-the-prompt source. See the file header.
            guard: { sourceText, fields: ['title', 'narrative', 'impact'] },
            sessionId: params.sessionId,
        });
    } catch (error: unknown) {
        return {
            drafted: false,
            reason: error instanceof Error ? error.message : 'model call failed',
            usage: null,
            degraded: false,
        };
    }

    const sanitized = sanitizeCaptureDraft({
        draft: result.data,
        context: params.context,
        sourceText,
        violations: result.guardViolations,
        confidence: params.confidence,
    });

    if ('rejected' in sanitized) {
        return { drafted: false, reason: sanitized.reason, usage: result.usage, degraded: result.degraded };
    }

    return {
        drafted: true,
        draft: sanitized,
        usage: result.usage,
        degraded: result.degraded,
        violations: result.guardViolations,
    };
}

// ═══════════════════════════════════════════════════════════ the audit check

/**
 * The §12 launch gate, as a function.
 *
 * Runs over the *assembled* draft rather than the model response, so it also
 * catches anything the sanitizers introduced. Used by the eval harness and
 * asserted in the drafting integration test; cheap enough to keep on in
 * production as a last line of defence.
 */
export function auditDraftQuantities(draft: SanitizedDraft, sourceText: string): GuardViolation[] {
    const subject = {
        title: draft.title,
        narrative: draft.narrative,
        impact: draft.impact,
        skills: draft.skills,
    };
    return checkNumericGuard(subject, { sourceText, fields: ['title', 'narrative', 'impact', 'skills'] })
        .violations;
}

/** True when the text carries any figure at all. Used by the eval harness. */
export function hasAnyQuantity(text: string): boolean {
    return extractQuantities(text ?? '', 'strict').length > 0;
}
