import type { UserGenerationPreferences } from '@/lib/userPreferences';
import type { CoverageItem, DroppedLine } from './report';

/**
 * What a user's defaults cost them on this particular posting.
 *
 * ── Why flag rather than override ───────────────────────────────────────────
 *
 * A resume tool that quietly ignores the length you chose, because it decided
 * the posting knew better, is a tool you cannot trust with the rest. The
 * preference wins, always. This makes the price visible so the choice is
 * informed rather than blind.
 *
 * ── Ground truth, not inference ─────────────────────────────────────────────
 *
 * An earlier version of this compared counts — roles available against roles
 * the cap allowed — and inferred the cost. It did not need to. Generation
 * already records `dropped` (every line cut, with `reason: 'cap' | 'weak'`)
 * and, better, `answeredByCut`: requirements this posting listed that ARE
 * answered by a line the cap removed.
 *
 * That second one is the whole argument. "Your one-page limit cut 3 lines" is
 * a fact about formatting. "Your one-page limit cut 3 lines that answered what
 * this employer asked for" is a fact about whether they get the interview, and
 * it is already computed and stored. Deriving it from counts would have been a
 * worse estimate of something we can simply read.
 *
 * ── The honesty constraint ──────────────────────────────────────────────────
 *
 * Nothing here is inferred from a model's read of the posting. There is
 * deliberately no tone conflict: "this posting emphasises outcomes, so your
 * formal voice understates you" needs a judgement no record supports, and a
 * plausible-sounding warning that turns out to be noise costs more trust than
 * the warning was worth. It returns when there is a measurement behind it.
 */

export type PreferenceConflict = {
    /** Which stored preference is responsible. */
    preference: 'targetLength' | 'maxProjects';
    /** One line, in the user's terms, naming the cost. */
    summary: string;
    /**
     * Requirements this posting listed that a cut line would have answered.
     * Empty when the cap only cost formatting, which reads very differently.
     */
    requirementsLost: string[];
};

export type ConflictInput = {
    preferences: Pick<UserGenerationPreferences, 'targetLength' | 'maxProjects'>;
    /** Every line generation removed, with why. */
    dropped: readonly Pick<DroppedLine, 'reason' | 'targetKind' | 'targetLabel'>[];
    /** Requirements answered only by a line that was cut. */
    answeredByCut: readonly Pick<CoverageItem, 'text'>[];
};

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function detectPreferenceConflicts(input: ConflictInput): PreferenceConflict[] {
    const { preferences, dropped, answeredByCut } = input;
    const conflicts: PreferenceConflict[] = [];

    // 'weak' lines were cut because they were not worth the space, which is the
    // selector doing its job and no business of the length preference.
    const byCap = dropped.filter((line) => line.reason === 'cap');
    const roleLines = byCap.filter((line) => line.targetKind === 'experience');
    const projectLines = byCap.filter((line) => line.targetKind === 'project');
    const requirementsLost = answeredByCut.map((item) => item.text);

    if (roleLines.length > 0) {
        // 'auto' resolved down is still a shorter document, but the user never
        // typed "one page" — so it is described as what happened, not as a
        // choice they made and should feel responsible for.
        const chose =
            preferences.targetLength === 'auto'
                ? 'Fitting this to your experience'
                : `Your ${preferences.targetLength} default`;

        // Distinct roles, not lines: "cut 4 lines from 2 roles" is the shape a
        // person can picture.
        const roles = new Set(roleLines.map((line) => line.targetLabel));

        const summary =
            requirementsLost.length > 0
                ? `${chose} cut ${plural(roleLines.length, 'line')} that answered ${
                      requirementsLost.length === 1 ? 'something' : `${requirementsLost.length} things`
                  } this posting asks for.`
                : `${chose} cut ${plural(roleLines.length, 'line')} from ${plural(roles.size, 'role')}.`;

        conflicts.push({ preference: 'targetLength', summary, requirementsLost });
    }

    if (projectLines.length > 0) {
        const projects = new Set(projectLines.map((line) => line.targetLabel));
        conflicts.push({
            preference: 'maxProjects',
            summary: `Your limit of ${preferences.maxProjects} projects cut ${plural(
                projectLines.length,
                'line',
            )} from ${plural(projects.size, 'project')}.`,
            // Project lines are not scored against requirements, so claiming a
            // requirement was lost here would be putting the length preference's
            // evidence behind a different preference's warning.
            requirementsLost: [],
        });
    }

    return conflicts;
}

/** True when the defaults cost this candidate nothing on this posting. */
export function isCleanFit(input: ConflictInput): boolean {
    return detectPreferenceConflicts(input).length === 0;
}
