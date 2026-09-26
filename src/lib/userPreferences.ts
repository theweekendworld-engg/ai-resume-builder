import { z } from 'zod';

export const SectionOrderItemSchema = z.enum(['summary', 'experience', 'projects', 'education', 'skills']);
export const WorkModePreferenceSchema = z.enum(['remote', 'hybrid', 'onsite']);

export const UserGenerationPreferencesSchema = z.object({
  defaultTemplate: z.enum(['ats-simple', 'modern', 'classic', 'minimal']).default('ats-simple'),
  defaultSectionOrder: z.array(SectionOrderItemSchema).min(1).max(5).default(['summary', 'experience', 'projects', 'education', 'skills']),
  maxProjects: z.number().int().min(1).max(6).default(3),
  targetLength: z.enum(['1-page', '2-page', 'auto']).default('auto'),
  includeOSS: z.boolean().default(true),
  tonePreference: z.enum(['formal', 'conversational', 'technical']).default('technical'),
  autoGenerate: z.boolean().default(false),
  workAuthorization: z.string().max(160).default(''),
  requiresSponsorship: z.enum(['unknown', 'yes', 'no', 'case_by_case']).default('unknown'),
  willingToRelocate: z.enum(['unknown', 'yes', 'no', 'case_by_case']).default('unknown'),
  preferredWorkModes: z.array(WorkModePreferenceSchema).max(3).default([]),
  desiredCompensation: z.string().max(200).default(''),
  noticePeriod: z.string().max(120).default(''),
  // ── Job-search preferences (Scout, docs/impl/06-scout-agent.md) ──────────
  // Fit reads these; when one it needs is empty, Scout asks once on the
  // channel the link came from and writes the answer back here.
  /** e.g. ["Backend Engineer", "SDE II"]. Empty means "not stated", never "anything". */
  targetRoles: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  /** Cities or regions, e.g. ["Bengaluru", "Remote India"]. */
  targetLocations: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  /** Free text as the user says it: "₹40 LPA", "$180k base". Never converted. */
  minCompensationText: z.string().max(120).default(''),
  companySizePreference: z.enum(['any', 'startup', 'mid', 'large']).default('any'),
});

export type UserGenerationPreferences = z.infer<typeof UserGenerationPreferencesSchema>;

export const defaultUserGenerationPreferences: UserGenerationPreferences = UserGenerationPreferencesSchema.parse({});

function normalizeSectionOrder(order: string[]): UserGenerationPreferences['defaultSectionOrder'] {
  const fallback = defaultUserGenerationPreferences.defaultSectionOrder;
  const deduped = [...new Set(order.filter(Boolean))];
  const valid = deduped.filter((entry): entry is UserGenerationPreferences['defaultSectionOrder'][number] =>
    ['summary', 'experience', 'projects', 'education', 'skills'].includes(entry)
  );

  const withMissing = [...valid, ...fallback.filter((entry) => !valid.includes(entry))];
  return withMissing.slice(0, 5) as UserGenerationPreferences['defaultSectionOrder'];
}

function normalizeWorkModes(modes: string[]): UserGenerationPreferences['preferredWorkModes'] {
  const valid = [...new Set(modes.filter(Boolean))]
    .filter((entry): entry is UserGenerationPreferences['preferredWorkModes'][number] =>
      ['remote', 'hybrid', 'onsite'].includes(entry)
    );

  return valid.slice(0, 3);
}

export function parseUserGenerationPreferences(value: unknown): UserGenerationPreferences {
  const parsed = UserGenerationPreferencesSchema.safeParse(value ?? {});
  if (parsed.success) {
    return {
      ...parsed.data,
      defaultSectionOrder: normalizeSectionOrder(parsed.data.defaultSectionOrder),
      preferredWorkModes: normalizeWorkModes(parsed.data.preferredWorkModes),
    };
  }

  return defaultUserGenerationPreferences;
}

/**
 * The stored preferences after a PARTIAL update.
 *
 * Zod 4 applies `.default()` inside `.partial()`, so a parsed partial input
 * carries a default for every key the caller omitted. Merging it wholesale
 * meant saving one field reset every other preference to its default. Only
 * keys the caller actually sent, with a defined value, may overwrite what is
 * stored: `sent` is the caller's raw object, `parsed` the validated values.
 */
export function mergePreferenceUpdate(
  existing: unknown,
  sent: unknown,
  parsed: Record<string, unknown>,
): UserGenerationPreferences {
  const sentKeys = new Set(
    sent && typeof sent === 'object' && !Array.isArray(sent)
      ? Object.entries(sent as Record<string, unknown>)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key)
      : [],
  );
  const update = Object.fromEntries(Object.entries(parsed).filter(([key]) => sentKeys.has(key)));
  const stored = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {};
  return parseUserGenerationPreferences({ ...defaultUserGenerationPreferences, ...stored, ...update });
}
