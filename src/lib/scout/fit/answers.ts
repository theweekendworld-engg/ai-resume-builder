/**
 * Scout's preference questions and how an answer maps onto preferences.
 *
 * One mapping, used twice: `fit` applies `ctx.answers` over the stored
 * preferences for THIS run, and `applyAnswerToProfile` writes the same result
 * back to the profile so the NEXT run does not ask. If those two drifted, a
 * user could answer "no relocation" and still be asked on the next job.
 */

import type { UserGenerationPreferences } from '@/lib/userPreferences';

export const PREFERENCE_QUESTION_IDS = [
    'pref.location',
    'pref.relocate',
    'pref.workMode',
    'pref.targetRoles',
    'pref.minComp',
] as const;

export type PreferenceQuestionId = (typeof PREFERENCE_QUESTION_IDS)[number];

export function isPreferenceQuestionId(value: string): value is PreferenceQuestionId {
    return (PREFERENCE_QUESTION_IDS as readonly string[]).includes(value);
}

type Relocate = UserGenerationPreferences['willingToRelocate'];
type WorkModes = UserGenerationPreferences['preferredWorkModes'];

/**
 * "Bengaluru and Pune" is two places; "Research and Development Engineer" is
 * one role. So only locations split on "and".
 */
function splitList(value: string, splitOnAnd = false): string[] {
    const separators = splitOnAnd ? /[,;/\n]|\bor\b|\band\b/i : /[,;/\n]|\bor\b/i;
    return [...new Set(
        value
            .split(separators)
            .map((entry) => entry.replace(/\s+/g, ' ').trim())
            .filter((entry) => entry.length > 0 && entry.length <= 80),
    )].slice(0, 8);
}

export function parseRelocate(value: string): Relocate | null {
    const v = value.trim().toLowerCase();
    if (v === 'case_by_case' || /\b(?:depends|maybe|case|possibly|for the right|not sure|unsure)\b/.test(v)) return 'case_by_case';
    if (v === 'yes' || /^(?:y|yeah|yep|sure|ok|okay|open|willing)\b/.test(v) || /\byes\b/.test(v)) return 'yes';
    if (v === 'no' || /^(?:n|nope|nah|not)\b/.test(v) || /\bno\b/.test(v)) return 'no';
    return null;
}

export function parseWorkModes(value: string): WorkModes | null {
    const v = value.toLowerCase();
    if (/\b(?:any|all|either|whatever|open|flexible|doesn'?t matter)\b/.test(v)) return ['remote', 'hybrid', 'onsite'];
    const modes: WorkModes = [];
    if (/\b(?:remote|wfh|work from home)\b/.test(v)) modes.push('remote');
    if (/\bhybrid\b/.test(v)) modes.push('hybrid');
    if (/\b(?:on[\s-]?site|office|in[\s-]person)\b/.test(v)) modes.push('onsite');
    return modes.length ? modes : null;
}

/**
 * Apply one answer. Returns null when the answer could not be understood —
 * callers must then treat the preference as still unknown, and must NOT ask
 * again in the same run (one question per run, and re-asking the thing the
 * user just answered is the worst possible reply).
 */
export function applyAnswer(
    prefs: UserGenerationPreferences,
    id: PreferenceQuestionId,
    value: string,
): UserGenerationPreferences | null {
    const answer = value.trim();
    if (!answer) return null;
    switch (id) {
        case 'pref.relocate': {
            const relocate = parseRelocate(answer);
            return relocate ? { ...prefs, willingToRelocate: relocate } : null;
        }
        case 'pref.location': {
            const locations = splitList(answer, true);
            return locations.length ? { ...prefs, targetLocations: locations } : null;
        }
        case 'pref.workMode': {
            const modes = parseWorkModes(answer);
            return modes ? { ...prefs, preferredWorkModes: modes } : null;
        }
        case 'pref.targetRoles': {
            const roles = splitList(answer);
            return roles.length ? { ...prefs, targetRoles: roles } : null;
        }
        case 'pref.minComp':
            return /\d/.test(answer) ? { ...prefs, minCompensationText: answer.slice(0, 120) } : null;
    }
}

/** Every known answer applied in a stable order. Unknown ids are ignored. */
export function applyAnswers(
    prefs: UserGenerationPreferences,
    answers: Record<string, string>,
): UserGenerationPreferences {
    let current = prefs;
    for (const id of PREFERENCE_QUESTION_IDS) {
        const value = answers[id];
        if (typeof value !== 'string') continue;
        current = applyAnswer(current, id, value) ?? current;
    }
    return current;
}
