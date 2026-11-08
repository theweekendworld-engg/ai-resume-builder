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
export const RESUME_TEMPLATE_IDS = ['compact', 'executive', 'tech', 'minimal', 'ats-simple', 'modern', 'classic'] as const;

export type ResumeTemplateId = (typeof RESUME_TEMPLATE_IDS)[number];

/**
 * Ids that resumes and settings saved before 2026-11-08 may hold, and the
 * template each now renders as. `modern` printed its contact line in icon
 * glyphs that text extraction reads as "§ GitHub ï LinkedIn"; `classic` was
 * byte for byte the `ats-simple` output. They stay valid ids, so nothing a
 * user saved stops rendering, and each opens in the template closest to what
 * its name promised: Tech for Modern, Executive for Classic.
 */
export const LEGACY_TEMPLATE_ALIASES = { modern: 'tech', classic: 'executive' } as const satisfies Record<string, ResumeTemplateId>;

/** A template the gallery lists: every id that is not a legacy alias. */
export type CanonicalTemplateId = Exclude<ResumeTemplateId, keyof typeof LEGACY_TEMPLATE_ALIASES>;

/**
 * The template an id renders as. A legacy alias resolves to its successor;
 * anything unrecognised (a hand-edited or corrupt state) to `ats-simple`,
 * which is what the renderer has always fallen back to.
 */
export function canonicalTemplateId(id: string | null | undefined): CanonicalTemplateId {
    if (id && Object.prototype.hasOwnProperty.call(LEGACY_TEMPLATE_ALIASES, id)) {
        return LEGACY_TEMPLATE_ALIASES[id as keyof typeof LEGACY_TEMPLATE_ALIASES];
    }
    return isResumeTemplateId(id) ? (id as CanonicalTemplateId) : 'ats-simple';
}

/**
 * The template a resume gets when nobody chose one: a new resume, and a
 * tailored one whose owner set no default. `compact` keeps a full resume on
 * one page, so the page-fit loop does not have to cut bullets to get there.
 */
export const DEFAULT_TEMPLATE_ID: ResumeTemplateId = 'compact';

/**
 * The picker's labels, in the order the gallery and the settings list them.
 * Each description says who the template suits, so the choice is about the
 * reader rather than the look alone.
 */
export const RESUME_TEMPLATE_OPTIONS: ReadonlyArray<{ value: CanonicalTemplateId; label: string; description: string }> = [
    {
        value: 'compact',
        label: 'Compact',
        description: 'The most on one page: dense serif, one-line internships. For engineers with a full page of work.',
    },
    {
        value: 'executive',
        label: 'Executive',
        description: 'Refined serif, small-caps headings over hairline rules. For senior, leadership and client-facing roles.',
    },
    {
        value: 'tech',
        label: 'Tech',
        description: 'Clean sans, one accent colour, skills in a table. For software, data and product roles.',
    },
    {
        value: 'minimal',
        label: 'Minimal',
        description: 'Large name, quiet type, no rules or colour. For design-minded roles and focused resumes.',
    },
    {
        value: 'ats-simple',
        label: 'Simple',
        description: 'Plain black sans with ruled headings. For strict application portals and conservative fields.',
    },
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
 * The theme every template had before `compact` existed. A state persisted
 * before themes existed was made in ats-simple with this theme, and is
 * backfilled with it (see the resume store's `merge`).
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

/**
 * Each template's own look: the face it was designed in and its accent.
 * Every accent clears 4.5:1 on white (WCAG AA for small text), so the
 * coloured headings and links stay readable printed in greyscale too.
 */
const TEMPLATE_THEMES: Record<CanonicalTemplateId, Omit<ResumeTheme, 'templateId'>> = {
    compact: { accentColor: '#1F4E79', fontFamily: 'serif', density: 'normal' },
    executive: { accentColor: '#1F4E79', fontFamily: 'serif', density: 'normal' },
    tech: { accentColor: '#0F766E', fontFamily: 'sans', density: 'normal' },
    minimal: { accentColor: '#111827', fontFamily: 'sans', density: 'normal' },
    'ats-simple': { accentColor: LEGACY_RESUME_THEME.accentColor, fontFamily: 'sans', density: 'normal' },
};

/** The theme a bare template id means, e.g. `generateLatexFromResume(data, 'tech')`. */
export function defaultThemeFor(templateId: ResumeTemplateId): ResumeTheme {
    return { ...TEMPLATE_THEMES[canonicalTemplateId(templateId)], templateId };
}

/**
 * The theme after picking another template. Whatever the user set by hand
 * (an accent or a face that differs from the old template's own) is kept;
 * whatever was still the old template's default becomes the new one's, so
 * picking Tech from Compact gives Tech in its sans and teal, not in
 * Compact's serif. Density is always the user's.
 */
export function switchTemplate(theme: ResumeTheme, templateId: ResumeTemplateId): ResumeTheme {
    const from = defaultThemeFor(theme.templateId);
    const to = defaultThemeFor(templateId);
    const accentIsDefault = theme.accentColor.trim().toLowerCase() === from.accentColor.toLowerCase();
    return {
        templateId,
        accentColor: accentIsDefault ? to.accentColor : theme.accentColor,
        fontFamily: theme.fontFamily === from.fontFamily ? to.fontFamily : theme.fontFamily,
        density: theme.density,
    };
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
