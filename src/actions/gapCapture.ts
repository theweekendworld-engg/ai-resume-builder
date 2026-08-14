'use server';

/**
 * Turning a gap into evidence.
 *
 * ── The loop this closes ────────────────────────────────────────────────────
 *
 * The whole product thesis is that the Work Log feeds everything else. Every
 * surface reads from it — the resume, the packet, the readiness verdict, the
 * Month in Review. Exactly one thing wrote back into it: capture.
 *
 * Which left the most valuable moment in the product doing nothing. The gap
 * report says, in the employer's own words, "Nothing on your resume answers:
 * 'Experience mentoring engineers'" — to a person who is looking straight at
 * it, who very often HAS done that thing, and who has no way to say so. The
 * insight is generated, shown, and thrown away. Next month the same posting
 * produces the same gap.
 *
 * This is the write-back. A gap becomes a question, the answer becomes a Win,
 * and the next generation can use it. That is the one place the resume feeds
 * the log rather than only reading it, and it is what turns a job search into
 * a reason the record gets better.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 *
 * It does not add anything to the current resume. The Win lands as a DRAFT and
 * has to be confirmed in the log like any other, because `Evidence
 * (confirmedByUser)` is the moat write and a resume gap is not consent. The
 * honest sequence is: you tell us, you confirm it, and the NEXT resume can use
 * it — not "we wrote it onto your resume because you typed something".
 */

import { auth } from '@clerk/nextjs/server';

import { err, ok, type Result } from '@/lib/result';
import { createWinFromText } from '@/actions/wins';
import { track } from '@/lib/track';

const FEATURE = { feature: 'work_log' } as const;

/** Below this there is no story in the answer, only agreement. */
const MIN_ANSWER_CHARS = 25;
const MAX_ANSWER_CHARS = 4_000;
const MAX_REQUIREMENT_CHARS = 500;

export type GapCaptureResult = {
    winId: string;
    title: string;
    /** Always true. Stated so the caller cannot imply the resume changed. */
    needsConfirmation: true;
};


/**
 * Record an answer to a gap as a draft Win.
 *
 * The requirement travels into the Win's text as context so the structuring
 * model has the frame the answer was written against — without it, a two-line
 * answer to "mentor engineers" reads as an orphan sentence and structures
 * badly.
 */
export async function captureEvidenceForGap(input: {
    requirement: string;
    answer: string;
    /** Where the gap was found. Stored as the Win's source reference. */
    resumeId?: string;
}): Promise<Result<GapCaptureResult>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const requirement = (input.requirement ?? '').trim().slice(0, MAX_REQUIREMENT_CHARS);
    const answer = (input.answer ?? '').trim().slice(0, MAX_ANSWER_CHARS);

    if (!requirement) return err('No requirement given', 'invalid_input');
    if (answer.length < MIN_ANSWER_CHARS) {
        return err(
            'Tell us a bit more — what you did and what changed. A line or two is enough.',
            'invalid_input',
        );
    }

    const result = await createWinFromText({
        // The requirement first, as context; the candidate's own words second.
        // The structuring model reads both, and every figure it may keep comes
        // from the answer, which the numeric guard enforces.
        text: `Context — a job posting asked for: ${requirement}\n\nWhat I actually did:\n${answer}`,
        source: 'manual',
        sourceRef: input.resumeId ? `resume:${input.resumeId}` : 'resume-gap',
    });

    if (!result.success) return err(result.error, result.code);

    await track(userId, 'win_drafted', {
        ...FEATURE,
        origin: 'resume_gap',
        requirementChars: requirement.length,
        answerChars: answer.length,
    });

    return ok({
        winId: result.data.id,
        title: result.data.title,
        needsConfirmation: true,
    });
}

/**
 * Record that a gap was dismissed.
 *
 * A skip is a real signal and the cheapest one we will ever get: it is a
 * candidate telling us, at the moment of maximum context, that this
 * requirement is not something they have. Worth knowing, and worth NOT asking
 * again in the same breath.
 */
export async function dismissGap(input: { requirement: string }): Promise<Result<null>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const requirement = (input.requirement ?? '').trim().slice(0, MAX_REQUIREMENT_CHARS);
    if (!requirement) return err('No requirement given', 'invalid_input');

    await track(userId, 'win_dismissed', {
        ...FEATURE,
        origin: 'resume_gap',
        reason: 'not_mine',
    });

    return ok(null);
}
