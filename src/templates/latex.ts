import {
    ResumeData,
    initialResumeData,
    ResumeTheme,
    ResumeTemplateId,
    CanonicalTemplateId,
    DEFAULT_RESUME_THEME,
    DEFAULT_TEMPLATE_ID,
    ResumeFontFamily,
    ResumeDensity,
    ExperienceItem,
    SectionType,
    RESUME_TEMPLATE_OPTIONS,
    canonicalTemplateId,
    defaultThemeFor,
} from '@/types/resume';
import { resolveSkillGroups } from '@/lib/resume/skillGroups';
import { contactLines, displayUrl, projectLinks } from '@/lib/resume/contact';

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
        // A bare id means that template in its own look: `'ats-simple'` is
        // Lato, `'compact'` Latin Modern, `'tech'` IBM Plex in teal.
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

export function generateLatexFromResume(data: ResumeData, themeArg: LatexThemeArg = DEFAULT_TEMPLATE_ID): string {
    const theme = resolveTheme(themeArg);
    const templateId = canonicalTemplateId(theme.templateId);
    if (templateId === 'compact') return generateCompactTemplate(data, theme);
    return generateDesignedTemplate(data, theme, DESIGNED_TEMPLATES[templateId]);
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

// ---------------------------------------------------------------------------
// The designed templates: Executive, Tech, Minimal and Simple (`ats-simple`)
// ---------------------------------------------------------------------------
//
// One body, four looks. The body below walks the resume once, escapes every
// user string once, and hands each template the escaped fields to arrange;
// a template only decides where a field goes and how it is set. So every
// template prints every field (the company's tag line, the role's stack, the
// skills rows with their own labels, a project's stack and links, internships
// on one line), and none of them can forget to escape one.
//
// What all four keep, because ATS parsers read the PDF's text layer:
// - one column, top to bottom; the right-hand cells (dates, places, links)
//   share a row with their left cell, so a parser reads "Plivo … Bengaluru";
// - real text: no icon fonts, no images, links printed as their addresses;
// - standard section names (Summary, Experience, Projects, Education, Skills);
// - no letterspacing: tracked capitals extract as "E X P E R I E N C E";
// - glyphs mapped to Unicode (`cmap`, T1), so "fi" extracts as "fi";
// - no pdfTeX fake spaces (`\pdfinterwordspaceon`, which compact uses with
//   Latin Modern): in Libertinus, Plex, Charter and Bera a fake space after
//   a symbol drew a box or swallowed the gap ("•+91", "×←+2" in the text),
//   while plain word gaps extract as spaces in every face here.

/** A role's fields, every one escaped. Empty strings for fields the role does not have. */
interface RoleFields {
    company: string;
    note: string;
    location: string;
    role: string;
    stack: string;
    dates: string;
}

/** Two cells per row, two rows: the heading of a role or a degree. */
interface TwoRows {
    l1: string;
    r1: string;
    l2: string;
    r2: string;
}

/** One row: a project's title, a short role, a degree without a second line. */
interface OneRow {
    left: string;
    right: string;
}

interface HeaderFields {
    name: string;
    title: string;
    /** Place, phone, email, each ready to print (the email as a link). */
    details: string[];
    /** LinkedIn, GitHub, site, printed as their addresses. */
    links: string[];
}

interface DesignedSpacing {
    geometry: string;
    lineSpread: string;
    sectionBefore: string;
    sectionAfter: string;
    /** Between roles, projects, degrees. */
    entrySep: string;
    /** Between bullets, and above a bullet list. */
    bulletSep: string;
    bulletTop: string;
    /** Pulls a bullet list up under its heading rows (tabular rows carry a strut). */
    headingPull: string;
}

interface DesignedTemplate {
    /** The first line of the file: what this is, and whose conventions it borrows. */
    comment: string;
    fonts: (family: ResumeFontFamily) => string;
    /** \definecolor lines; `accent` is defined by the body from the theme. */
    colors: string;
    /** hyperref's link colour: a defined colour name. */
    linkColor: string;
    /** \titleformat for \section. */
    sectionFormat: string;
    bulletLabel: string;
    bulletIndent: string;
    spacing: (density: ResumeDensity) => DesignedSpacing;
    /**
     * Skills as a two-column table (labels in one column, so the rows line
     * up) rather than one "Label: items" line per row. A label too long for a
     * column falls back to lines.
     */
    skillsTable: boolean;
    header: (fields: HeaderFields) => string;
    titles: Record<SectionType, string>;
    role: (fields: RoleFields) => TwoRows;
    /** `sentence` is the role's one line, as LaTeX, or empty; `exp` is the raw role, for punctuation. */
    shortRole: (fields: RoleFields, sentence: string, exp: ExperienceItem) => OneRow;
    project: (name: string, stack: string, links: string[]) => OneRow;
    education: (institution: string, degree: string, dates: string) => TwoRows | OneRow;
    /** The label of a "Label: items" skills line; `label` is escaped and not empty. */
    skillLabel: (label: string) => string;
}

/**
 * A date range as the designed templates print it, unescaped: both ends in
 * full (["Mar 2024", "May 2024"]), because a parser reading "Mar -- May
 * 2024" can take the start for a month with no year. Exported so the live
 * preview prints the same dates as the PDF.
 */
export function fullDateRangeParts(start: string, end: string, current: boolean): string[] {
    const from = formatDate((start ?? '').trim());
    const to = current ? 'Present' : formatDate((end ?? '').trim());
    if (from && to && from === to) return [from];
    return [from, to].filter(Boolean);
}

function fullDateRange(start: string, end: string, current: boolean): string {
    return fullDateRangeParts(start, end, current).map(escapeLatex).join(' -- ');
}

const DEFAULT_SECTION_ORDER: SectionType[] = ['summary', 'education', 'experience', 'projects', 'skills'];

/** The row macros every designed template shares; spacing comes from the template. */
function designedRowMacros(t: DesignedTemplate, s: DesignedSpacing): string {
    return `% Left cells wrap; a right cell keeps its natural width up to 40% of the
% line and wraps past that, so a long place or date never crushes the left.
\\newcolumntype{L}{>{\\raggedright\\arraybackslash}X}
\\newlength{\\resumeRightWidth}
\\newcommand{\\resumeRight}[1]{%
  \\settowidth{\\resumeRightWidth}{#1}%
  \\ifdim\\resumeRightWidth>0.4\\textwidth
    \\parbox[t]{0.4\\textwidth}{\\raggedleft #1}%
  \\else
    #1%
  \\fi}
\\newcommand{\\resumeEntry}[4]{%
  \\item
  \\begin{tabularx}{\\linewidth}[t]{@{}L@{\\hspace{1em}}r@{}}
    #1 & \\resumeRight{#2} \\\\
    #3 & \\resumeRight{#4} \\\\
  \\end{tabularx}\\vspace{${s.headingPull}}}
\\newcommand{\\resumeLine}[2]{%
  \\item
  \\begin{tabularx}{\\linewidth}[t]{@{}L@{\\hspace{1em}}r@{}}
    #1 & \\resumeRight{#2} \\\\
  \\end{tabularx}\\vspace{${s.headingPull}}}
% Internships and other short stints: one line each, in one block.
\\newcommand{\\resumeShortRolesStart}{\\item}
\\newcommand{\\resumeShortRole}[2]{%
  \\begin{tabularx}{\\linewidth}[t]{@{}L@{\\hspace{1em}}r@{}}
    #1 & \\resumeRight{#2} \\\\
  \\end{tabularx}\\\\[1pt]}
\\newcommand{\\resumeShortRolesEnd}{}
\\newenvironment{resumeEntries}{\\begin{itemize}[leftmargin=0pt, label={}, itemsep=${s.entrySep}, topsep=0pt, parsep=0pt, partopsep=0pt]}{\\end{itemize}}
\\newenvironment{resumeBullets}{\\begin{itemize}[leftmargin=${t.bulletIndent}, label=${t.bulletLabel}, itemsep=${s.bulletSep}, topsep=${s.bulletTop}, parsep=0pt, partopsep=0pt]}{\\end{itemize}}
% Skills: one "Label: items" line per row, or a table with the labels in a column.
\\newenvironment{resumeSkillLines}{\\begin{itemize}[leftmargin=0pt, label={}, itemsep=1pt, topsep=0pt, parsep=0pt, partopsep=0pt]}{\\end{itemize}}
\\newcommand{\\resumeSkillLine}[1]{\\item #1}
\\newenvironment{resumeSkillTable}{\\tabularx{\\linewidth}{@{}>{\\bfseries}l@{\\hspace{1em}}L@{}}}{\\endtabularx}
\\newcommand{\\resumeSkillRow}[2]{#1 & #2 \\\\[1pt]}`;
}

function designedPreamble(t: DesignedTemplate, theme: ResumeTheme, name: string): string {
    const s = t.spacing(theme.density);
    const pdfMeta = name ? `, pdfauthor={${escapeLatex(name)}}, pdftitle={${escapeLatex(name)} - Resume}` : '';
    return `% ${t.comment}
\\documentclass[a4paper,10pt]{article}
\\usepackage[a4paper,${s.geometry}]{geometry}
\\usepackage{cmap}
\\usepackage[T1]{fontenc}
${t.fonts(theme.fontFamily)}
\\usepackage{microtype}
\\usepackage{titlesec}
\\usepackage{xcolor}
\\usepackage{enumitem}
\\usepackage{tabularx}
\\usepackage{hyperref}

\\definecolor{accent}{RGB}{${hexToLatexRgb(theme.accentColor)}}
${t.colors}
\\hypersetup{colorlinks=true, linkcolor=${t.linkColor}, urlcolor=${t.linkColor}${pdfMeta}}

\\pagestyle{empty}
\\urlstyle{same}
\\raggedbottom
\\raggedright
\\setlength{\\parindent}{0pt}
\\setlength{\\tabcolsep}{0in}
\\linespread{${s.lineSpread}}

${t.sectionFormat}
\\titlespacing*{\\section}{0pt}{${s.sectionBefore}}{${s.sectionAfter}}

${designedRowMacros(t, s)}

\\begin{document}
`;
}

function designedBullets(lines: string[]): string {
    if (lines.length === 0) return '';
    return `    \\begin{resumeBullets}
${lines.map((line) => `      \\item ${markdownToLatex(line)}`).join('\n')}
    \\end{resumeBullets}
`;
}

function rowsMacro(rows: TwoRows | OneRow): string {
    return 'l1' in rows
        ? `  \\resumeEntry{${rows.l1}}{${rows.r1}}{${rows.l2}}{${rows.r2}}\n`
        : `  \\resumeLine{${rows.left}}{${rows.right}}\n`;
}

function roleFields(exp: ExperienceItem): RoleFields {
    const field = (value: string | undefined) => escapeLatex((value ?? '').trim());
    return {
        company: field(exp.company),
        note: field(exp.companyNote),
        location: field(exp.location),
        role: field(exp.role),
        stack: field(exp.stack),
        dates: fullDateRange(exp.startDate, exp.endDate, exp.current),
    };
}

/**
 * The full stop between a short role's heading and its sentence ("SDE
 * Intern. Built …"), or none when the last thing printed already ends one
 * ("Intern." would print "Intern.."). Exported for the live preview.
 */
export function sentenceStop(lastPrinted: string): string {
    return /[.:;!?]$/.test(lastPrinted.trim()) ? '' : '.';
}

function withSentence(last: string, sentence: string): string {
    return sentence ? `${sentenceStop(last)} ${sentence}` : '';
}

/** The field a company-first short role prints last, before its sentence. Exported for the live preview. */
export function lastOfCompanyFirst(exp: Pick<ExperienceItem, 'company' | 'companyNote' | 'role' | 'stack'>): string {
    return exp.stack?.trim() || exp.role?.trim() || (exp.companyNote?.trim() ? ')' : exp.company?.trim() ?? '');
}

function generateDesignedTemplate(data: ResumeData, theme: ResumeTheme, t: DesignedTemplate): string {
    const { personalInfo, experience, projects, education } = data;
    const order = data.sectionOrder || DEFAULT_SECTION_ORDER;
    const name = personalInfo.fullName?.trim() ?? '';

    const { details, links } = contactLines(personalInfo);
    const contactPart = (part: { label: string; href?: string }) =>
        part.href ? `\\href{${latexUrl(part.href)}}{${escapeLatex(part.label)}}` : escapeLatex(part.label);
    const header = t.header({
        name: escapeLatex(name),
        title: escapeLatex(personalInfo.title?.trim() ?? ''),
        details: details.map(contactPart),
        links: links.map(contactPart),
    });

    const experienceEntries = (): string => {
        const out: string[] = [];
        let shortRun: string[] = [];
        const flush = () => {
            if (shortRun.length === 0) return;
            out.push(`  \\resumeShortRolesStart\n${shortRun.join('\n')}\n  \\resumeShortRolesEnd\n`);
            shortRun = [];
        };
        for (const exp of experience) {
            if (isShortRole(exp)) {
                const [line] = parseDescription(exp.description);
                const row = t.shortRole(roleFields(exp), line ? markdownToLatex(line) : '', exp);
                shortRun.push(`    \\resumeShortRole{${row.left}}{${row.right}}`);
                continue;
            }
            flush();
            out.push(rowsMacro(t.role(roleFields(exp))) + designedBullets(parseDescription(exp.description)));
        }
        flush();
        return out.join('');
    };

    const sections: Record<SectionType, () => string> = {
        summary: () => {
            if (!personalInfo.summary?.trim()) return '';
            return `\\section*{${t.titles.summary}}\n${markdownToLatex(personalInfo.summary)}\n\n`;
        },
        experience: () => {
            if (experience.length === 0) return '';
            return `\\section*{${t.titles.experience}}\n\\begin{resumeEntries}\n${experienceEntries()}\\end{resumeEntries}\n\n`;
        },
        projects: () => {
            if (projects.length === 0) return '';
            const entries = projects.map((proj) => {
                const stack = proj.technologies.map((tech) => tech.trim()).filter(Boolean).map(escapeLatex).join(', ');
                const projectHrefs = projectLinks(proj).map(
                    (link) => `\\href{${latexUrl(link.href)}}{${escapeLatex(compactLinkLabel(link))}}`,
                );
                return rowsMacro(t.project(escapeLatex(proj.name?.trim() ?? ''), stack, projectHrefs))
                    + designedBullets(parseDescription(proj.description));
            });
            return `\\section*{${t.titles.projects}}\n\\begin{resumeEntries}\n${entries.join('')}\\end{resumeEntries}\n\n`;
        },
        education: () => {
            if (education.length === 0) return '';
            const entries = education.map((edu) => {
                const degree = [edu.degree?.trim(), edu.fieldOfStudy?.trim()]
                    .filter((part): part is string => Boolean(part))
                    .map(escapeLatex)
                    .join(', ');
                return rowsMacro(t.education(escapeLatex(edu.institution?.trim() ?? ''), degree, fullDateRange(edu.startDate, edu.endDate, edu.current)));
            });
            return `\\section*{${t.titles.education}}\n\\begin{resumeEntries}\n${entries.join('')}\\end{resumeEntries}\n\n`;
        },
        skills: () => {
            const groups = groupSkills(data);
            if (groups.length === 0) return '';
            const rows = groups.map((group) => ({ label: escapeLatex(group.label.trim()), items: group.skills.map(escapeLatex).join(', ') }));
            const asTable = t.skillsTable && groups.every((group) => group.label.trim().length <= MAX_TABLE_SKILL_LABEL);
            const lines = asTable
                // The colon stays in the table too, so the extracted text reads "Languages: Python".
                ? rows.map((row) => `  \\resumeSkillRow{${row.label ? `${row.label}:` : ''}}{${row.items}}`)
                : rows.map((row) => `  \\resumeSkillLine{${row.label ? t.skillLabel(row.label) : ''}${row.items}}`);
            const env = asTable ? 'resumeSkillTable' : 'resumeSkillLines';
            return `\\section*{${t.titles.skills}}\n\\begin{${env}}\n${lines.join('\n')}\n\\end{${env}}\n\n`;
        },
    };

    let body = '';
    for (const section of order) {
        const generator = sections[section];
        if (generator) body += generator();
    }
    return designedPreamble(t, theme, name) + header + body + '\\end{document}\n';
}

/** "Software Engineer I | Go, C, Python", with the separator each template uses. */
function joinPresent(parts: string[], separator: string): string {
    return parts.filter(Boolean).join(separator);
}

/** A header line of contact parts, or nothing when there are none. */
function contactRow(parts: string[], separator: string, format: string, gap: string): string {
    // A separator is "space, kern, mark, kern, space": the spaces are where a
    // long line may break, and `\enspace{}` keeps the space after it, which a
    // bare `\enspace ` would swallow as the end of its name.
    return parts.length ? `{${format} ${parts.join(separator)}}\\\\[${gap}]\n` : '';
}

/** Ends a header block on its last line, not on a line break that would leave a blank gap (and a TeX warning) under it. */
function trimTrailingBreak(lines: string): string {
    return lines.replace(/\\\\\[[^\]]*\]\n$/, '\n');
}

const STANDARD_TITLES: Record<SectionType, string> = {
    summary: 'Summary',
    experience: 'Experience',
    projects: 'Projects',
    education: 'Education',
    skills: 'Skills',
};

/** A skills label longer than this would squeeze a table's items column; the rows print as lines instead. */
const MAX_TABLE_SKILL_LABEL = 24;

/** "Languages: " in bold. */
const boldSkillLabel = (label: string) => `\\textbf{${label}}: `;

// ── Executive ────────────────────────────────────────────────────────────────

/**
 * Executive: Libertinus Serif, a centred small-caps name, small-caps section
 * headings over a hairline rule, the title of each role before the company.
 * Libertinus sets narrower than Latin Modern, which buys the extra leading
 * and margin without losing the one page.
 */
const EXECUTIVE: DesignedTemplate = {
    comment: 'Executive. Patronus original design; Libertinus fonts (SIL Open Font License).',
    fonts: (family) => {
        switch (family) {
            case 'sans':
                return '\\usepackage{libertinus}\n\\renewcommand{\\familydefault}{\\sfdefault}';
            case 'mono':
                return '\\usepackage{libertinus}\n\\renewcommand{\\familydefault}{\\ttdefault}';
            case 'serif':
            default:
                return '\\usepackage{libertinus}';
        }
    },
    colors: '\\definecolor{ink}{RGB}{26, 26, 26}',
    linkColor: 'accent',
    sectionFormat: '\\titleformat{\\section}{\\color{accent}\\large\\scshape}{}{0em}{}[{\\color{accent}\\titlerule[0.4pt]}]',
    bulletLabel: '{\\small\\textbullet}',
    bulletIndent: '1.1em',
    spacing: (density) => {
        switch (density) {
            case 'compact':
                return { geometry: 'left=0.55in,right=0.55in,top=0.4in,bottom=0.35in', lineSpread: '1.0', sectionBefore: '7pt', sectionAfter: '3pt', entrySep: '4pt', bulletSep: '0.5pt', bulletTop: '1pt', headingPull: '-4pt' };
            case 'relaxed':
                return { geometry: 'left=0.85in,right=0.85in,top=0.7in,bottom=0.6in', lineSpread: '1.1', sectionBefore: '14pt', sectionAfter: '6pt', entrySep: '9pt', bulletSep: '2.5pt', bulletTop: '3pt', headingPull: '-2pt' };
            case 'normal':
            default:
                return { geometry: 'left=0.65in,right=0.65in,top=0.5in,bottom=0.45in', lineSpread: '1.02', sectionBefore: '9pt', sectionAfter: '4pt', entrySep: '6pt', bulletSep: '1.5pt', bulletTop: '2pt', headingPull: '-3pt' };
        }
    },
    skillsTable: false,
    header: ({ name, title, details, links }) => {
        const sep = ' \\enspace\\textperiodcentered\\enspace{} ';
        const lines = [
            name ? `{\\fontsize{24}{28}\\selectfont\\color{ink}\\scshape ${name}}\\\\[5pt]\n` : '',
            title ? `{\\itshape ${title}}\\\\[4pt]\n` : '',
            contactRow(details, sep, '\\small', '1pt'),
            contactRow(links, sep, '\\small', '1pt'),
        ].join('');
        return lines ? `\\begin{center}\n${trimTrailingBreak(lines)}\\end{center}\n\\vspace{-4pt}\n\n` : '';
    },
    titles: STANDARD_TITLES,
    role: (f) => ({
        l1: `\\textbf{${f.role}}${f.stack ? ` {\\small\\textbar{} ${f.stack}}` : ''}`,
        r1: f.dates,
        l2: `\\textsc{${f.company}}${f.note ? ` {\\small\\itshape (${f.note})}` : ''}`,
        r2: f.location ? `\\textit{${f.location}}` : '',
    }),
    shortRole: (f, sentence, exp) => ({
        left: `${f.role ? `\\textbf{${f.role}}` : ''}${f.stack ? ` {\\small\\textbar{} ${f.stack}}` : ''}${f.role || f.stack ? ', ' : ''}\\textsc{${f.company}}${f.note ? ` {\\small\\itshape (${f.note})}` : ''}${withSentence(exp.companyNote?.trim() ? ')' : exp.company ?? '', sentence)}`,
        right: joinPresent([f.location ? `\\textit{${f.location}}` : '', f.dates], ' \\textbar{} '),
    }),
    project: (name, stack, links) => ({
        left: `\\textbf{${name}}${stack ? ` {\\small\\textbar{} \\textit{${stack}}}` : ''}`,
        right: links.length ? `{\\small ${links.join(' \\textbar{} ')}}` : '',
    }),
    education: (institution, degree, dates) =>
        degree
            ? { l1: `\\textbf{${degree}}`, r1: dates, l2: `\\textsc{${institution}}`, r2: '' }
            : { left: `\\textsc{${institution}}`, right: dates },
    skillLabel: boldSkillLabel,
};

// ── Tech ─────────────────────────────────────────────────────────────────────

/**
 * Tech: IBM Plex Sans, a left-aligned header with the title in the accent,
 * uppercase section labels with a light rule running to the margin, and the
 * skills as a two-column table so the labels line up.
 */
const TECH: DesignedTemplate = {
    comment: 'Tech. Patronus original design; IBM Plex fonts (SIL Open Font License).',
    fonts: (family) => {
        switch (family) {
            case 'serif':
                return '\\usepackage{plex-serif}';
            case 'mono':
                return '\\usepackage{plex-mono}\n\\renewcommand{\\familydefault}{\\ttdefault}';
            case 'sans':
            default:
                return '\\usepackage[sfdefault]{plex-sans}';
        }
    },
    colors: '\\definecolor{ink}{RGB}{17, 24, 39}\n\\definecolor{muted}{RGB}{75, 85, 99}\n\\definecolor{hairline}{RGB}{209, 213, 219}',
    linkColor: 'accent',
    sectionFormat: `\\newcommand{\\techSection}[1]{\\MakeUppercase{#1}\\hspace{0.6em}{\\color{hairline}\\leaders\\hrule height 3.4pt depth -2.8pt\\hfill}\\kern0pt}
\\titleformat{\\section}[block]{\\color{accent}\\small\\bfseries}{}{0em}{\\techSection}`,
    bulletLabel: '{\\color{accent}\\textbullet}',
    bulletIndent: '1.1em',
    spacing: (density) => {
        switch (density) {
            case 'compact':
                return { geometry: 'left=0.5in,right=0.5in,top=0.4in,bottom=0.35in', lineSpread: '0.98', sectionBefore: '7pt', sectionAfter: '3pt', entrySep: '4pt', bulletSep: '0.5pt', bulletTop: '1pt', headingPull: '-4pt' };
            case 'relaxed':
                return { geometry: 'left=0.8in,right=0.8in,top=0.65in,bottom=0.6in', lineSpread: '1.08', sectionBefore: '14pt', sectionAfter: '6pt', entrySep: '9pt', bulletSep: '2.5pt', bulletTop: '3pt', headingPull: '-2pt' };
            case 'normal':
            default:
                return { geometry: 'left=0.6in,right=0.6in,top=0.5in,bottom=0.45in', lineSpread: '1.0', sectionBefore: '10pt', sectionAfter: '4pt', entrySep: '6pt', bulletSep: '1.5pt', bulletTop: '2pt', headingPull: '-3pt' };
        }
    },
    skillsTable: true,
    header: ({ name, title, details, links }) => {
        const sep = ' \\textcolor{hairline}{\\textbar} ';
        const lines = [
            name ? `{\\fontsize{22}{26}\\selectfont\\bfseries\\color{ink} ${name}}\\\\[3pt]\n` : '',
            title ? `{\\large\\color{accent} ${title}}\\\\[5pt]\n` : '',
            contactRow(details, sep, '\\small\\color{muted}', '1pt'),
            contactRow(links, sep, '\\small\\color{muted}', '1pt'),
        ].join('');
        return lines ? `{\\raggedright\n${trimTrailingBreak(lines)}\\par}\n\\vspace{-2pt}\n\n` : '';
    },
    titles: STANDARD_TITLES,
    role: (f) => ({
        l1: `\\textbf{${f.company}}${f.note ? ` {\\small\\color{muted}(${f.note})}` : ''}`,
        r1: `\\textcolor{muted}{${f.dates}}`,
        l2: `\\textcolor{accent}{${f.role}}${f.stack ? ` \\textcolor{muted}{\\textbar{} ${f.stack}}` : ''}`,
        r2: f.location ? `\\textcolor{muted}{${f.location}}` : '',
    }),
    shortRole: (f, sentence, exp) => ({
        left: `\\textbf{${f.company}}${f.note ? ` {\\small\\color{muted}(${f.note})}` : ''}${f.role || f.stack ? `, \\textcolor{accent}{${joinPresent([f.role, f.stack], ' \\textbar{} ')}}` : ''}${withSentence(lastOfCompanyFirst(exp), sentence)}`,
        right: `\\textcolor{muted}{${joinPresent([f.location, f.dates], ' \\textbar{} ')}}`,
    }),
    project: (name, stack, links) => ({
        left: `\\textbf{${name}}${stack ? ` \\textcolor{muted}{\\textbar{} ${stack}}` : ''}`,
        right: links.join(' \\textcolor{hairline}{\\textbar} '),
    }),
    education: (institution, degree, dates) =>
        degree
            ? { l1: `\\textbf{${institution}}`, r1: `\\textcolor{muted}{${dates}}`, l2: degree, r2: '' }
            : { left: `\\textbf{${institution}}`, right: `\\textcolor{muted}{${dates}}` },
    skillLabel: boldSkillLabel,
};

// ── Minimal ──────────────────────────────────────────────────────────────────

/**
 * Minimal: Source Sans, hierarchy from size and weight alone. A large light
 * name, bold sentence-case headings, no rules, greys for everything
 * secondary, en dashes for bullets. The accent is used only for the name.
 */
const MINIMAL: DesignedTemplate = {
    comment: 'Minimal. Patronus original design; Source Sans and Source Serif (SIL Open Font License).',
    fonts: (family) => {
        switch (family) {
            case 'serif':
                return '\\usepackage{sourceserifpro}';
            case 'mono':
                return '\\usepackage[scaled=0.9]{beramono}\n\\renewcommand{\\familydefault}{\\ttdefault}';
            case 'sans':
            default:
                return '\\usepackage[default]{sourcesanspro}';
        }
    },
    colors: '\\definecolor{ink}{RGB}{17, 24, 39}\n\\definecolor{muted}{RGB}{75, 85, 99}',
    linkColor: 'ink',
    sectionFormat: '\\titleformat{\\section}{\\color{ink}\\large\\bfseries}{}{0em}{}',
    bulletLabel: '{\\color{muted}\\textendash}',
    bulletIndent: '1em',
    spacing: (density) => {
        switch (density) {
            case 'compact':
                return { geometry: 'left=0.6in,right=0.6in,top=0.45in,bottom=0.4in', lineSpread: '1.0', sectionBefore: '9pt', sectionAfter: '2pt', entrySep: '5pt', bulletSep: '0.5pt', bulletTop: '1pt', headingPull: '-4pt' };
            case 'relaxed':
                return { geometry: 'left=0.95in,right=0.95in,top=0.8in,bottom=0.7in', lineSpread: '1.12', sectionBefore: '18pt', sectionAfter: '5pt', entrySep: '10pt', bulletSep: '2.5pt', bulletTop: '3pt', headingPull: '-2pt' };
            case 'normal':
            default:
                return { geometry: 'left=0.65in,right=0.65in,top=0.5in,bottom=0.4in', lineSpread: '1.02', sectionBefore: '10pt', sectionAfter: '3pt', entrySep: '6pt', bulletSep: '1pt', bulletTop: '2pt', headingPull: '-3pt' };
        }
    },
    skillsTable: false,
    header: ({ name, title, details, links }) => {
        const sep = ' \\enspace\\textcolor{muted}{/}\\enspace{} ';
        const lines = [
            name ? `{\\fontsize{26}{30}\\selectfont\\fontseries{l}\\selectfont\\color{accent} ${name}}\\\\[3pt]\n` : '',
            title ? `{\\large\\color{muted} ${title}}\\\\[5pt]\n` : '',
            contactRow(details, sep, '\\small', '1pt'),
            contactRow(links, sep, '\\small', '1pt'),
        ].join('');
        return lines ? `{\\raggedright\n${trimTrailingBreak(lines)}\\par}\n\n` : '';
    },
    titles: STANDARD_TITLES,
    role: (f) => ({
        l1: `\\textbf{${f.company}}${f.note ? ` \\textcolor{muted}{(${f.note})}` : ''}`,
        r1: f.location ? `\\textcolor{muted}{${f.location}}` : '',
        l2: joinPresent([f.role, f.stack ? `\\textcolor{muted}{${f.stack}}` : ''], ' \\textcolor{muted}{\\textbar} '),
        r2: `\\textcolor{muted}{${f.dates}}`,
    }),
    shortRole: (f, sentence, exp) => ({
        left: `\\textbf{${f.company}}${f.note ? ` \\textcolor{muted}{(${f.note})}` : ''}${f.role || f.stack ? `, ${joinPresent([f.role, f.stack], ' \\textbar{} ')}` : ''}${withSentence(lastOfCompanyFirst(exp), sentence)}`,
        right: `\\textcolor{muted}{${joinPresent([f.location, f.dates], ' \\textbar{} ')}}`,
    }),
    project: (name, stack, links) => ({
        left: `\\textbf{${name}}${stack ? ` \\textcolor{muted}{\\textbar{} ${stack}}` : ''}`,
        right: links.length ? `\\textcolor{muted}{${links.join(' \\textbar{} ')}}` : '',
    }),
    education: (institution, degree, dates) =>
        degree
            ? { l1: `\\textbf{${institution}}`, r1: '', l2: degree, r2: `\\textcolor{muted}{${dates}}` }
            : { left: `\\textbf{${institution}}`, right: `\\textcolor{muted}{${dates}}` },
    skillLabel: boldSkillLabel,
};

// ── Simple (ats-simple) ──────────────────────────────────────────────────────

/** The faces `ats-simple` has always used: Lato, Charter, Bera Mono. */
function simpleFonts(family: ResumeFontFamily): string {
    switch (family) {
        case 'serif':
            return '\\usepackage{charter}';
        case 'mono':
            return '\\usepackage[scaled=0.92]{beramono}\n\\renewcommand{\\familydefault}{\\ttdefault}';
        case 'sans':
        default:
            return '\\usepackage[default]{lato}\n\\renewcommand{\\familydefault}{\\sfdefault}';
    }
}

/**
 * Simple: what a careful applicant would make in a word processor. Lato,
 * black text, uppercase headings over a full-width rule; the accent colours
 * only the headings. Company first, as recruiters' portals expect.
 */
const SIMPLE: DesignedTemplate = {
    comment: 'Simple (ats-simple). Patronus original design; Lato (SIL Open Font License).',
    fonts: simpleFonts,
    colors: '\\definecolor{ink}{RGB}{0, 0, 0}',
    linkColor: 'ink',
    sectionFormat: '\\titleformat{\\section}{\\color{accent}\\normalsize\\bfseries}{}{0em}{\\MakeUppercase}[{\\color{ink}\\titlerule[0.6pt]}]',
    bulletLabel: '\\textbullet',
    bulletIndent: '1.2em',
    spacing: (density) => {
        switch (density) {
            case 'compact':
                return { geometry: 'left=0.5in,right=0.5in,top=0.4in,bottom=0.35in', lineSpread: '0.98', sectionBefore: '7pt', sectionAfter: '3pt', entrySep: '4pt', bulletSep: '0.5pt', bulletTop: '1pt', headingPull: '-4pt' };
            case 'relaxed':
                return { geometry: 'left=0.8in,right=0.8in,top=0.65in,bottom=0.6in', lineSpread: '1.08', sectionBefore: '13pt', sectionAfter: '6pt', entrySep: '9pt', bulletSep: '2.5pt', bulletTop: '3pt', headingPull: '-2pt' };
            case 'normal':
            default:
                return { geometry: 'left=0.6in,right=0.6in,top=0.5in,bottom=0.45in', lineSpread: '1.03', sectionBefore: '10pt', sectionAfter: '4pt', entrySep: '6pt', bulletSep: '1.5pt', bulletTop: '2pt', headingPull: '-3pt' };
        }
    },
    skillsTable: false,
    header: ({ name, title, details, links }) => {
        const sep = ' \\enspace\\textbar\\enspace{} ';
        const lines = [
            name ? `{\\LARGE\\bfseries ${name}}\\\\[4pt]\n` : '',
            title ? `${title}\\\\[3pt]\n` : '',
            contactRow(details, sep, '', '1pt'),
            contactRow(links, sep, '', '1pt'),
        ].join('');
        return lines ? `\\begin{center}\n${trimTrailingBreak(lines)}\\end{center}\n\\vspace{-6pt}\n\n` : '';
    },
    titles: STANDARD_TITLES,
    role: (f) => ({
        l1: `\\textbf{${f.company}}${f.note ? ` (${f.note})` : ''}`,
        r1: f.location,
        l2: `\\textit{${joinPresent([f.role, f.stack], ' \\textbar{} ')}}`,
        r2: `\\textit{${f.dates}}`,
    }),
    shortRole: (f, sentence, exp) => ({
        left: `\\textbf{${f.company}}${f.note ? ` (${f.note})` : ''}${f.role || f.stack ? `, \\textit{${joinPresent([f.role, f.stack], ' \\textbar{} ')}}` : ''}${withSentence(lastOfCompanyFirst(exp), sentence)}`,
        right: `\\textit{${joinPresent([f.location, f.dates], ' \\textbar{} ')}}`,
    }),
    project: (name, stack, links) => ({
        left: `\\textbf{${name}}${stack ? ` \\textbar{} \\textit{${stack}}` : ''}`,
        right: links.join(' \\textbar{} '),
    }),
    education: (institution, degree, dates) =>
        degree
            ? { l1: `\\textbf{${institution}}`, r1: '', l2: `\\textit{${degree}}`, r2: `\\textit{${dates}}` }
            : { left: `\\textbf{${institution}}`, right: `\\textit{${dates}}` },
    skillLabel: boldSkillLabel,
};

const DESIGNED_TEMPLATES: Record<Exclude<CanonicalTemplateId, 'compact'>, DesignedTemplate> = {
    executive: EXECUTIVE,
    tech: TECH,
    minimal: MINIMAL,
    'ats-simple': SIMPLE,
};

export const TEMPLATE_OPTIONS: { value: LatexTemplateType; label: string; description: string }[] = [...RESUME_TEMPLATE_OPTIONS];

export const DEFAULT_LATEX_TEMPLATE = generateLatexFromResume(initialResumeData, DEFAULT_RESUME_THEME);
