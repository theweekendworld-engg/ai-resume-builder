export type SectionType = 'experience' | 'projects' | 'education' | 'skills' | 'summary';

export interface ResumeData {
    personalInfo: PersonalInfo;
    experience: ExperienceItem[];
    projects: ProjectItem[];
    education: EducationItem[];
    skills: string[];
    /**
     * The resume's own skills rows, labels as the candidate wrote them
     * ("Speech / AI", "Voice infra"). Optional: without it the renderer groups
     * `skills` by vocabulary. `skills` stays the source of truth for WHICH
     * skills show; a row only prints the items still in `skills`.
     */
    skillGroups?: SkillGroupData[];
    sectionOrder: SectionType[]; // Order of sections in the resume
    /**
     * The look this resume renders in. Travels with the resume, so a tailored
     * copy opens in the template its PDF was made in, not whatever this
     * browser last used (e2e QA 2026-11-08: a 1-page compact PDF showed as
     * "2 pages" in an editor still set to ats-simple).
     */
    theme?: ResumeTheme;
}

export interface SkillGroupData {
    label: string;
    items: string[];
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
    /** Printed beside the company: "established CPaaS, AI voice agents". */
    companyNote?: string;
    /** Printed beside the title: "Go, C, Python". */
    stack?: string;
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
export const RESUME_TEMPLATE_IDS = ['compact', 'ats-simple', 'modern', 'classic', 'minimal'] as const;

export type ResumeTemplateId = (typeof RESUME_TEMPLATE_IDS)[number];

/**
 * The template a resume gets when nobody chose one: a new resume, and a
 * tailored one whose owner set no default. `compact` keeps a full resume on
 * one page, so the page-fit loop does not have to cut bullets to get there.
 */
export const DEFAULT_TEMPLATE_ID: ResumeTemplateId = 'compact';

/** The picker's labels, in the order the gallery and the settings list them. */
export const RESUME_TEMPLATE_OPTIONS: ReadonlyArray<{ value: ResumeTemplateId; label: string; description: string }> = [
    {
        value: 'compact',
        label: 'Compact (one page)',
        description: 'Dense single page: tight spacing, one-line internships, stack beside each title',
    },
    { value: 'ats-simple', label: 'ATS Simple', description: 'Clean, ATS-friendly format with traditional layout' },
    { value: 'modern', label: 'Modern Professional', description: 'Contemporary design with icons and accent colors' },
    { value: 'classic', label: 'Classic', description: 'Traditional single-column resume style focused on readability' },
    { value: 'minimal', label: 'Minimal', description: 'Whitespace-forward, no rules, generous margins' },
];

export function isResumeTemplateId(value: unknown): value is ResumeTemplateId {
    return typeof value === 'string' && (RESUME_TEMPLATE_IDS as readonly string[]).includes(value);
}

export type ResumeFontFamily = 'sans' | 'serif' | 'mono';

export type ResumeDensity = 'compact' | 'normal' | 'relaxed';

export interface ResumeTheme {
    templateId: ResumeTemplateId;
    accentColor: string; // hex, e.g. '#1F4E79'
    fontFamily: ResumeFontFamily; // maps to LaTeX font packages
    density: ResumeDensity; // affects margins / line spacing
}

/**
 * The theme every template had before `compact` existed. Anything that only
 * knows a template id (the generation pipeline, an editor state persisted
 * before themes) resolves the older templates against this, so their output
 * does not change.
 */
export const LEGACY_RESUME_THEME: ResumeTheme = {
    templateId: 'ats-simple',
    accentColor: '#1F4E79',
    fontFamily: 'sans',
    density: 'normal',
};

/**
 * A new resume's theme. Serif because `compact` is set in Latin Modern, like
 * the LaTeX resume it is modelled on.
 */
export const DEFAULT_RESUME_THEME: ResumeTheme = {
    templateId: DEFAULT_TEMPLATE_ID,
    accentColor: '#1F4E79',
    fontFamily: 'serif',
    density: 'normal',
};

/** The theme a bare template id means, e.g. `generateLatexFromResume(data, 'modern')`. */
export function defaultThemeFor(templateId: ResumeTemplateId): ResumeTheme {
    return templateId === 'compact'
        ? { ...DEFAULT_RESUME_THEME, templateId }
        : { ...LEGACY_RESUME_THEME, templateId };
}

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
