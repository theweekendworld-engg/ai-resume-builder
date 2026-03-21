import { z } from 'zod';

export const SectionOrderItemSchema = z.enum(['summary', 'experience', 'projects', 'education', 'skills']);
export const WorkModePreferenceSchema = z.enum(['remote', 'hybrid', 'onsite']);

export const UserGenerationPreferencesSchema = z.object({
  defaultTemplate: z.enum(['ats-simple', 'modern', 'classic']).default('ats-simple'),
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
