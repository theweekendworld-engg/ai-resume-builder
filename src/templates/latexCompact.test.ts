/**
 * The compact template, against the owner's own resume (resume_ai_voice) as
 * the product imports it. That resume runs to two pages in `ats-simple` and is
 * one page in his own LaTeX; compact is modelled on that LaTeX. The page count
 * itself needs the compile service and is measured outside the suite (see the
 * report for 2026-11-07); these tests hold the structure that produces it.
 */

import { describe, expect, test } from 'bun:test';

import { resumeAiVoiceData } from '@/__fixtures__/resume/resumeAiVoice';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import {
    DEFAULT_RESUME_THEME,
    DEFAULT_TEMPLATE_ID,
    defaultThemeFor,
    initialResumeData,
    type ResumeData,
    type ResumeTheme,
} from '@/types/resume';
import {
    DEFAULT_LATEX_TEMPLATE,
    TEMPLATE_OPTIONS,
    compactLinkLabel,
    dateRangeParts,
    generateLatexFromResume,
    isShortRole,
} from './latex';
import { latexProblems } from './latexStructure.testkit';

const owner = resumeAiVoiceData();
const latex = generateLatexFromResume(owner, 'compact');
const body = latex.slice(latex.indexOf('\\begin{document}'));

/** The text between a section heading and the next one. */
function section(name: string): string {
    const start = body.indexOf(`\\section*{${name}}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = body.indexOf('\\section*{', start + 1);
    return body.slice(start, next < 0 ? undefined : next);
}

const bulletsOf = (description: string) =>
    description.split('\n').map((line) => line.replace(/^[\s•\-*]+/, '').trim()).filter(Boolean);
const esc = (text: string) => text.replace(/%/g, '\\%').replace(/∼/g, '$\\sim$');

describe('the imported resume is the whole resume', () => {
    // Guards the fixture: if import changes, the template tests below would
    // be testing a smaller document without saying so.
    test('four roles, three projects, four labelled skills rows', () => {
        expect(owner.experience.map((exp) => exp.company)).toEqual(['Plivo', 'Hyperbots', '2Sigma School', 'Swachh.io']);
        expect(owner.projects.map((project) => bulletsOf(project.description).length)).toEqual([4, 2, 1]);
        expect(owner.skillGroups?.map((group) => group.label)).toEqual(['Languages', 'Speech / AI', 'Voice infra', 'Backend / Infra']);
    });
});

describe('compact renders every field', () => {
    test('header: name, title, place, phone, email, and links printed as addresses', () => {
        expect(body).toContain('\\textbf{\\MakeUppercase{Jai Shankar}}');
        expect(body).toContain('\\textit{AI Engineer, Voice Agents}');
        expect(body).toContain('Bengaluru, India \\quad$|$\\quad +91 76440 53913 \\quad$|$\\quad \\href{mailto:jaimauryatech@gmail.com}{jaimauryatech@gmail.com}');
        expect(body).toContain('\\href{https://linkedin.com/in/jai-shankar-b7b388234}{linkedin.com/in/jai-shankar-b7b388234}');
        expect(body).toContain('\\href{https://github.com/jai0651}{github.com/jai0651}');
        expect(body).toContain('\\href{https://jaishankar.dev}{jaishankar.dev}');
    });

    test('a role: company with its tag line, place, title with its stack, dates', () => {
        const experience = section('Experience');
        expect(experience).toContain('{Plivo {\\normalfont\\small (established CPaaS, AI voice agents)}}{Bengaluru}');
        expect(experience).toContain('{Software Engineer I $|$ Go, C, Python}{Sep 2025 -- Present}');
        expect(experience).toContain('{Hyperbots {\\normalfont\\small (seed-stage fintech AI)}}{Bengaluru}');
        expect(experience).toContain('{Software Engineer I $|$ Java (Spring Boot), Python (FastAPI)}{Jun 2024 -- Aug 2025}');
    });

    test('every role bullet is a \\resumeItem, whole, escaped', () => {
        const experience = section('Experience');
        for (const exp of owner.experience.slice(0, 2)) {
            for (const bullet of bulletsOf(exp.description)) {
                expect(experience).toContain(`\\resumeItem{${esc(bullet)}}`);
            }
        }
        // "∼50%" from PDF extraction prints as a tilde, not a gap.
        expect(experience).toContain('cut support workload by $\\sim$50\\%.}');
    });

    test('internships are one-line short roles, grouped in one block', () => {
        const experience = section('Experience');
        expect(experience.match(/\\resumeShortRolesStart/g)).toHaveLength(1);
        expect(experience).toContain(
            '\\resumeShortRole{\\textbf{2Sigma School}, \\textit{SDE Intern}. Built a safe, fast remote and in-browser code execution engine (Pyodide, Cloud Run), cutting cost 70\\%.}{Mar -- May 2024}',
        );
        expect(experience).toContain(
            '\\resumeShortRole{\\textbf{Swachh.io}, \\textit{SDE Intern}. Built a Flutter affiliate app on Shopify with referrals, rewards, payments.}{May -- Jul 2023}',
        );
        expect(experience.indexOf('\\resumeShortRolesStart')).toBeGreaterThan(experience.lastIndexOf('\\resumeSubheading'));
    });

    test('projects: title, stack and links on one line, and real bullets under it', () => {
        const projects = section('Projects');
        expect(projects).toContain('{\\textbf{Voice agent from scratch} $|$ \\emph{Python, PyTorch, WebSockets}}{\\href{https://github.com/jai0651/VAD-ASR}{repo}}');
        expect(projects).toContain('{\\textbf{Tonecall: agent-to-agent call protocol} $|$ \\emph{TypeScript, Next.js, WebSockets}}{\\href{https://github.com/jai0651/tonecall}{repo}}');
        expect(projects).toContain(
            '{\\textbf{Patronus: AI career companion} $|$ \\emph{Next.js, TypeScript, Postgres, pgvector, OpenAI}}{\\href{https://patronus.cv}{patronus.cv} $|$ \\href{https://github.com/theweekendworld-engg/ai-resume-builder}{repo}}',
        );
        // Every project bullet, as a bullet: 4 + 2 + 1.
        expect(projects.match(/\\resumeItem\{/g)).toHaveLength(7);
        for (const project of owner.projects) {
            for (const bullet of bulletsOf(project.description)) {
                expect(projects).toContain(`\\resumeItem{${esc(bullet)}}`);
            }
        }
        // No separate "Tech Stack:" line: the stack is on the title line.
        expect(projects).not.toContain('Tech Stack');
    });

    test('education: institution, degree and field, years', () => {
        expect(section('Education')).toContain('{Indian Institute of Technology Delhi}{}\n    {B.Tech, Engineering and Computational Mechanics}{2020 -- 2024}');
    });

    test('skills: the resume\'s own rows, with their own labels', () => {
        const skills = section('Skills');
        expect(skills).toContain('\\textbf{Languages}{: Python, Go, C/C++, Java, TypeScript, Rust} \\\\');
        expect(skills).toContain('\\textbf{Speech / AI}{: PyTorch, ASR (Conformer, CTC), TTS, VAD, noise suppression, speaker ID, LLM agents, RAG}');
        expect(skills).toContain('\\textbf{Backend / Infra}{: FastAPI, gRPC, Kafka, Redis, PostgreSQL, AWS, Kubernetes, Docker, Prometheus, Grafana}\n');
    });

    test('a summary, when there is one, and the section order the resume asks for', () => {
        const data: ResumeData = { ...structuredClone(owner), personalInfo: { ...owner.personalInfo, summary: 'Builds **voice** agents: 50% faster.' } };
        data.sectionOrder = ['summary', 'education', 'skills', 'experience', 'projects'];
        const out = generateLatexFromResume(data, 'compact');
        expect(out).toContain('\\section*{Summary}\nBuilds \\textbf{voice} agents: 50\\% faster.');
        const at = (name: string) => out.indexOf(`\\section*{${name}}`);
        expect(at('Summary')).toBeLessThan(at('Education'));
        expect(at('Education')).toBeLessThan(at('Skills'));
        expect(at('Skills')).toBeLessThan(at('Experience'));
        expect(at('Experience')).toBeLessThan(at('Projects'));
    });
});

describe('compact is one self-contained, well formed file', () => {
    test('structure: braces, environments, no raw specials, no file access', () => {
        expect(latexProblems(latex)).toEqual([]);
    });

    test('the preamble is inline (no \\input of preamble.tex) and keeps the attribution', () => {
        expect(latex).not.toMatch(/\\input|\\include\b/);
        expect(latex.startsWith('% Compact (one page). Layout adapted from "Jake\'s Resume" by Jake Gutierrez')).toBe(true);
        expect(latex).toContain('MIT License');
        for (const macro of ['resumeSubheading', 'resumeShortRole', 'resumeProjectHeading', 'resumeItem', 'resumeItemListStart', 'resumeSubHeadingListStart']) {
            expect(latex).toContain(`\\newcommand{\\${macro}}`);
        }
    });

    test('the source resume\'s page: A4, 10pt, half-inch margins, Latin Modern, its accent', () => {
        expect(latex).toContain('\\documentclass[a4paper,10pt]{article}');
        expect(latex).toContain('\\usepackage[a4paper,left=0.55in,right=0.55in,top=0.45in,bottom=0.4in]{geometry}');
        expect(latex).toContain('\\usepackage{lmodern}');
        expect(latex).toContain('\\definecolor{mainblue}{RGB}{31, 78, 121}');
        expect(latex).toContain('\\titlespacing*{\\section}{0pt}{10pt}{5pt}');
    });

    test('density and font come from the theme', () => {
        const theme = (patch: Partial<ResumeTheme>): ResumeTheme => ({ ...DEFAULT_RESUME_THEME, ...patch });
        const tight = generateLatexFromResume(owner, theme({ density: 'compact' }));
        expect(tight).toContain('left=0.45in,right=0.45in,top=0.35in,bottom=0.3in');
        expect(tight).toContain('\\titlespacing*{\\section}{0pt}{7pt}{3pt}');
        expect(generateLatexFromResume(owner, theme({ density: 'relaxed' }))).toContain('left=0.75in');
        expect(generateLatexFromResume(owner, theme({ fontFamily: 'sans' }))).toContain('\\renewcommand{\\familydefault}{\\sfdefault}');
        expect(generateLatexFromResume(owner, theme({ fontFamily: 'mono' }))).toContain('{beramono}');
        // Fake interword spaces garble Bera Mono after a symbol (`×←`); Latin Modern keeps them.
        expect(generateLatexFromResume(owner, theme({ fontFamily: 'mono' }))).not.toContain('pdfinterwordspace');
        expect(generateLatexFromResume(owner, theme({ fontFamily: 'sans' }))).toContain('\\pdfinterwordspaceon');
        expect(latex).toContain('\\pdfinterwordspaceon');
        expect(generateLatexFromResume(owner, theme({ accentColor: '#ff0000' }))).toContain('\\definecolor{mainblue}{RGB}{255, 0, 0}');
        for (const variant of [tight, generateLatexFromResume(owner, theme({ fontFamily: 'mono', density: 'relaxed' }))]) {
            expect(latexProblems(variant)).toEqual([]);
        }
    });

    test('a long place or date wraps in a bounded right column instead of crushing the left one', () => {
        expect(latex).toContain('\\ifdim\\resumeRightWidth>0.4\\textwidth');
        expect(latex).toContain('\\textbf{#1} & \\resumeRight{#2} \\\\');
    });
});

describe('short roles', () => {
    const exp = (role: string, description: string) => ({ role, description });
    test('an internship with at most one line is a short role', () => {
        expect(isShortRole(exp('SDE Intern', '• Built a thing.'))).toBe(true);
        expect(isShortRole(exp('Software Engineering Internship', ''))).toBe(true);
        expect(isShortRole(exp('Graduate Trainee', 'Did it.'))).toBe(true);
    });
    test('more than one line, or not an internship, is a full entry', () => {
        expect(isShortRole(exp('SDE Intern', '• One.\n• Two.'))).toBe(false);
        expect(isShortRole(exp('Software Engineer I', '• One.'))).toBe(false);
        expect(isShortRole(exp('International Sales Lead', '• One.'))).toBe(false);
        expect(isShortRole(exp('Internal Tools Engineer', ''))).toBe(false);
    });
    test('an internship with a tag line, stack and place keeps all of them on its line', () => {
        const data: ResumeData = {
            ...structuredClone(initialResumeData),
            experience: [{ id: 'x', company: 'Acme', companyNote: 'robotics', role: 'ML Intern', stack: 'Python', location: 'Remote', startDate: '2023-06', endDate: '2023-08', current: false, description: '• Trained a model.' }],
        };
        expect(generateLatexFromResume(data, 'compact')).toContain(
            '\\resumeShortRole{\\textbf{Acme {\\normalfont\\small (robotics)}}, \\textit{ML Intern $|$ Python}. Trained a model.}{Remote $|$ Jun -- Aug 2023}',
        );
    });
});

describe('dates and link labels', () => {
    test('a range in one year prints the year once; a missing end is left out', () => {
        expect(dateRangeParts('Mar 2024', 'May 2024', false)).toEqual(['Mar', 'May 2024']);
        expect(dateRangeParts('Jun 2024', 'Aug 2025', false)).toEqual(['Jun 2024', 'Aug 2025']);
        expect(dateRangeParts('Sep 2025', '', true)).toEqual(['Sep 2025', 'Present']);
        expect(dateRangeParts('2020', '2024', false)).toEqual(['2020', '2024']);
        expect(dateRangeParts('', '2024', false)).toEqual(['2024']);
        expect(dateRangeParts('', '', false)).toEqual([]);
    });
    test('repo is "repo"; a live site is its address when short', () => {
        expect(compactLinkLabel({ label: 'Repo', href: 'https://github.com/a/b' })).toBe('repo');
        expect(compactLinkLabel({ label: 'Live', href: 'https://www.patronus.cv/' })).toBe('patronus.cv');
        expect(compactLinkLabel({ label: 'Live', href: 'https://a-very-long-subdomain.example.com/some/deep/path' })).toBe('live');
    });
});

describe('compact is the default where nobody chose', () => {
    test('a new resume, and a bare render, are compact', () => {
        expect(DEFAULT_TEMPLATE_ID).toBe('compact');
        expect(DEFAULT_RESUME_THEME.templateId).toBe('compact');
        expect(generateLatexFromResume(owner)).toBe(latex);
        expect(DEFAULT_LATEX_TEMPLATE).toBe(generateLatexFromResume(initialResumeData, 'compact'));
    });

    test('the picker lists it first, with all the others', () => {
        expect(TEMPLATE_OPTIONS[0]).toMatchObject({ value: 'compact', label: 'Compact' });
        expect(TEMPLATE_OPTIONS.map((option) => option.value)).toEqual(['compact', 'executive', 'tech', 'minimal', 'ats-simple']);
    });

    test('the Default template setting: compact when unset, a stored choice kept', () => {
        expect(parseUserGenerationPreferences({}).defaultTemplate).toBe('compact');
        expect(parseUserGenerationPreferences(null).defaultTemplate).toBe('compact');
        expect(parseUserGenerationPreferences({ defaultTemplate: 'ats-simple' }).defaultTemplate).toBe('ats-simple');
        expect(parseUserGenerationPreferences({ defaultTemplate: 'tech', targetLength: '1-page' }).defaultTemplate).toBe('tech');
        // A retired id someone saved is still a valid setting; it renders as its successor.
        expect(parseUserGenerationPreferences({ defaultTemplate: 'modern', targetLength: '1-page' }).defaultTemplate).toBe('modern');
    });

    test('ats-simple asked for by id keeps its theme and its face', () => {
        expect(defaultThemeFor('ats-simple')).toEqual({ templateId: 'ats-simple', accentColor: '#1F4E79', fontFamily: 'sans', density: 'normal' });
        const ats = generateLatexFromResume(owner, 'ats-simple');
        expect(ats).toContain('\\usepackage[default]{lato}');
        expect(ats).toContain('\\section*{Experience}');
    });
});

describe('the structure checker catches what it is there to catch', () => {
    const wrap = (text: string) => `\\documentclass{article}\n\\begin{document}\n${text}\n\\end{document}`;
    test('raw braces, specials, open environments, file access', () => {
        expect(latexProblems(wrap('ok \\& \\% \\{ \\} $\\sim$'))).toEqual([]);
        expect(latexProblems(wrap('\\textbf{a}}'))).not.toEqual([]);
        expect(latexProblems(wrap('R&D'))).not.toEqual([]);
        expect(latexProblems(wrap('100% done'))).not.toEqual([]);
        expect(latexProblems(wrap('\\begin{itemize} x'))).not.toEqual([]);
        expect(latexProblems(wrap('\\input{/etc/passwd}'))).not.toEqual([]);
        expect(latexProblems(wrap('$x'))).not.toEqual([]);
    });

    test('a template macro with an argument too many or too few', () => {
        expect(latexProblems(wrap('\\resumeEntry{a}{b}\n  {c}{d}'))).toEqual([]);
        // A field holding "}{" shifts every argument after it.
        expect(latexProblems(wrap('\\resumeEntry{a}{b}{c}{d}{e}'))).not.toEqual([]);
        expect(latexProblems(wrap('\\resumeLine{a}'))).not.toEqual([]);
        expect(latexProblems(wrap('\\resumeSkillLine{a \\{ b}'))).toEqual([]);
        // Similar names are other macros.
        expect(latexProblems(wrap('\\resumeShortRolesStart \\resumeShortRole{a}{b} \\resumeShortRolesEnd'))).toEqual([]);
    });
});
