import { ResumeData, initialResumeData } from '@/types/resume';

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

function markdownToLatex(text: string): string {
    if (!text) return '';
    let result = escapeLatex(text);
    result = result.replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}');
    result = result.replace(/\*([^*]+)\*/g, '\\textit{$1}');
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
    const lines = description
        .replace(/<ul>/gi, '')
        .replace(/<\/ul>/gi, '')
        .replace(/<li>/gi, '\n')
        .replace(/<\/li>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .split('\n')
        .map(line => line.replace(/^[•\-\*]\s*/, '').trim())
        .filter(line => line.length > 0);
    return lines;
}

export type LatexTemplateType = 'ats-simple' | 'modern' | 'classic';
type LegacyLatexTemplateType = LatexTemplateType | 'modern-professional';

function normalizeTemplate(template: LegacyLatexTemplateType): LatexTemplateType {
    if (template === 'modern-professional') {
        return 'modern';
    }

    return template;
}

export function generateLatexFromResume(data: ResumeData, template: LegacyLatexTemplateType = 'ats-simple'): string {
    const normalizedTemplate = normalizeTemplate(template);

    switch (normalizedTemplate) {
        case 'modern':
            return generateModernProfessionalTemplate(data);
        case 'classic':
            return generateATSSimpleTemplate(data);
        case 'ats-simple':
        default:
            return generateATSSimpleTemplate(data);
    }
}

function generateATSSimpleTemplate(data: ResumeData): string {
    const { personalInfo, experience, projects, education, skills, sectionOrder } = data;
    const order = sectionOrder || ['summary', 'education', 'experience', 'projects', 'skills'];

    const header = `\\documentclass[a4paper,10pt]{article}
\\usepackage[margin=1cm]{geometry}
\\usepackage{parskip}
\\usepackage{enumitem}
\\usepackage{xcolor}
\\usepackage[hidelinks]{hyperref}
\\usepackage{titlesec}
\\usepackage{multicol}
\\usepackage{setspace}

\\definecolor{mainblue}{RGB}{31, 78, 121}
\\hypersetup{
    colorlinks=true,
    linkcolor=mainblue,
    urlcolor=mainblue,
    citecolor=mainblue
}

\\titleformat{\\section}{\\color{mainblue}\\bfseries\\uppercase}{\\thesection}{1em}{}
\\renewcommand{\\labelitemi}{\\textbullet}
\\setlist[itemize]{noitemsep, topsep=0pt, left=0.5em}
\\pagestyle{empty}

\\begin{document}

\\begin{center}
    ${personalInfo.fullName ? `{\\LARGE \\textbf{${escapeLatex(personalInfo.fullName)}}}\\\\[4pt]` : ''}
    ${personalInfo.title ? `\\textit{${escapeLatex(personalInfo.title)}} \\\\` : ''}
    ${personalInfo.location ? `${escapeLatex(personalInfo.location)} \\\\` : ''}
    ${[
        personalInfo.email ? `\\href{mailto:${personalInfo.email}}{${escapeLatex(personalInfo.email)}}` : '',
        personalInfo.phone ? `\\href{tel:${personalInfo.phone.replace(/\s/g, '')}}{${escapeLatex(personalInfo.phone)}}` : '',
        personalInfo.github ? `\\href{https://${personalInfo.github.replace(/^https?:\/\//, '')}}{GitHub}` : '',
        personalInfo.linkedin ? `\\href{https://${personalInfo.linkedin.replace(/^https?:\/\//, '')}}{LinkedIn}` : '',
        personalInfo.website ? `\\href{https://${personalInfo.website.replace(/^https?:\/\//, '')}}{Portfolio}` : ''
    ].filter(Boolean).join(' \\quad | \\quad ')}
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
    const urlPart = proj.url ? `\\hfill \\href{${proj.url}}{\\textcolor{mainblue}{[${proj.url.includes('github') ? 'Repo' : 'Live'}]}}` : '';
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
            if (skills.length === 0) return '';
            return `\\section*{SKILLS}
${skills.map(skill => escapeLatex(skill)).join(' \\textbullet{} ')}

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

function generateModernProfessionalTemplate(data: ResumeData): string {
    const { personalInfo, experience, projects, education, skills, sectionOrder } = data;
    const order = sectionOrder || ['summary', 'education', 'experience', 'projects', 'skills'];

    const header = `\\documentclass[a4paper,10pt]{article}
\\usepackage[margin=0.8cm]{geometry}
\\usepackage{parskip}
\\usepackage{enumitem}
\\usepackage{xcolor}
\\usepackage[hidelinks]{hyperref}
\\usepackage{titlesec}
\\usepackage{multicol}
\\usepackage{setspace}
\\usepackage{fontawesome5}

\\definecolor{accent}{RGB}{64, 123, 255}
\\definecolor{darktext}{RGB}{33, 33, 33}
\\definecolor{lighttext}{RGB}{100, 100, 100}

\\hypersetup{
    colorlinks=true,
    linkcolor=accent,
    urlcolor=accent,
    citecolor=accent
}

\\titleformat{\\section}{\\large\\bfseries\\color{accent}}{\\thesection}{0em}{}[\\titlerule]
\\titlespacing*{\\section}{0pt}{1em}{0.5em}
\\renewcommand{\\labelitemi}{\\textcolor{accent}{\\textbullet}}
\\setlist[itemize]{noitemsep, topsep=2pt, left=0.5em}
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
    const urlPart = proj.url ? `\\hfill \\href{${proj.url}}{\\textcolor{accent}{\\faExternalLink*}}` : '';
    return `{\\color{darktext}\\textbf{${escapeLatex(proj.name)}}}${urlPart}
${descLines.length > 0 ? `\\begin{itemize}
${descLines.map(line => `  \\item {\\color{darktext}${markdownToLatex(line)}}`).join('\n')}
\\end{itemize}` : `{\\color{darktext}${markdownToLatex(proj.description)}}`}
${proj.technologies.length > 0 ? `{\\color{lighttext}\\small\\textit{${proj.technologies.map(t => escapeLatex(t)).join(' · ')}}}` : ''}`;
}).join('\n\n\\vspace{0.3em}\n\n')}

`;
        },
        skills: () => {
            if (skills.length === 0) return '';
            return `\\section*{Skills}
{\\color{darktext}${skills.map(skill => escapeLatex(skill)).join(' \\textbullet{} ')}}

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
    }
];

export const DEFAULT_LATEX_TEMPLATE = generateATSSimpleTemplate(initialResumeData);
