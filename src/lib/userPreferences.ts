import { z } from 'zod';

export const SectionOrderItemSchema = z.enum(['summary', 'experience', 'projects', 'education', 'skills']);

export const UserGenerationPreferencesSchema = z.object({
  defaultTemplate: z.enum(['ats-simple', 'modern', 'classic']).default('ats-simple'),
  defaultSectionOrder: z.array(SectionOrderItemSchema).min(1).max(5).default(['summary', 'experience', 'projects', 'education', 'skills']),
  maxProjects: z.number().int().min(1).max(6).default(3),
  includeOSS: z.boolean().default(true),
  tonePreference: z.enum(['formal', 'conversational', 'technical']).default('technical'),
  autoGenerate: z.boolean().default(false),
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

export function parseUserGenerationPreferences(value: unknown): UserGenerationPreferences {
  const parsed = UserGenerationPreferencesSchema.safeParse(value ?? {});
  if (parsed.success) {
    return {
      ...parsed.data,
      defaultSectionOrder: normalizeSectionOrder(parsed.data.defaultSectionOrder),
    };
  }

  return defaultUserGenerationPreferences;
}
