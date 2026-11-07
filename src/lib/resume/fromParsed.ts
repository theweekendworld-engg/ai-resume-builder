import type { ParsedResumeData } from '@/lib/aiSchemas';
import { initialResumeData, type ResumeData } from '@/types/resume';

/**
 * The parser's output (history-shaped) → an editable resume document.
 *
 * Onboarding used to read a resume into history and stop there, so a user who
 * came to fix THEIR resume left onboarding without one (audit 2026-09-27, D).
 * Pure and deterministic: no model call, the parse already happened.
 */
export function resumeDataFromParsed(parsed: ParsedResumeData): ResumeData {
    const pi = parsed.personalInfo;
    return {
        personalInfo: {
            fullName: pi.fullName ?? '',
            title: pi.title ?? '',
            email: pi.email ?? '',
            phone: pi.phone ?? '',
            location: pi.location ?? '',
            website: pi.website ?? '',
            linkedin: pi.linkedin ?? '',
            github: pi.github ?? '',
            summary: pi.summary ?? '',
        },
        experience: parsed.experiences
            .filter((item) => item.company?.trim() || item.role?.trim())
            .map((item, index) => ({
                id: `exp-${index + 1}`,
                company: item.company ?? '',
                role: item.role ?? '',
                startDate: item.startDate ?? '',
                endDate: item.current ? '' : item.endDate ?? '',
                current: Boolean(item.current),
                location: item.location ?? '',
                description: bullets(item.description, item.highlights),
                ...(item.companyNote?.trim() ? { companyNote: item.companyNote.trim() } : {}),
                ...(item.stack?.trim() ? { stack: item.stack.trim() } : {}),
            })),
        projects: parsed.projects
            .filter((item) => item.name?.trim())
            .map((item, index) => {
                const repoUrl = item.githubUrl ?? '';
                const liveUrl = item.liveUrl ?? '';
                return {
                    id: `proj-${index + 1}`,
                    name: item.name,
                    // One bullet per line, as the template renders them.
                    description: bullets(item.description, []),
                    url: liveUrl || repoUrl,
                    liveUrl,
                    repoUrl,
                    technologies: item.technologies ?? [],
                };
            }),
        education: parsed.education
            .filter((item) => item.institution?.trim())
            .map((item, index) => ({
                id: `edu-${index + 1}`,
                institution: item.institution,
                degree: item.degree ?? '',
                fieldOfStudy: item.fieldOfStudy ?? '',
                startDate: item.startDate ?? '',
                endDate: item.current ? '' : item.endDate ?? '',
                current: Boolean(item.current),
            })),
        skills: [...new Set((parsed.skills ?? []).map((skill) => skill.trim()).filter(Boolean))],
        ...(parsed.skillGroups?.length
            ? {
                skillGroups: parsed.skillGroups
                    .map((group) => ({ label: group.label.trim(), items: group.items.map((item) => item.trim()).filter(Boolean) }))
                    .filter((group) => group.items.length > 0),
            }
            : {}),
        sectionOrder: [...initialResumeData.sectionOrder],
    };
}

/**
 * A role's lines as "• " bullets the editor renders.
 *
 * Highlights when there are any, otherwise the description. It used to print
 * BOTH, so a role the model summarised in `description` and listed in
 * `highlights` came out with the same claim twice (a one-line internship,
 * once without its metric and once with it), and a description invented from
 * the company's tag line became the first bullet (QA 2026-11-07).
 */
function bullets(description: string | undefined, highlights: string[] | undefined): string {
    const clean = (lines: readonly string[]) =>
        lines.map((line) => line.replace(/^[\s•\-*·]+/, '').trim()).filter(Boolean);
    const fromHighlights = clean(highlights ?? []);
    const lines = fromHighlights.length > 0 ? fromHighlights : clean((description ?? '').split('\n'));
    return [...new Set(lines)].map((line) => `• ${line}`).join('\n');
}

export function resumeTitleFromParsed(parsed: ParsedResumeData): string {
    const title = parsed.personalInfo.title?.trim();
    return title ? `${title} resume` : 'My resume';
}
