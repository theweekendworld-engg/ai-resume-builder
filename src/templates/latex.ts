import {
    ResumeData,
    initialResumeData,
    ResumeTheme,
    ResumeTemplateId,
    DEFAULT_RESUME_THEME,
    ResumeFontFamily,
    ResumeDensity,
} from '@/types/resume';
import { groupSkills as sharedGroupSkills } from '@/lib/resume/skillGroups';
import { contactParts } from '@/lib/resume/contact';

function escapeLatex(text: string): string {
    if (!text) return '';
    return text
        .replace(/\\/g, '\\textbackslash{}')
        .replace(/&/g, '\\&')
        .replace(/%/g, '\\%')
        .replace(/\$/g, '\\$')
        .replace(/#/g, '\\#')
        .replace(/_/g, '\\_')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/~/g, '\\textasciitilde{}')
        .replace(/\^/g, '\\textasciicircum{}');
}

function normalizeRichText(text: string): string {
    if (!text) return '';
    return text
        .replace(/\r\n/g, '\n')
        .replace(/!\[[^\]]*]\(([^)]+)\)/g, '')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
        .replace(/\*{3,}/g, ' ')
        .replace(/_{3,}/g, ' ')
        .replace(/\s-\s+(?=[A-Za-z0-9])/g, '\n- ')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function markdownToLatex(text: string): string {
    if (!text) return '';
    const normalized = normalizeRichText(text);
    let result = escapeLatex(normalized);

    // Only treat clear markdown emphasis markers as formatting; malformed marker runs are ignored.
    result = result.replace(/\*\*([A-Za-z0-9][^*\n]{0,220}?[A-Za-z0-9])\*\*/g, '\\textbf{$1}');
    result = result.replace(/\*([A-Za-z0-9][^*\n]{0,220}?[A-Za-z0-9])\*/g, '\\textit{$1}');
    result = result.replace(/(^|[\s:])\*+(?=[\s:.,;!?)]|$)/g, '$1');

    return result;
}

function formatDateLatex(dateStr: string): string {
    if (!dateStr) return '';
    if (dateStr.includes('/')) {
        const [month, year] = dateStr.split('/');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthNum = parseInt(month, 10);
        if (monthNum >= 1 && monthNum <= 12) {
            return `${monthNames[monthNum - 1]} ${year}`;
        }
    }
    if (dateStr.includes('-') && dateStr.length >= 7) {
        const [year, month] = dateStr.split('-');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthNum = parseInt(month, 10);
        if (monthNum >= 1 && monthNum <= 12) {
            return `${monthNames[monthNum - 1]} ${year}`;
        }
    }
    return dateStr;
}

function parseDescription(description: string): string[] {
    if (!description) return [];
    const lines = normalizeRichText(description)
        .replace(/<ul>/gi, '')
        .replace(/<\/ul>/gi, '')
        .replace(/<li>/gi, '\n')
        .replace(/<\/li>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .split('\n')
        .flatMap(line => line.split(/\s*[•●]\s+/g))
        .map(line => line.replace(/^[•\-\*]+\s*/, '').replace(/[ \t]{2,}/g, ' ').trim())
        .filter(line => line.length > 0);
    return lines;
}

function normalizeHref(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed.replace(/^\/+/, '')}`;
}

type SkillGroup = {
    label: string;
    skills: string[];
};

function normalizeSkillValue(skill: string): string {
    return skill.trim().replace(/[ \t]+/g, ' ');
}

function shouldOmitSkill(skill: string): boolean {
    const normalized = skill.trim().toLowerCase();
    if (!normalized) return true;

    const genericPatterns = [
        /\bdebugging\b/,
        /\bsource control\b/,
        /\bbranching\b/,
        /\bmerging\b/,
        /\brebasing\b/,
        /\bproblem decomposition\b/,
        /\btrade-?offs?\b/,
        /\bcomplex problems?\b/,
        /\bexcellent\b/,
        /\bability to\b/,
        /\bprovide options\b/,
        /\bdrive the effort\b/,
        /\bguidance\b/,
        /\bplatform engineering team\b/,
        /\bengineering productivity team\b/,
        /\bmultiple zones\b/,
        /\bmultiple regions\b/,
        /\bbonus\b/,
    ];

    return genericPatterns.some((pattern) => pattern.test(normalized));
}

/**
 * Grouping moved to `src/lib/resume/skillGroups.ts`.
 *
 * This file's version knew forty engineering terms off a hardcoded regex and
 * dropped everything else into "Other Tools" — so a designer's whole section
 * was one bucket. The live HTML preview, meanwhile, did no grouping at all.
 * Two renderers, two documents, and only one of them was the one the user
 * looked at while editing.
 *
 * `normalizeSkillValue` and `shouldOmitSkill` still run first: they are this
 * template's own hygiene (casing, and stripping the generic filler the old
 * pipeline used to emit) and are applied before the shared grouping sees them.
 */
function groupSkills(skills: string[]): SkillGroup[] {
    const cleaned: string[] = [];
    for (const rawSkill of skills) {
        const skill = normalizeSkillValue(rawSkill);
        if (shouldOmitSkill(skill)) continue;
        cleaned.push(skill);
    }
    return sharedGroupSkills(cleaned);
}

function renderSkillsSection(groups: SkillGroup[], style: 'simple' | 'modern'): string {
    if (groups.length === 0) return '';

    if (style === 'modern') {
        return groups
            .map((group) => `{\\color{darktext}\\textbf{${escapeLatex(group.label)}:} ${group.skills.map((skill) => escapeLatex(skill)).join(' \\textbullet{} ')}}`)
            .join('\\\\[4pt]\n');
    }

    return groups
        .map((group) => `\\textbf{${escapeLatex(group.label)}:} ${group.skills.map((skill) => escapeLatex(skill)).join(', ')}`)
        .join('\\\\[4pt]\n');
}

function resolveProjectUrls(project: { url?: string; liveUrl?: string; repoUrl?: string }) {
    const explicitLive = (project.liveUrl || '').trim();
    const explicitRepo = (project.repoUrl || '').trim();
    const repoUrl = explicitRepo;
    const liveUrl = explicitLive;

    return {
        liveUrl,
        repoUrl,
    };
}

/**
 * The render backend understands four templates. `LatexTemplateType` is kept as
 * an alias of `ResumeTemplateId` so existing imports/string literals keep
 * compiling; the union simply grew the `'minimal'` member.
 */
/**
 * A URL as a LaTeX \\href argument: braces and backslashes removed (they end
 * the argument or start a command: `}\\input{...}` was possible), and % and #
 * escaped, which LaTeX would otherwise treat as a comment and a parameter.
 */
function latexUrl(url: string): string {
    return url.replace(/[{}\\\s]/g, '').replace(/%/g, '\\%').replace(/#/g, '\\#');
}

export type LatexTemplateType = ResumeTemplateId;
type LegacyLatexTemplateType = LatexTemplateType | 'modern-professional';

/**
 * `generateLatexFromResume`'s second argument is polymorphic for backward
 * compatibility: existing callers pass a template-id string, new callers pass a
 * full `ResumeTheme`. Both resolve to a concrete theme below.
 */
export type LatexThemeArg = LegacyLatexTemplateType | ResumeTheme;

function normalizeTemplateId(template: LegacyLatexTemplateType): ResumeTemplateId {
    if (template === 'modern-professional') {
        return 'modern';
    }
    return template;
}

function resolveTheme(arg: LatexThemeArg): ResumeTheme {
    if (typeof arg === 'string') {
        return { ...DEFAULT_RESUME_THEME, templateId: normalizeTemplateId(arg) };
    }
    return { ...DEFAULT_RESUME_THEME, ...arg, templateId: normalizeTemplateId(arg.templateId) };
}

// ---------------------------------------------------------------------------
// Theme → LaTeX mapping helpers
// ---------------------------------------------------------------------------

/** Convert a hex color (#RRGGBB or #RGB) to a LaTeX RGB triple "r, g, b". */
function hexToLatexRgb(hex: string): string {
    const fallback = '31, 78, 121'; // DEFAULT_RESUME_THEME accent
    if (!hex) return fallback;
    let value = hex.trim().replace(/^#/, '');
    if (value.length === 3) {
        value = value.split('').map((c) => c + c).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(value)) return fallback;
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `${r}, ${g}, ${b}`;
}

/** LaTeX font package setup for a given family. All families are PDF-embeddable. */
function fontPackages(family: ResumeFontFamily): string {
    switch (family) {
        case 'serif':
            // Default Computer Modern Roman / a clean serif via mathptmx-like setup.
            return '\\usepackage{charter}\n\\renewcommand{\\familydefault}{\\rmdefault}';
        case 'mono':
            return '\\usepackage[scaled=0.92]{beramono}\n\\renewcommand{\\familydefault}{\\ttdefault}';
        case 'sans':
        default:
            return '\\usepackage[default]{lato}\n\\renewcommand{\\familydefault}{\\sfdefault}';
    }
}

interface DensitySpec {
    margin: string; // geometry margin
    lineSpread: string; // \linespread argument
    itemSep: string; // itemize itemsep
    sectionGap: string; // gap above sections
}

function densitySpec(density: ResumeDensity): DensitySpec {
    switch (density) {
        case 'compact':
            return { margin: '0.7cm', lineSpread: '1.0', itemSep: '0pt', sectionGap: '0.5em' };
        case 'relaxed':
            return { margin: '1.6cm', lineSpread: '1.18', itemSep: '0.35em', sectionGap: '1.2em' };
        case 'normal':
        default:
            return { margin: '1cm', lineSpread: '1.08', itemSep: '0.15em', sectionGap: '0.8em' };
    }
}

export function generateLatexFromResume(data: ResumeData, themeArg: LatexThemeArg = 'ats-simple'): string {
    const theme = resolveTheme(themeArg);

    switch (theme.templateId) {
        case 'modern':
            return generateModernProfessionalTemplate(data, theme);
        case 'minimal':
            return generateMinimalTemplate(data, theme);
        case 'classic':
            return generateATSSimpleTemplate(data, { ...theme, templateId: 'classic' });
        case 'ats-simple':
        default:
            return generateATSSimpleTemplate(data, theme);
    }
}

function generateATSSimpleTemplate(data: ResumeData, theme: ResumeTheme = DEFAULT_RESUME_THEME): string {
    const { personalInfo, experience, projects, education, skills, sectionOrder } = data;
    const order = sectionOrder || ['summary', 'education', 'experience', 'projects', 'skills'];
    const skillGroups = groupSkills(skills);
    const accentRgb = hexToLatexRgb(theme.accentColor);
    const density = densitySpec(theme.density);

    const header = `\\documentclass[a4paper,10pt]{article}
\\usepackage[margin=${density.margin}]{geometry}
\\usepackage{parskip}
\\usepackage{enumitem}
\\usepackage{xcolor}
\\usepackage[hidelinks]{hyperref}
\\usepackage{titlesec}
\\usepackage{multicol}
\\usepackage{setspace}
${fontPackages(theme.fontFamily)}

\\definecolor{mainblue}{RGB}{${accentRgb}}
\\linespread{${density.lineSpread}}
\\hypersetup{
    colorlinks=true,
    linkcolor=mainblue,
    urlcolor=mainblue,
    citecolor=mainblue
}

\\titleformat{\\section}{\\color{mainblue}\\bfseries\\uppercase}{\\thesection}{1em}{}
\\titlespacing*{\\section}{0pt}{${density.sectionGap}}{0.3em}
\\renewcommand{\\labelitemi}{\\textbullet}
\\setlist[itemize]{noitemsep, topsep=0pt, itemsep=${density.itemSep}, left=0.5em}
\\pagestyle{empty}

\\begin{document}

\\begin{center}
    ${personalInfo.fullName ? `{\\LARGE \\textbf{${escapeLatex(personalInfo.fullName)}}}\\\\[4pt]` : ''}
    ${personalInfo.title ? `\\textit{${escapeLatex(personalInfo.title)}} \\\\` : ''}
    ${personalInfo.location ? `${escapeLatex(personalInfo.location)} \\\\` : ''}
    ${/*
        Built by the shared `contactParts` so the PDF and the live preview
        agree. The previous version did `https://` + the value with any scheme
        stripped, which turns a bare handle — plenty of people type `priyar`
        rather than `github.com/priyar` — into `https://priyar`, a link that
        404s from the top of their resume.
      */ ''}${contactParts(personalInfo)
        .filter((part) => part.label !== personalInfo.location?.trim())
        .map((part) =>
            part.href
                ? `\\href{${latexUrl(part.href)}}{${escapeLatex(part.label)}}`
                : escapeLatex(part.label)
        )
        .filter(Boolean)
        .join(' \\quad | \\quad ')}
\\end{center}

\\vspace{0.5em}
`;

    const sectionGenerators: Record<string, () => string> = {
        summary: () => {
            if (!personalInfo.summary) return '';
            return `\\section*{ABOUT ME}
${markdownToLatex(personalInfo.summary)}

`;
        },
        education: () => {
            if (education.length === 0) return '';
            return `\\section*{EDUCATION}
${education.map(edu => `\\textbf{${escapeLatex(edu.degree)} in ${escapeLatex(edu.fieldOfStudy)}} \\\\
\\textit{${escapeLatex(edu.institution)}} \\hfill \\textit{${formatDateLatex(edu.startDate)} -- ${edu.current ? 'Present' : formatDateLatex(edu.endDate)}}
`).join('\n\\vspace{0.3em}\n')}

`;
        },
        experience: () => {
            if (experience.length === 0) return '';
            return `\\section*{WORK EXPERIENCE}

${experience.map(exp => {
    const bullets = parseDescription(exp.description);
    return `\\textbf{${escapeLatex(exp.role)}} \\hfill \\textit{${escapeLatex(exp.company)}${exp.location ? `, ${escapeLatex(exp.location)}` : ''}} \\\\
\\textit{${formatDateLatex(exp.startDate)} -- ${exp.current ? 'Present' : formatDateLatex(exp.endDate)}}
${bullets.length > 0 ? `\\begin{itemize}
${bullets.map(bullet => `  \\item ${markdownToLatex(bullet)}`).join('\n')}
\\end{itemize}` : ''}
`;
}).join('\n')}

`;
        },
        projects: () => {
            if (projects.length === 0) return '';
            return `\\section*{PROJECTS}
${projects.map(proj => {
    const descLines = parseDescription(proj.description);
    const urls = resolveProjectUrls(proj);
    const liveHref = normalizeHref(urls.liveUrl);
    const repoHref = normalizeHref(urls.repoUrl);
    const linkParts = [
        liveHref ? `\\href{${liveHref}}{\\textcolor{mainblue}{[Live]}}` : '',
        repoHref ? `\\href{${repoHref}}{\\textcolor{mainblue}{[Repo]}}` : '',
    ].filter(Boolean).join(' \\; ');
    const urlPart = linkParts ? `\\hfill ${linkParts}` : '';
    return `\\noindent
\\textbf{${escapeLatex(proj.name)}}${urlPart} \\\\
\\vspace{-0.5em}
${descLines.length > 0 ? `\\begin{itemize}[leftmargin=1.5em, itemsep=0.25em, topsep=0pt]
${descLines.map(line => `  \\item ${markdownToLatex(line)}`).join('\n')}
\\end{itemize}` : markdownToLatex(proj.description)}
${proj.technologies.length > 0 ? `\\textit{Tech Stack: ${proj.technologies.map(t => escapeLatex(t)).join(', ')}}` : ''}

\\vspace{0.5em}
`;
}).join('\n')}

`;
        },
        skills: () => {
            if (skillGroups.length === 0) return '';
            return `\\section*{SKILLS}
${renderSkillsSection(skillGroups, 'simple')}

`;
        }
    };

    let body = '';
    for (const section of order) {
        const generator = sectionGenerators[section];
        if (generator) {
            body += generator();
        }
    }

    return header + body + '\\end{document}';
}

function generateModernProfessionalTemplate(data: ResumeData, theme: ResumeTheme = { ...DEFAULT_RESUME_THEME, templateId: 'modern' }): string {
    const { personalInfo, experience, projects, education, skills, sectionOrder } = data;
    const order = sectionOrder || ['summary', 'education', 'experience', 'projects', 'skills'];
    const skillGroups = groupSkills(skills);
    const accentRgb = hexToLatexRgb(theme.accentColor);
    const density = densitySpec(theme.density);

    const header = `\\documentclass[a4paper,10pt]{article}
\\usepackage[margin=${density.margin}]{geometry}
\\usepackage{parskip}
\\usepackage{enumitem}
\\usepackage{xcolor}
\\usepackage[hidelinks]{hyperref}
\\usepackage{titlesec}
\\usepackage{multicol}
\\usepackage{setspace}
\\usepackage{fontawesome5}
${fontPackages(theme.fontFamily)}

\\definecolor{accent}{RGB}{${accentRgb}}
\\definecolor{darktext}{RGB}{33, 33, 33}
\\definecolor{lighttext}{RGB}{100, 100, 100}
\\linespread{${density.lineSpread}}

\\hypersetup{
    colorlinks=true,
    linkcolor=accent,
    urlcolor=accent,
    citecolor=accent
}

\\titleformat{\\section}{\\large\\bfseries\\color{accent}}{\\thesection}{0em}{}[\\titlerule]
\\titlespacing*{\\section}{0pt}{${density.sectionGap}}{0.4em}
\\renewcommand{\\labelitemi}{\\textcolor{accent}{\\textbullet}}
\\setlist[itemize]{noitemsep, topsep=2pt, itemsep=${density.itemSep}, left=0.5em}
\\pagestyle{empty}

\\begin{document}

\\begin{center}
    ${personalInfo.fullName ? `{\\Huge \\textbf{\\color{darktext}${escapeLatex(personalInfo.fullName)}}}\\\\[6pt]` : ''}
    ${personalInfo.title ? `{\\large \\color{lighttext}${escapeLatex(personalInfo.title)}}\\\\[8pt]` : ''}
    ${(() => {
        const contactLine = [
            personalInfo.location ? `\\faMapMarker* ${escapeLatex(personalInfo.location)}` : '',
            personalInfo.email ? `\\faEnvelope\\ \\href{mailto:${personalInfo.email}}{${escapeLatex(personalInfo.email)}}` : '',
            personalInfo.phone ? `\\faPhone\\ ${escapeLatex(personalInfo.phone)}` : ''
        ].filter(Boolean).join(' \\quad ');
        return contactLine ? `{\\small \\color{lighttext} ${contactLine} }\\\\[4pt]` : '';
    })()}
    ${(() => {
        const socialLine = [
            personalInfo.github ? `\\faGithub\\ \\href{https://${personalInfo.github.replace(/^https?:\/\//, '')}}{GitHub}` : '',
            personalInfo.linkedin ? `\\faLinkedin\\ \\href{https://${personalInfo.linkedin.replace(/^https?:\/\//, '')}}{LinkedIn}` : '',
            personalInfo.website ? `\\faGlobe\\ \\href{https://${personalInfo.website.replace(/^https?:\/\//, '')}}{Portfolio}` : ''
        ].filter(Boolean).join(' \\quad ');
        return socialLine ? `{\\small \\color{lighttext} ${socialLine} }` : '';
    })()}
\\end{center}

\\vspace{0.5em}
`;

    const sectionGenerators: Record<string, () => string> = {
        summary: () => {
            if (!personalInfo.summary) return '';
            return `\\section*{Professional Summary}
{\\color{darktext}${markdownToLatex(personalInfo.summary)}}

`;
        },
        education: () => {
            if (education.length === 0) return '';
            return `\\section*{Education}
${education.map(edu => `{\\color{darktext}\\textbf{${escapeLatex(edu.degree)} in ${escapeLatex(edu.fieldOfStudy)}}} \\hfill {\\color{lighttext}${formatDateLatex(edu.startDate)} -- ${edu.current ? 'Present' : formatDateLatex(edu.endDate)}}\\\\
{\\color{lighttext}\\textit{${escapeLatex(edu.institution)}}}`).join('\n\n\\vspace{0.3em}\n\n')}

`;
        },
        experience: () => {
            if (experience.length === 0) return '';
            return `\\section*{Experience}

${experience.map(exp => {
    const bullets = parseDescription(exp.description);
    return `{\\color{darktext}\\textbf{${escapeLatex(exp.role)}}} \\hfill {\\color{lighttext}${formatDateLatex(exp.startDate)} -- ${exp.current ? 'Present' : formatDateLatex(exp.endDate)}}\\\\
{\\color{accent}${escapeLatex(exp.company)}}${exp.location ? ` {\\color{lighttext}| ${escapeLatex(exp.location)}}` : ''}
${bullets.length > 0 ? `\\begin{itemize}
${bullets.map(bullet => `  \\item {\\color{darktext}${markdownToLatex(bullet)}}`).join('\n')}
\\end{itemize}` : ''}`;
}).join('\n\n\\vspace{0.3em}\n\n')}

`;
        },
        projects: () => {
            if (projects.length === 0) return '';
            return `\\section*{Projects}
${projects.map(proj => {
    const descLines = parseDescription(proj.description);
    const urls = resolveProjectUrls(proj);
    const liveHref = normalizeHref(urls.liveUrl);
    const repoHref = normalizeHref(urls.repoUrl);
    const linkParts = [
        liveHref ? `\\href{${liveHref}}{\\textcolor{accent}{\\small Live}}` : '',
        repoHref ? `\\href{${repoHref}}{\\textcolor{accent}{\\small Repo}}` : '',
    ].filter(Boolean).join(' \\; ');
    const urlPart = linkParts ? `\\hfill ${linkParts}` : '';
    return `{\\color{darktext}\\textbf{${escapeLatex(proj.name)}}}${urlPart}
${descLines.length > 0 ? `\\begin{itemize}
${descLines.map(line => `  \\item {\\color{darktext}${markdownToLatex(line)}}`).join('\n')}
\\end{itemize}` : `{\\color{darktext}${markdownToLatex(proj.description)}}`}
${proj.technologies.length > 0 ? `{\\color{lighttext}\\small\\textit{${proj.technologies.map(t => escapeLatex(t)).join(' · ')}}}` : ''}`;
}).join('\n\n\\vspace{0.3em}\n\n')}

`;
        },
        skills: () => {
            if (skillGroups.length === 0) return '';
            return `\\section*{Skills}
${renderSkillsSection(skillGroups, 'modern')}

`;
        }
    };

    let body = '';
    for (const section of order) {
        const generator = sectionGenerators[section];
        if (generator) {
            body += generator();
        }
    }

    return header + body + '\\end{document}';
}

/**
 * Minimal / whitespace-forward template. Single column, no rules or lines, large
 * margins, accent used sparingly (name + section labels). Fully ATS-parseable:
 * selectable text, no images, no multi-column.
 */
function generateMinimalTemplate(data: ResumeData, theme: ResumeTheme = { ...DEFAULT_RESUME_THEME, templateId: 'minimal' }): string {
    const { personalInfo, experience, projects, education, skills, sectionOrder } = data;
    const order = sectionOrder || ['summary', 'education', 'experience', 'projects', 'skills'];
    const skillGroups = groupSkills(skills);
    const accentRgb = hexToLatexRgb(theme.accentColor);
    // Minimal leans on extra whitespace: bump the base margin for each density.
    const baseDensity = densitySpec(theme.density);
    const margin = theme.density === 'compact' ? '1.4cm' : theme.density === 'relaxed' ? '2.4cm' : '2cm';

    const header = `\\documentclass[a4paper,11pt]{article}
\\usepackage[margin=${margin}]{geometry}
\\usepackage{parskip}
\\usepackage{enumitem}
\\usepackage{xcolor}
\\usepackage[hidelinks]{hyperref}
\\usepackage{titlesec}
\\usepackage{setspace}
${fontPackages(theme.fontFamily)}

\\definecolor{accent}{RGB}{${accentRgb}}
\\definecolor{subtle}{RGB}{110, 110, 110}
\\linespread{${baseDensity.lineSpread}}

\\hypersetup{
    colorlinks=true,
    linkcolor=accent,
    urlcolor=accent,
    citecolor=accent
}

% No rules, generous spacing, small-caps accent section labels.
\\titleformat{\\section}{\\normalsize\\scshape\\color{accent}}{}{0em}{}
\\titlespacing*{\\section}{0pt}{1.6em}{0.6em}
\\renewcommand{\\labelitemi}{\\textendash}
\\setlist[itemize]{noitemsep, topsep=0pt, itemsep=${baseDensity.itemSep}, left=0.6em}
\\pagestyle{empty}

\\begin{document}

\\begin{flushleft}
    ${personalInfo.fullName ? `{\\LARGE ${escapeLatex(personalInfo.fullName)}}\\\\[2pt]` : ''}
    ${personalInfo.title ? `{\\color{subtle}${escapeLatex(personalInfo.title)}}\\\\[6pt]` : ''}
    {\\small\\color{subtle}${[
        personalInfo.location ? escapeLatex(personalInfo.location) : '',
        personalInfo.email ? `\\href{mailto:${personalInfo.email}}{${escapeLatex(personalInfo.email)}}` : '',
        personalInfo.phone ? escapeLatex(personalInfo.phone) : '',
        personalInfo.github ? `\\href{https://${personalInfo.github.replace(/^https?:\/\//, '')}}{GitHub}` : '',
        personalInfo.linkedin ? `\\href{https://${personalInfo.linkedin.replace(/^https?:\/\//, '')}}{LinkedIn}` : '',
        personalInfo.website ? `\\href{https://${personalInfo.website.replace(/^https?:\/\//, '')}}{Portfolio}` : '',
    ].filter(Boolean).join('  \\textperiodcentered{}  ')}}
\\end{flushleft}

\\vspace{0.6em}
`;

    const sectionGenerators: Record<string, () => string> = {
        summary: () => {
            if (!personalInfo.summary) return '';
            return `\\section*{About}
${markdownToLatex(personalInfo.summary)}

`;
        },
        education: () => {
            if (education.length === 0) return '';
            return `\\section*{Education}
${education.map(edu => `\\textbf{${escapeLatex(edu.degree)} in ${escapeLatex(edu.fieldOfStudy)}} \\hfill {\\color{subtle}\\small ${formatDateLatex(edu.startDate)} -- ${edu.current ? 'Present' : formatDateLatex(edu.endDate)}}\\\\
{\\color{subtle}${escapeLatex(edu.institution)}}`).join('\n\n\\vspace{0.4em}\n\n')}

`;
        },
        experience: () => {
            if (experience.length === 0) return '';
            return `\\section*{Experience}
${experience.map(exp => {
    const bullets = parseDescription(exp.description);
    return `\\textbf{${escapeLatex(exp.role)}}, ${escapeLatex(exp.company)}${exp.location ? `, ${escapeLatex(exp.location)}` : ''} \\hfill {\\color{subtle}\\small ${formatDateLatex(exp.startDate)} -- ${exp.current ? 'Present' : formatDateLatex(exp.endDate)}}
${bullets.length > 0 ? `\\begin{itemize}
${bullets.map(bullet => `  \\item ${markdownToLatex(bullet)}`).join('\n')}
\\end{itemize}` : ''}`;
}).join('\n\n\\vspace{0.5em}\n\n')}

`;
        },
        projects: () => {
            if (projects.length === 0) return '';
            return `\\section*{Projects}
${projects.map(proj => {
    const descLines = parseDescription(proj.description);
    const urls = resolveProjectUrls(proj);
    const liveHref = normalizeHref(urls.liveUrl);
    const repoHref = normalizeHref(urls.repoUrl);
    const linkParts = [
        liveHref ? `\\href{${liveHref}}{\\small Live}` : '',
        repoHref ? `\\href{${repoHref}}{\\small Repo}` : '',
    ].filter(Boolean).join(' \\textperiodcentered{} ');
    const urlPart = linkParts ? `\\hfill {\\color{accent}${linkParts}}` : '';
    return `\\textbf{${escapeLatex(proj.name)}}${urlPart}
${descLines.length > 0 ? `\\begin{itemize}
${descLines.map(line => `  \\item ${markdownToLatex(line)}`).join('\n')}
\\end{itemize}` : markdownToLatex(proj.description)}
${proj.technologies.length > 0 ? `{\\color{subtle}\\small\\textit{${proj.technologies.map(t => escapeLatex(t)).join(' \\textperiodcentered{} ')}}}` : ''}`;
}).join('\n\n\\vspace{0.5em}\n\n')}

`;
        },
        skills: () => {
            if (skillGroups.length === 0) return '';
            return `\\section*{Skills}
${renderSkillsSection(skillGroups, 'simple')}

`;
        }
    };

    let body = '';
    for (const section of order) {
        const generator = sectionGenerators[section];
        if (generator) {
            body += generator();
        }
    }

    return header + body + '\\end{document}';
}

export const TEMPLATE_OPTIONS: { value: LatexTemplateType; label: string; description: string }[] = [
    {
        value: 'ats-simple',
        label: 'ATS Simple',
        description: 'Clean, ATS-friendly format with traditional layout'
    },
    {
        value: 'modern',
        label: 'Modern Professional',
        description: 'Contemporary design with icons and accent colors'
    },
    {
        value: 'classic',
        label: 'Classic',
        description: 'Traditional single-column resume style focused on readability'
    },
    {
        value: 'minimal',
        label: 'Minimal',
        description: 'Whitespace-forward, no rules, generous margins'
    }
];

export const DEFAULT_LATEX_TEMPLATE = generateATSSimpleTemplate(initialResumeData);
