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
            })),
        projects: parsed.projects
            .filter((item) => item.name?.trim())
            .map((item, index) => {
                const repoUrl = item.githubUrl ?? '';
                const liveUrl = item.liveUrl ?? '';
                return {
                    id: `proj-${index + 1}`,
                    name: item.name,
                    description: item.description ?? '',
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
        sectionOrder: [...initialResumeData.sectionOrder],
    };
}

/** The description paragraph plus highlights, as "• " lines the editor renders. */
function bullets(description: string | undefined, highlights: string[] | undefined): string {
    const lines = [
        ...(description ?? '').split('\n'),
        ...(highlights ?? []),
    ]
        .map((line) => line.replace(/^[\s•\-*·]+/, '').trim())
        .filter(Boolean);
    return [...new Set(lines)].map((line) => `• ${line}`).join('\n');
}

export function resumeTitleFromParsed(parsed: ParsedResumeData): string {
    const title = parsed.personalInfo.title?.trim();
    return title ? `${title} resume` : 'My resume';
}
