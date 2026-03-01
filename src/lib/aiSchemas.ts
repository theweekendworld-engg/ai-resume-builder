import { z } from 'zod';

/**
 * Zod schema for ATS Score breakdown
 */
export const ATSBreakdownSchema = z.object({
    keywordMatch: z.number().min(0).max(100).default(0),
    skillsMatch: z.number().min(0).max(100).default(0),
    experienceRelevance: z.number().min(0).max(100).default(0),
    formattingScore: z.number().min(0).max(100).default(85),
});

/**
 * Zod schema for full ATS Score
 */
export const ATSScoreSchema = z.object({
    overall: z.number().min(0).max(100),
    breakdown: ATSBreakdownSchema,
    matchedKeywords: z.array(z.string()).default([]),
    missingKeywords: z.array(z.string()).default([]),
    suggestions: z.array(z.string()).default([]),
});

/**
 * Zod schema for PersonalInfo
 */
export const PersonalInfoSchema = z.object({
    fullName: z.string().default(''),
    title: z.string().default(''),
    email: z.string().email().or(z.string().default('')),
    phone: z.string().default(''),
    location: z.string().default(''),
    website: z.string().default(''),
    linkedin: z.string().default(''),
    github: z.string().default(''),
    summary: z.string().default(''),
});

/**
 * Zod schema for Experience item
 */
export const ExperienceItemSchema = z.object({
    id: z.string(),
    company: z.string().default(''),
    role: z.string().default(''),
    startDate: z.string().default(''),
    endDate: z.string().default(''),
    current: z.boolean().default(false),
    location: z.string().default(''),
    description: z.string().default(''),
});

/**
 * Zod schema for Project item
 */
export const ProjectItemSchema = z.object({
    id: z.string(),
    name: z.string().default(''),
    description: z.string().default(''),
    url: z.string().default(''),
    technologies: z.array(z.string()).default([]),
});

/**
 * Zod schema for Education item
 */
export const EducationItemSchema = z.object({
    id: z.string(),
    institution: z.string().default(''),
    degree: z.string().default(''),
    fieldOfStudy: z.string().default(''),
    startDate: z.string().default(''),
    endDate: z.string().default(''),
    current: z.boolean().default(false),
});

/**
 * Zod schema for full Resume data
 */
export const ResumeDataSchema = z.object({
    personalInfo: PersonalInfoSchema,
    experience: z.array(ExperienceItemSchema).default([]),
    projects: z.array(ProjectItemSchema).default([]),
    education: z.array(EducationItemSchema).default([]),
    skills: z.array(z.string()).default([]),
    sectionOrder: z.array(z.enum(['experience', 'projects', 'education', 'skills', 'summary'])).default(['summary', 'experience', 'projects', 'education', 'skills']),
});

/**
 * Zod schema for keywords extraction response
 */
export const KeywordsResponseSchema = z.object({
    keywords: z.array(z.string()).default([]),
});

/**
 * Zod schema for section diff (before/after comparison)
 */
export const SectionDiffSchema = z.object({
    before: z.string(),
    after: z.string(),
    changed: z.boolean(),
});

/**
 * Zod schema for proposed resume patch from copilot
 * Note: diffs are optional since we generate them from sections data
 */
export const ProposedResumePatchSchema = z.object({
    sections: z.object({
        summary: z.string().optional(),
        experience: z.array(ExperienceItemSchema).optional(),
        projects: z.array(ProjectItemSchema).optional(),
        skills: z.array(z.string()).optional(),
    }),
    rationale: z.array(z.string()).default([]),
    proposedAtsScore: z.number().min(0).max(100).default(75),
});

/**
 * Zod schema for GitHub repo relevance scoring
 */
export const ScoredRepoSchema = z.object({
    name: z.string(),
    description: z.string().nullable(),
    relevanceScore: z.number(),
    relevanceReason: z.string(),
});

// Type exports
export type ATSScoreType = z.infer<typeof ATSScoreSchema>;
export type ResumeDataType = z.infer<typeof ResumeDataSchema>;
export type KeywordsResponseType = z.infer<typeof KeywordsResponseSchema>;
export type SectionDiffType = z.infer<typeof SectionDiffSchema>;
export type ProposedResumePatchType = z.infer<typeof ProposedResumePatchSchema>;
export type ScoredRepoType = z.infer<typeof ScoredRepoSchema>;

/**
 * Safely parse JSON from AI response with validation.
 * Returns validated data or null if parsing/validation fails.
 */
export function parseAIResponse<T>(
    content: string,
    schema: z.ZodSchema<T>
): { success: true; data: T } | { success: false; error: string } {
    try {
        // Extract JSON from response (may be wrapped in markdown)
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { success: false, error: 'No JSON object found in response' };
        }

        const parsed = JSON.parse(jsonMatch[0]);
        const result = schema.safeParse(parsed);

        if (result.success) {
            return { success: true, data: result.data };
        } else {
            const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
            return { success: false, error: `Validation failed: ${issues}` };
        }
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown parse error'
        };
    }
}

/**
 * Attempt to repair common JSON issues from AI responses.
 */
export function repairJSON(content: string): string {
    let fixed = content;

    // Remove markdown code blocks
    fixed = fixed.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    // Remove trailing commas before closing brackets
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

    // Fix unquoted keys (simple cases)
    fixed = fixed.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');

    // Fix single quotes to double quotes
    fixed = fixed.replace(/'/g, '"');

    return fixed;
}

/**
 * Parse AI response with retry and repair capability.
 */
export async function parseWithRetry<T>(
    content: string,
    schema: z.ZodSchema<T>,
    repairAttempt = true
): Promise<{ success: true; data: T } | { success: false; error: string }> {
    // First attempt
    const firstResult = parseAIResponse(content, schema);
    if (firstResult.success) {
        return firstResult;
    }

    // Try repairing if enabled
    if (repairAttempt) {
        const repairedContent = repairJSON(content);
        const repairResult = parseAIResponse(repairedContent, schema);
        if (repairResult.success) {
            return repairResult;
        }
    }

    return { success: false, error: firstResult.error };
}
