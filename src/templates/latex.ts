import {
    ResumeData,
    initialResumeData,
    ResumeTheme,
    ResumeTemplateId,
    DEFAULT_RESUME_THEME,
    DEFAULT_TEMPLATE_ID,
    ResumeFontFamily,
    ResumeDensity,
    ExperienceItem,
    RESUME_TEMPLATE_OPTIONS,
    defaultThemeFor,
} from '@/types/resume';
import { resolveSkillGroups } from '@/lib/resume/skillGroups';
import { contactLines, contactParts, displayUrl, projectLinks } from '@/lib/resume/contact';

/**
 * One pass over the text, so a replacement is never escaped again (the old
 * chain escaped the braces of its own \textbackslash{}, printing a stray
 * "{}").
 *
 * Unicode symbols that PDF text extraction produces (U+223C from a resume
 * written with a math-mode sim before "50%") have no glyph in the compile
 * engine's fonts and vanished silently, so "~50%" printed as " 50%". They
 * map to math mode.
 */
const LATEX_ESCAPES: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '&': '\\&',
    '%': '\\%',
    '$': '\\$',
    '#': '\\#',
    '_': '\\_',
    '{': '\\{',
    '}': '\\}',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}',
    '∼': '$\\sim$',
    '〜': '$\\sim$',
    '≈': '$\\approx$',
    '×': '$\\times$',
    '→': '$\\rightarrow$',
    '←': '$\\leftarrow$',
    '↔': '$\\leftrightarrow$',
    '≥': '$\\geq$',
    '≤': '$\\leq$',
    '±': '$\\pm$',
    'µ': '$\\mu$',
    'μ': '$\\mu$',
};

export function escapeLatex(text: string): string {
    if (!text) return '';
    return text.replace(/[\\&%$#_{}~^∼〜≈×→←↔≥≤±µμ]/g, (ch) => LATEX_ESCAPES[ch] ?? ch);
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

/** A date as printed. User text, so the result is escaped. */
function formatDateLatex(dateStr: string): string {
    return escapeLatex(formatDate(dateStr));
}

function formatDate(dateStr: string): string {
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
function groupSkills(data: Pick<ResumeData, 'skills' | 'skillGroups'>): SkillGroup[] {
    const cleaned: string[] = [];
    for (const rawSkill of data.skills) {
        const skill = normalizeSkillValue(rawSkill);
        if (shouldOmitSkill(skill)) continue;
        cleaned.push(skill);
    }
    // The resume's own rows when it has them ("Speech / AI: …"), else grouped.
    return resolveSkillGroups({ skills: cleaned, skillGroups: data.skillGroups });
}

/** "Software Engineer I | Go, C, Python": the title, and the stack printed with it. */
function roleLine(exp: { role: string; stack?: string }): string {
    const stack = exp.stack?.trim();
    return `${escapeLatex(exp.role)}${stack ? `{\\normalfont\\ $|$ ${escapeLatex(stack)}}` : ''}`;
}

/** "Plivo (established CPaaS, AI voice agents)": the company, and its tag line. */
function companyLine(exp: { company: string; companyNote?: string }): string {
    const note = exp.companyNote?.trim();
    return `${escapeLatex(exp.company)}${note ? ` {\\small (${escapeLatex(note)})}` : ''}`;
}

function renderSkillsSection(groups: SkillGroup[], style: 'simple' | 'modern'): string {
    if (groups.length === 0) return '';

    // An unlabelled row prints its skills alone, not after a stray colon.
    const label = (group: SkillGroup) =>
        group.label.trim() ? `\\textbf{${escapeLatex(group.label)}:} ` : '';

    if (style === 'modern') {
        return groups
            .map((group) => `{\\color{darktext}${label(group)}${group.skills.map((skill) => escapeLatex(skill)).join(' \\textbullet{} ')}}`)
            .join('\\\\[4pt]\n');
    }

    return groups
        .map((group) => `${label(group)}${group.skills.map((skill) => escapeLatex(skill)).join(', ')}`)
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
        // A bare id keeps the look that id always had: `'ats-simple'` is
        // still Lato, `'compact'` is Latin Modern.
        return defaultThemeFor(normalizeTemplateId(arg));
    }
    const templateId = normalizeTemplateId(arg.templateId);
    return { ...defaultThemeFor(templateId), ...arg, templateId };
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

export function generateLatexFromResume(data: ResumeData, themeArg: LatexThemeArg = DEFAULT_TEMPLATE_ID): string {
    const theme = resolveTheme(themeArg);

    switch (theme.templateId) {
        case 'compact':
            return generateCompactTemplate(data, theme);
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
    const { personalInfo, experience, projects, education, sectionOrder } = data;
    const order = sectionOrder || ['summary', 'education', 'experience', 'projects', 'skills'];
    const skillGroups = groupSkills(data);
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
    return `\\textbf{${roleLine(exp)}} \\hfill \\textit{${companyLine(exp)}${exp.location ? `, ${escapeLatex(exp.location)}` : ''}} \\\\
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
    const liveHref = latexUrl(normalizeHref(urls.liveUrl));
    const repoHref = latexUrl(normalizeHref(urls.repoUrl));
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
    const { personalInfo, experience, projects, education, sectionOrder } = data;
    const order = sectionOrder || ['summary', 'education', 'experience', 'projects', 'skills'];
    const skillGroups = groupSkills(data);
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
            personalInfo.email ? `\\faEnvelope\\ \\href{${latexUrl(`mailto:${personalInfo.email}`)}}{${escapeLatex(personalInfo.email)}}` : '',
            personalInfo.phone ? `\\faPhone\\ ${escapeLatex(personalInfo.phone)}` : ''
        ].filter(Boolean).join(' \\quad ');
        return contactLine ? `{\\small \\color{lighttext} ${contactLine} }\\\\[4pt]` : '';
    })()}
    ${(() => {
        const socialLine = [
            personalInfo.github ? `\\faGithub\\ \\href{${latexUrl(`https://${personalInfo.github.replace(/^https?:\/\//, '')}`)}}{GitHub}` : '',
            personalInfo.linkedin ? `\\faLinkedin\\ \\href{${latexUrl(`https://${personalInfo.linkedin.replace(/^https?:\/\//, '')}`)}}{LinkedIn}` : '',
            personalInfo.website ? `\\faGlobe\\ \\href{${latexUrl(`https://${personalInfo.website.replace(/^https?:\/\//, '')}`)}}{Portfolio}` : ''
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
    return `{\\color{darktext}\\textbf{${roleLine(exp)}}} \\hfill {\\color{lighttext}${formatDateLatex(exp.startDate)} -- ${exp.current ? 'Present' : formatDateLatex(exp.endDate)}}\\\\
{\\color{accent}${companyLine(exp)}}${exp.location ? ` {\\color{lighttext}| ${escapeLatex(exp.location)}}` : ''}
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
    const liveHref = latexUrl(normalizeHref(urls.liveUrl));
    const repoHref = latexUrl(normalizeHref(urls.repoUrl));
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
    const { personalInfo, experience, projects, education, sectionOrder } = data;
    const order = sectionOrder || ['summary', 'education', 'experience', 'projects', 'skills'];
    const skillGroups = groupSkills(data);
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
        personalInfo.email ? `\\href{${latexUrl(`mailto:${personalInfo.email}`)}}{${escapeLatex(personalInfo.email)}}` : '',
        personalInfo.phone ? escapeLatex(personalInfo.phone) : '',
        personalInfo.github ? `\\href{${latexUrl(`https://${personalInfo.github.replace(/^https?:\/\//, '')}`)}}{GitHub}` : '',
        personalInfo.linkedin ? `\\href{${latexUrl(`https://${personalInfo.linkedin.replace(/^https?:\/\//, '')}`)}}{LinkedIn}` : '',
        personalInfo.website ? `\\href{${latexUrl(`https://${personalInfo.website.replace(/^https?:\/\//, '')}`)}}{Portfolio}` : '',
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
    return `\\textbf{${roleLine(exp)}}, ${companyLine(exp)}${exp.location ? `, ${escapeLatex(exp.location)}` : ''} \\hfill {\\color{subtle}\\small ${formatDateLatex(exp.startDate)} -- ${exp.current ? 'Present' : formatDateLatex(exp.endDate)}}
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
    const liveHref = latexUrl(normalizeHref(urls.liveUrl));
    const repoHref = latexUrl(normalizeHref(urls.repoUrl));
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

// ---------------------------------------------------------------------------
// Compact (one page)
// ---------------------------------------------------------------------------

/**
 * Titles printed on one line when the role has at most one bullet:
 * "2Sigma School, SDE Intern. Built …            Mar – May 2024".
 */
const SHORT_ROLE_TITLE = /\b(?:intern|internship|trainee|apprentice|co-?op)\b/i;

/**
 * Whether the compact template prints this role as a one-line short role.
 * Exported so the live preview asks the same question as the PDF.
 */
export function isShortRole(exp: Pick<ExperienceItem, 'role' | 'description'>): boolean {
    return SHORT_ROLE_TITLE.test(exp.role ?? '') && parseDescription(exp.description ?? '').length <= 1;
}

/**
 * A date range as its printed parts, unescaped: ["Mar", "May 2024"] for two
 * dates in one year, one part when only one date is known, none for neither.
 */
export function dateRangeParts(start: string, end: string, current: boolean): string[] {
    const from = formatDate((start ?? '').trim());
    const to = current ? 'Present' : formatDate((end ?? '').trim());
    if (!from || !to) return [from || to].filter(Boolean);
    if (from === to) return [from];
    const a = from.match(/^([A-Za-z]{3,9}\.?)\s+(\d{4})$/);
    const b = to.match(/^([A-Za-z]{3,9}\.?)\s+(\d{4})$/);
    if (a && b && a[2] === b[2]) return [a[1], to];
    return [from, to];
}

/** The label printed for a project link: "repo", or the live site's own address when it is short. */
export function compactLinkLabel(link: { label: string; href: string }): string {
    if (link.label === 'Repo') return 'repo';
    const printed = displayUrl(link.href);
    if (printed && printed.length <= 28) return printed;
    return link.label === 'Live' ? 'live' : 'link';
}

interface CompactSpacing {
    geometry: string;
    lineSpread: string;
    sectionBefore: string;
    sectionAfter: string;
    /** Between entries (roles, projects). */
    entrySep: string;
    /** Between bullets, and above a bullet list. */
    bulletSep: string;
    bulletTop: string;
}

/** `normal` is the source resume's own spacing; the other two move around it. */
function compactSpacing(density: ResumeDensity): CompactSpacing {
    switch (density) {
        case 'compact':
            return {
                geometry: 'left=0.45in,right=0.45in,top=0.35in,bottom=0.3in',
                lineSpread: '0.98',
                sectionBefore: '7pt',
                sectionAfter: '3pt',
                entrySep: '3pt',
                bulletSep: '0.5pt',
                bulletTop: '1pt',
            };
        case 'relaxed':
            return {
                geometry: 'left=0.75in,right=0.75in,top=0.6in,bottom=0.55in',
                lineSpread: '1.05',
                sectionBefore: '13pt',
                sectionAfter: '6pt',
                entrySep: '8pt',
                bulletSep: '3pt',
                bulletTop: '3pt',
            };
        case 'normal':
        default:
            return {
                geometry: 'left=0.55in,right=0.55in,top=0.45in,bottom=0.4in',
                lineSpread: '1.0',
                sectionBefore: '10pt',
                sectionAfter: '5pt',
                entrySep: '5pt',
                bulletSep: '2pt',
                bulletTop: '2pt',
            };
    }
}

/** Latin Modern throughout; it sets narrower than Lato or Charter, which is most of the point. */
function compactFont(family: ResumeFontFamily): string {
    switch (family) {
        case 'sans':
            return '\\usepackage{lmodern}\n\\renewcommand{\\familydefault}{\\sfdefault}';
        case 'mono':
            return '\\usepackage{lmodern}\n\\usepackage[scaled=0.92]{beramono}\n\\renewcommand{\\familydefault}{\\ttdefault}';
        case 'serif':
        default:
            return '\\usepackage{lmodern}';
    }
}

/** "Plivo (established CPaaS, AI voice agents)", for inside \textbf: the tag line is not bold. */
function compactCompany(exp: Pick<ExperienceItem, 'company' | 'companyNote'>): string {
    const note = exp.companyNote?.trim();
    return `${escapeLatex(exp.company ?? '')}${note ? ` {\\normalfont\\small (${escapeLatex(note)})}` : ''}`;
}

/** "Software Engineer I | Go, C, Python". */
function compactRole(exp: Pick<ExperienceItem, 'role' | 'stack'>): string {
    return [exp.role?.trim(), exp.stack?.trim()]
        .filter((part): part is string => Boolean(part))
        .map(escapeLatex)
        .join(' $|$ ');
}

function compactDates(start: string, end: string, current: boolean): string {
    return dateRangeParts(start, end, current).map(escapeLatex).join(' -- ');
}

function compactShortRole(exp: ExperienceItem): string {
    const [line] = parseDescription(exp.description);
    const role = compactRole(exp);
    let left = `\\textbf{${compactCompany(exp)}}${role ? `, \\textit{${role}}` : ''}`;
    if (line) {
        // The last thing printed before the sentence, to avoid "Intern.." .
        const lastPrinted = exp.stack?.trim() || exp.role?.trim() || (exp.companyNote?.trim() ? ')' : exp.company?.trim() ?? '');
        left += `${/[.:;!?]$/.test(lastPrinted) ? '' : '.'} ${markdownToLatex(line)}`;
    }
    const right = [escapeLatex(exp.location?.trim() ?? ''), compactDates(exp.startDate, exp.endDate, exp.current)]
        .filter(Boolean)
        .join(' $|$ ');
    return `    \\resumeShortRole{${left}}{${right}}`;
}

function compactBullets(lines: string[], indent: string): string {
    if (lines.length === 0) return '';
    return `${indent}\\resumeItemListStart
${lines.map((line) => `${indent}  \\resumeItem{${markdownToLatex(line)}}`).join('\n')}
${indent}\\resumeItemListEnd
`;
}

/**
 * Compact: the whole resume on one page.
 *
 * Modelled on the owner's own LaTeX resume, which is built on Jake
 * Gutierrez's "Jake's Resume" (MIT): 10pt Latin Modern, half-inch margins,
 * company and place on one line with title and dates under it, bullets at a
 * 2pt pitch, internships on a single line each, and the project's stack on
 * its title line instead of a line of its own. The same content that runs to
 * two pages in `ats-simple` fits on one here, so the page-fit loop is not
 * left cutting project bullets to make it fit.
 *
 * One file, no \input: the compile service gets a single resource. Every
 * user string goes through `escapeLatex` or, for a link target, `latexUrl`.
 */
function generateCompactTemplate(data: ResumeData, theme: ResumeTheme = DEFAULT_RESUME_THEME): string {
    const { personalInfo, experience, projects, education, sectionOrder } = data;
    const order = sectionOrder || ['summary', 'education', 'experience', 'projects', 'skills'];
    const skillGroups = groupSkills(data);
    const accentRgb = hexToLatexRgb(theme.accentColor);
    const s = compactSpacing(theme.density);
    const name = personalInfo.fullName?.trim() ?? '';
    const pdfMeta = name ? `, pdfauthor={${escapeLatex(name)}}, pdftitle={${escapeLatex(name)} - Resume}` : '';

    const preamble = `% Compact (one page). Layout adapted from "Jake's Resume" by Jake Gutierrez
% (github.com/jakegut/resume), MIT License.
\\documentclass[a4paper,10pt]{article}
\\usepackage[a4paper,${s.geometry}]{geometry}
\\usepackage{latexsym}
\\usepackage{cmap}
\\usepackage[T1]{fontenc}
${compactFont(theme.fontFamily)}
\\usepackage{titlesec}
\\usepackage{xcolor}
\\usepackage{enumitem}
\\usepackage{tabularx}
\\usepackage{hyperref}

\\definecolor{mainblue}{RGB}{${accentRgb}}
\\hypersetup{colorlinks=true, linkcolor=mainblue, urlcolor=mainblue${pdfMeta}}

\\pagestyle{empty}
\\urlstyle{same}
\\raggedbottom
\\raggedright
\\setlength{\\tabcolsep}{0in}
\\linespread{${s.lineSpread}}

\\titleformat{\\section}{\\color{mainblue}\\bfseries\\normalsize}{}{0em}{\\MakeUppercase}
\\titlespacing*{\\section}{0pt}{${s.sectionBefore}}{${s.sectionAfter}}

% Real spaces between words in the PDF text, so ATS parsers read it cleanly.
\\ifdefined\\pdfinterwordspaceon\\pdfinterwordspaceon\\fi

% Left column wraps; the right one (place, dates, links) keeps its natural
% width up to 40% of the line, and wraps past that, so a long value can never
% squeeze the left column to nothing.
\\newcolumntype{L}{>{\\raggedright\\arraybackslash}X}
\\newlength{\\resumeRightWidth}
\\newcommand{\\resumeRight}[1]{%
  \\settowidth{\\resumeRightWidth}{#1}%
  \\ifdim\\resumeRightWidth>0.4\\textwidth
    \\parbox[t]{0.4\\textwidth}{\\raggedleft #1}%
  \\else
    #1%
  \\fi}

\\newcommand{\\resumeItem}[1]{\\item{#1}}

\\newcommand{\\resumeSubheading}[4]{%
  \\item
    \\begin{tabularx}{\\linewidth}[t]{@{}L@{\\hspace{1em}}r@{}}
      \\textbf{#1} & \\resumeRight{#2} \\\\
      \\textit{#3} & \\resumeRight{\\textit{#4}} \\\\
    \\end{tabularx}\\vspace{-3pt}%
}

\\newcommand{\\resumeOneLineHeading}[2]{%
  \\item
    \\begin{tabularx}{\\linewidth}[t]{@{}L@{\\hspace{1em}}r@{}}
      #1 & \\resumeRight{#2} \\\\
    \\end{tabularx}\\vspace{-3pt}%
}

% Short stints, one line each: org, role, what was done, dates.
\\newcommand{\\resumeShortRolesStart}{\\item}
\\newcommand{\\resumeShortRole}[2]{%
  \\begin{tabularx}{\\linewidth}[t]{@{}L@{\\hspace{1em}}r@{}}
    #1 & \\resumeRight{\\textit{#2}} \\\\
  \\end{tabularx}\\\\[1pt]}
\\newcommand{\\resumeShortRolesEnd}{\\vspace{1pt}}

\\newcommand{\\resumeProjectHeading}[2]{\\resumeOneLineHeading{#1}{#2}}

\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0pt, label={}, itemsep=${s.entrySep}, topsep=0pt]}
\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}
\\newcommand{\\resumeItemListStart}{\\begin{itemize}[leftmargin=1.2em, label=\\textbullet, itemsep=${s.bulletSep}, topsep=${s.bulletTop}, parsep=0pt]}
\\newcommand{\\resumeItemListEnd}{\\end{itemize}}

\\begin{document}
`;

    const { details, links } = contactLines(personalInfo);
    const contactPart = (part: { label: string; href?: string }) =>
        part.href ? `\\href{${latexUrl(part.href)}}{${escapeLatex(part.label)}}` : escapeLatex(part.label);
    const headerLines: Array<{ text: string; gap: string }> = [
        name ? { text: `{\\LARGE \\textbf{\\MakeUppercase{${escapeLatex(name)}}}}`, gap: '3pt' } : null,
        personalInfo.title?.trim() ? { text: `\\textit{${escapeLatex(personalInfo.title.trim())}}`, gap: '3pt' } : null,
        details.length ? { text: details.map(contactPart).join(' \\quad$|$\\quad '), gap: '2pt' } : null,
        links.length ? { text: links.map(contactPart).join(' \\quad$|$\\quad '), gap: '2pt' } : null,
    ].filter((line): line is { text: string; gap: string } => line !== null);
    const header = headerLines.length
        ? `\\begin{center}
${headerLines.map((line, i) => `    ${line.text}${i < headerLines.length - 1 ? ` \\\\[${line.gap}]` : ''}`).join('\n')}
\\end{center}
\\vspace{-6pt}

`
        : '';

    const experienceEntries = (): string => {
        const out: string[] = [];
        let shortRun: string[] = [];
        const flush = () => {
            if (shortRun.length === 0) return;
            out.push(`  \\resumeShortRolesStart
${shortRun.join('\n')}
  \\resumeShortRolesEnd
`);
            shortRun = [];
        };
        for (const exp of experience) {
            if (isShortRole(exp)) {
                shortRun.push(compactShortRole(exp));
                continue;
            }
            flush();
            out.push(`  \\resumeSubheading
    {${compactCompany(exp)}}{${escapeLatex(exp.location?.trim() ?? '')}}
    {${compactRole(exp)}}{${compactDates(exp.startDate, exp.endDate, exp.current)}}
${compactBullets(parseDescription(exp.description), '    ')}`);
        }
        flush();
        return out.join('\n');
    };

    const sectionGenerators: Record<string, () => string> = {
        summary: () => {
            if (!personalInfo.summary?.trim()) return '';
            return `\\section*{Summary}
${markdownToLatex(personalInfo.summary)}

`;
        },
        education: () => {
            if (education.length === 0) return '';
            return `\\section*{Education}
\\resumeSubHeadingListStart
${education.map((edu) => {
    const degree = [edu.degree?.trim(), edu.fieldOfStudy?.trim()].filter((part): part is string => Boolean(part)).map(escapeLatex).join(', ');
    const dates = compactDates(edu.startDate, edu.endDate, edu.current);
    if (!degree && !dates) {
        return `  \\resumeOneLineHeading{\\textbf{${escapeLatex(edu.institution ?? '')}}}{}`;
    }
    return `  \\resumeSubheading
    {${escapeLatex(edu.institution ?? '')}}{}
    {${degree}}{${dates}}`;
}).join('\n')}
\\resumeSubHeadingListEnd

`;
        },
        experience: () => {
            if (experience.length === 0) return '';
            return `\\section*{Experience}
\\resumeSubHeadingListStart
${experienceEntries()}
\\resumeSubHeadingListEnd

`;
        },
        projects: () => {
            if (projects.length === 0) return '';
            return `\\section*{Projects}
\\resumeSubHeadingListStart
${projects.map((proj) => {
    const technologies = proj.technologies.map((tech) => tech.trim()).filter(Boolean);
    const title = `\\textbf{${escapeLatex(proj.name ?? '')}}${technologies.length ? ` $|$ \\emph{${technologies.map(escapeLatex).join(', ')}}` : ''}`;
    const linkText = projectLinks(proj)
        .map((link) => `\\href{${latexUrl(link.href)}}{${escapeLatex(compactLinkLabel(link))}}`)
        .join(' $|$ ');
    return `  \\resumeProjectHeading
    {${title}}{${linkText}}
${compactBullets(parseDescription(proj.description), '    ')}`;
}).join('\n')}
\\resumeSubHeadingListEnd

`;
        },
        skills: () => {
            if (skillGroups.length === 0) return '';
            const rows = skillGroups.map((group) => {
                const items = group.skills.map(escapeLatex).join(', ');
                return group.label.trim() ? `\\textbf{${escapeLatex(group.label.trim())}}{: ${items}}` : items;
            });
            return `\\section*{Skills}
\\begin{itemize}[leftmargin=0pt, label={}, topsep=0pt, itemsep=0pt, parsep=0pt]
  \\item{
${rows.map((row, i) => `    ${row}${i < rows.length - 1 ? ' \\\\' : ''}`).join('\n')}
  }
\\end{itemize}

`;
        },
    };

    let body = '';
    for (const section of order) {
        const generator = sectionGenerators[section];
        if (generator) body += generator();
    }

    return preamble + header + body + '\\end{document}\n';
}

export const TEMPLATE_OPTIONS: { value: LatexTemplateType; label: string; description: string }[] = [...RESUME_TEMPLATE_OPTIONS];

export const DEFAULT_LATEX_TEMPLATE = generateLatexFromResume(initialResumeData, DEFAULT_RESUME_THEME);
