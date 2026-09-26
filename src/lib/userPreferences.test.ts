import { describe, expect, test } from 'bun:test';
import { mergePreferenceUpdate, UserGenerationPreferencesSchema } from './userPreferences';

const Partial = UserGenerationPreferencesSchema.partial();

/** Mirrors `updateUserPreferences`: raw input → partial parse → merge. */
function save(existing: unknown, sent: Record<string, unknown>) {
    const parsed = Partial.parse(sent) as Record<string, unknown>;
    return mergePreferenceUpdate(existing, sent, parsed);
}

const STORED = {
    requiresSponsorship: 'yes',
    willingToRelocate: 'no',
    preferredWorkModes: ['remote'],
    defaultSectionOrder: ['experience', 'summary', 'projects', 'education', 'skills'] as ('summary' | 'experience' | 'projects' | 'education' | 'skills')[],
    maxProjects: 5,
    targetRoles: ['Backend Engineer'],
};

describe('mergePreferenceUpdate', () => {
    test('the premise: zod fills defaults for omitted keys inside .partial()', () => {
        // If this ever stops being true the helper is still correct, just no
        // longer load-bearing.
        const parsed = Partial.parse({ targetRoles: ['SDE II'] }) as Record<string, unknown>;
        expect(parsed.requiresSponsorship).toBe('unknown');
    });

    test('saving one field leaves every other stored preference alone', () => {
        const merged = save(STORED, { targetRoles: ['SDE II'] });
        expect(merged.targetRoles).toEqual(['SDE II']);
        expect(merged.requiresSponsorship).toBe('yes');
        expect(merged.willingToRelocate).toBe('no');
        expect(merged.preferredWorkModes).toEqual(['remote']);
        expect(merged.maxProjects).toBe(5);
        expect(merged.defaultSectionOrder).toEqual(STORED.defaultSectionOrder);
    });

    test('a key sent as undefined is not a key sent', () => {
        // normalizePreferenceInput spreads maxProjects/defaultSectionOrder/
        // preferredWorkModes as undefined when absent; those must not reset.
        const merged = save(STORED, { targetRoles: ['SDE II'], preferredWorkModes: undefined, maxProjects: undefined });
        expect(merged.preferredWorkModes).toEqual(['remote']);
        expect(merged.maxProjects).toBe(5);
    });

    test('a sent value does overwrite, including back to a default', () => {
        const merged = save(STORED, { requiresSponsorship: 'unknown', preferredWorkModes: [] });
        expect(merged.requiresSponsorship).toBe('unknown');
        expect(merged.preferredWorkModes).toEqual([]);
    });

    test('no stored row falls back to defaults plus what was sent', () => {
        const merged = save(null, { companySizePreference: 'startup' });
        expect(merged.companySizePreference).toBe('startup');
        expect(merged.targetRoles).toEqual([]);
    });
});
