import { assembleResume } from '@/lib/ai/resumeLoop';
import { computeCoverage, gapAdvice, reconcileSkillGaps } from '@/lib/resume/coverage';
import { readPosting } from '@/lib/resume/posting';
import { resumeFromDraft } from '@/lib/resume/fromDraft';
import { getContactCard, listRoles } from '@/lib/resume/tools/evidence';
import { prisma } from '@/lib/prisma';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import type { TailorInput, TailorResult } from './tailor.types';

/**
 * The loop, wearing the shape the old pipeline returned.
 *
 * ── Why an adapter rather than a rewrite of the call site ───────────────────
 *
 * `generateResume.ts` consumes six fields off a `TailorResult` and threads them
 * into the coverage report, the gap panel, the dropped-lines UI, the claim
 * validator and the session record. Swapping the generator AND all of that at
 * once would be one commit where a failure could be in either half. Keeping the
 * return shape means exactly one thing changes: what produced it.
 *
 * ── What is genuinely different ────────────────────────────────────────────
 *
 * `dropped` is empty and will stay empty. The pipeline built a page by writing
 * every candidate line and then cutting to fit, so it could hand back what it
 * cut. The loop selects before it writes — a line that does not earn space is
 * never written, so there is nothing to hand back. That is a better way to
 * build a resume and a real loss for the "put it back" affordance in the gap
 * panel, which now simply has nothing to show. Restoring it means asking the
 * loop to report what it considered and declined; worth doing, not worth
 * blocking the swap on.
 *
 * Most of `TailorInput` is ignored. The loop fetches its own evidence through
 * tools rather than being handed a pre-selected slice, which is the entire
 * point — the caller's `experiences`, `projects` and `caps` were the fixed
 * context window that made the pipeline brittle.
 */

export async function tailorViaLoop(input: TailorInput): Promise<TailorResult> {
    const { userId, jobDescription, sessionId } = input;

    // The posting is read FIRST now, so its requirement ids can travel into the
    // prompt and come back attached to bullets. Coverage matches strictly on
    // `answers.includes(requirementId)` with no text fallback — an untagged
    // bullet scores zero however good it is, which is exactly what shipped
    // before this.
    const { brief } = await readPosting({ jobDescription, userId, sessionId });

    const [assembly, contact, roles, profile] = await Promise.all([
        assembleResume({
            userId,
            jobDescription,
            requirements: brief.requirements.map((r) => ({ id: r.id, text: r.text })),
        }),
        getContactCard(userId),
        listRoles(userId),
        prisma.userProfile.findUnique({ where: { userId }, select: { preferences: true } }),
    ]);

    const preferences = parseUserGenerationPreferences(profile?.preferences);

    const checked = resumeFromDraft({
        draft: assembly.draft,
        contact,
        availableRoles: roles.length,
        sectionOrder: preferences.defaultSectionOrder,
    });

    if (!checked.ok) {
        // Throwing hands control to the caller's existing catch, which logs and
        // falls back. A guard rejection must never become a stored resume.
        throw new Error(`Assembly rejected: ${checked.reason.detail}`);
    }

    const resume = checked.resume;

    // Re-pair each stored line with the tags the model gave it. Matching on text
    // rather than index because the guard may have dropped a bullet between the
    // draft and the resume, and a positional join would then attribute one
    // line's requirements to another.
    const tagsByText = new Map<string, string[]>();
    for (const role of assembly.draft.experience) {
        for (const bullet of role.bullets) tagsByText.set(bullet.text.trim(), bullet.answers);
    }

    const bullets = resume.experience.flatMap((role) =>
        role.description
            .split('\n')
            .map((text) => text.trim())
            .filter(Boolean)
            .map((text, index) => ({
                id: `${role.id}:${index}`,
                groupId: role.id,
                text,
                answers: tagsByText.get(text) ?? [],
                // Uniform: the loop already declined to write anything weak, so
                // ranking the survivors against each other would invent a signal.
                strength: 3,
            })),
    );

    const coverage = computeCoverage(brief.requirements, bullets);

    // Skill gaps are what the posting named and the resume does not carry.
    // `brief.skills` is the posting's own vocabulary, already extracted by
    // readPosting; matching it against the resume rather than against the
    // record is deliberate — a skill the candidate has but chose not to show
    // here is not a gap, it is an editorial decision.
    const skillGaps = reconcileSkillGaps(
        (brief.skills ?? []).filter(
            (skill) =>
                !resume.skills.some(
                    (owned) => owned.toLowerCase() === skill.toLowerCase(),
                ),
        ),
        [
            ...coverage.answered.map((entry) => entry.requirement),
            ...coverage.unanswered,
        ],
    );

    return {
        resume,
        brief,
        coverage,
        skillGaps,
        advice: gapAdvice(coverage, skillGaps),
        // See the note above: selection happens before writing, so nothing was cut.
        dropped: [],
    };
}
