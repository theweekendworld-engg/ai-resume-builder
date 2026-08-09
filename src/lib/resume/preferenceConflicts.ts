import type { UserGenerationPreferences } from '@/lib/userPreferences';
import type { LengthConstraints } from './length';

/**
 * What a user's defaults cost them on this particular posting.
 *
 * ── Why flag rather than override ───────────────────────────────────────────
 *
 * A resume tool that quietly ignores the length you chose because it decided
 * the posting knew better is a tool you cannot trust with the rest. The
 * preference wins, always. What this module does is make the price visible, so
 * the choice is informed rather than blind — and offer the one-click escape for
 * this resume only, which never edits the stored default.
 *
 * ── The honesty constraint ──────────────────────────────────────────────────
 *
 * Every conflict here is arithmetic over counts the pipeline already knows:
 * roles the candidate has versus roles the cap allows. Nothing is inferred from
 * a model's opinion of the posting, because "this role feels senior" is exactly
 * the kind of claim that reads as insight and is unfalsifiable. If a figure
 * cannot be derived from a count, it does not appear.
 *
 * That rules out a tone conflict for now. "The posting emphasises outcomes, so
 * your formal tone understates you" needs a judgement no count supports, and a
 * plausible-sounding warning that turns out to be noise costs more trust than
 * the warning was worth. It returns when there is a measurement behind it.
 */

export type PreferenceConflict = {
    /** Which stored preference is responsible. */
    preference: 'targetLength' | 'maxProjects';
    /** One line, in the user's terms, naming the cost. */
    summary: string;
    /** What to change for THIS resume only. Never written to the profile. */
    override: Partial<Pick<UserGenerationPreferences, 'targetLength' | 'maxProjects'>>;
    /** Label for the escape-hatch button. */
    action: string;
};

export type ConflictInput = {
    preferences: UserGenerationPreferences;
    constraints: LengthConstraints;
    /** What the candidate actually has available, before any cap. */
    available: {
        roles: number;
        projects: number;
        /** Bullets per role, in the order roles will be kept. */
        bulletsPerRole: readonly number[];
    };
};

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function detectPreferenceConflicts(input: ConflictInput): PreferenceConflict[] {
    const { preferences, constraints, available } = input;
    const conflicts: PreferenceConflict[] = [];

    // A cap only conflicts when it actually bites. Someone with three roles and
    // a four-role cap has no conflict, and telling them otherwise trains them
    // to ignore the panel.
    const droppedRoles = Math.max(0, available.roles - constraints.maxExperiences);

    // Only count bullets on roles that survive: a bullet on a dropped role is
    // already accounted for by the dropped role, and double-reporting it makes
    // the cost look worse than it is.
    const keptRoles = available.bulletsPerRole.slice(0, constraints.maxExperiences);
    const droppedBullets = keptRoles.reduce(
        (total, count) => total + Math.max(0, count - constraints.maxBulletsPerRole),
        0,
    );

    if (droppedRoles > 0 || droppedBullets > 0) {
        const parts: string[] = [];
        if (droppedRoles > 0) parts.push(plural(droppedRoles, 'role'));
        if (droppedBullets > 0) parts.push(plural(droppedBullets, 'bullet'));

        // 'auto' resolved down to one page is still a one-page outcome, but the
        // user never typed "one page" — so it is described as what happened,
        // not as a choice they made.
        const chose = preferences.targetLength === 'auto'
            ? 'Fitting this to one page'
            : `Your ${preferences.targetLength} default`;

        conflicts.push({
            preference: 'targetLength',
            summary: `${chose} left out ${parts.join(' and ')}.`,
            override: { targetLength: '2-page' },
            action: 'Allow two pages for this one',
        });
    }

    const droppedProjects = Math.max(0, available.projects - preferences.maxProjects);
    if (droppedProjects > 0) {
        conflicts.push({
            preference: 'maxProjects',
            summary: `${plural(droppedProjects, 'project')} did not fit your limit of ${preferences.maxProjects}.`,
            override: { maxProjects: Math.min(6, available.projects) },
            action: `Show ${plural(Math.min(6, available.projects), 'project')} here`,
        });
    }

    return conflicts;
}

/** True when the defaults cost this candidate nothing on this posting. */
export function isCleanFit(input: ConflictInput): boolean {
    return detectPreferenceConflicts(input).length === 0;
}
