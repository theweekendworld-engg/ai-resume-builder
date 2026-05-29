export type SectionType = 'experience' | 'projects' | 'education' | 'skills' | 'summary';

export interface ResumeData {
    personalInfo: PersonalInfo;
    experience: ExperienceItem[];
    projects: ProjectItem[];
    education: EducationItem[];
    skills: string[];
    sectionOrder: SectionType[]; // Order of sections in the resume
}

export interface PersonalInfo {
    fullName: string;
    title: string; // Job title/role (e.g., "Software Engineer")
    email: string;
    phone: string;
    location: string;
    website: string;
    linkedin: string;
    github: string;
    summary: string;
}

export interface ExperienceItem {
    id: string;
    company: string;
    role: string;
    startDate: string;
    endDate: string;
    current: boolean;
    location: string;
    description: string; // HTML or rich text content
}

export interface ProjectItem {
    id: string;
    name: string;
    description: string;
    url: string; // Primary URL derived from liveUrl/repoUrl
    liveUrl: string;
    repoUrl: string;
    technologies: string[];
}

export interface EducationItem {
    id: string;
    institution: string;
    degree: string;
    fieldOfStudy: string;
    startDate: string;
    endDate: string;
    current: boolean;
}

export interface ResumeGenerationPreferences {
    targetLength?: '1-page' | '2-page' | 'auto';
}

/**
 * Visual identity of a resume. This is the contract between the editor design
 * controls and the LaTeX render backend (`src/templates/latex.ts`).
 *
 * `sectionOrder` intentionally stays on `ResumeData` (not duplicated here) — the
 * theme references it conceptually but the array of record remains on the resume.
 */
export type ResumeTemplateId = 'ats-simple' | 'modern' | 'classic' | 'minimal';

export type ResumeFontFamily = 'sans' | 'serif' | 'mono';

export type ResumeDensity = 'compact' | 'normal' | 'relaxed';

export interface ResumeTheme {
    templateId: ResumeTemplateId;
    accentColor: string; // hex, e.g. '#1F4E79'
    fontFamily: ResumeFontFamily; // maps to LaTeX font packages
    density: ResumeDensity; // affects margins / line spacing
}

export const DEFAULT_RESUME_THEME: ResumeTheme = {
    templateId: 'ats-simple',
    accentColor: '#1F4E79',
    fontFamily: 'sans',
    density: 'normal',
};

export const initialResumeData: ResumeData = {
    personalInfo: {
        fullName: "",
        title: "",
        email: "",
        phone: "",
        location: "",
        website: "",
        linkedin: "",
        github: "",
        summary: "",
    },
    experience: [],
    projects: [],
    education: [],
    skills: [],
    sectionOrder: ['summary', 'experience', 'projects', 'education', 'skills'],
};
