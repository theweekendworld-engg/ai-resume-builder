import { z } from 'zod';

import type { ParsedResumeData } from '@/lib/aiSchemas';

/**
 * What the import model is asked for, and how it becomes `ParsedResumeData`.
 *
 * Every field is required (empty string or empty list when absent) so the
 * schema is valid for strict structured output, and there is deliberately no
 * free-text `description` on a role. That field is where the invented first
 * bullets came from: asked for a description, the model wrote one, out of the
 * company's tag line ("Engineers voice infrastructure, agentic AI support
 * systems…"), and the editor printed it as a bullet (QA 2026-11-07).
 *
 * The model's output is a proposal. `faithfulImport.reconcileWithSource`
 * decides what is stored.
 */

const text = z.string();

export const ImportParseSchema = z.object({
    personalInfo: z.object({
        fullName: text,
        title: text,
        email: text,
        phone: text,
        location: text,
        linkedin: text,
        github: text,
        website: text,
        summary: text,
    }),
    experiences: z.array(
        z.object({
            company: text,
            companyNote: text,
            role: text,
            stack: text,
            location: text,
            startDate: text,
            endDate: text,
            current: z.boolean(),
            bullets: z.array(text),
        }),
    ),
    education: z.array(
        z.object({
            institution: text,
            degree: text,
            fieldOfStudy: text,
            startDate: text,
            endDate: text,
            current: z.boolean(),
        }),
    ),
    projects: z.array(
        z.object({
            name: text,
            technologies: z.array(text),
            githubUrl: text,
            liveUrl: text,
            bullets: z.array(text),
        }),
    ),
    achievements: z.array(
        z.object({
            title: text,
            description: text,
            type: z.enum(['achievement', 'oss_contribution', 'certification', 'award', 'publication', 'custom']),
        }),
    ),
    skillGroups: z.array(z.object({ label: text, items: z.array(text) })),
});

export type ImportParse = z.infer<typeof ImportParseSchema>;

export const IMPORT_PARSE_SYSTEM = `You copy a resume into structured fields. You are a copier, not a writer.

BULLETS
- Copy every bullet exactly as printed: same words, same numbers, same order. One list entry per bullet.
- A bullet that wraps onto several lines is ONE bullet. Never split one, never merge two, never shorten one, never reword one.
- A role printed on one line ("Company, Role. What they did. Dates") has that sentence, whole, as its only bullet.
- Never write a line that is not on the page. No role summaries, no descriptions, nothing made from a company's tag line or a list of technologies.

ROLES
- company: the employer's name only. companyNote: a short note printed beside the name, such as the text in brackets after it, without the brackets; else "".
- role: the job title only. stack: the technologies printed with the title (after "|" or similar); else "".
- Dates exactly as printed. current is true when the end date says Present.

PROJECTS
- name: the project's title only. technologies: the list printed with it. bullets: as above.
- githubUrl / liveUrl: links printed for the project, or given in the link annotations.

SKILLS
- One skillGroups entry per printed skills row. label exactly as printed before the colon ("" when the row has none). items exactly as printed, in order.

OTHER
- summary: copy the resume's summary or profile paragraph if it has one; else "".
- title: the headline printed under the name, if any; else "".
- Use "" or [] for anything absent. Never guess.`;

export function toParsedResume(data: ImportParse): ParsedResumeData {
    return {
        personalInfo: { ...data.personalInfo },
        experiences: data.experiences.map((item) => ({
            company: item.company,
            role: item.role,
            startDate: item.startDate,
            endDate: item.endDate,
            current: item.current,
            location: item.location,
            description: '',
            highlights: item.bullets,
            ...(item.companyNote.trim() ? { companyNote: item.companyNote.trim() } : {}),
            ...(item.stack.trim() ? { stack: item.stack.trim() } : {}),
        })),
        education: data.education.map((item) => ({ ...item })),
        projects: data.projects.map((item) => ({
            name: item.name,
            description: item.bullets.join('\n'),
            technologies: item.technologies,
            ...(item.githubUrl.trim() ? { githubUrl: item.githubUrl.trim() } : {}),
            ...(item.liveUrl.trim() ? { liveUrl: item.liveUrl.trim() } : {}),
        })),
        achievements: data.achievements.map((item) => ({ ...item })),
        skills: data.skillGroups.flatMap((group) => group.items),
        skillGroups: data.skillGroups.map((group) => ({ label: group.label, items: [...group.items] })),
    };
}
