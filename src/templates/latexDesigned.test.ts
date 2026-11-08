/**
 * The designed templates (Executive, Tech, Minimal, Simple) against the
 * owner's own resume, and the template ids, themes and gallery options that
 * pick them.
 *
 * Page counts need the compile service and are measured outside the suite
 * (report of 2026-11-08: every template one page as imported, with two lines
 * to spare). What these hold is the structure that produces that page, and
 * the rules that keep the PDF's text readable by an ATS.
 */

import { describe, expect, test } from 'bun:test';

import { resumeAiVoiceData } from '@/__fixtures__/resume/resumeAiVoice';
import {
    DEFAULT_RESUME_THEME,
    LEGACY_TEMPLATE_ALIASES,
    RESUME_TEMPLATE_IDS,
    RESUME_TEMPLATE_OPTIONS,
    canonicalTemplateId,
    defaultThemeFor,
    switchTemplate,
    type CanonicalTemplateId,
    type ResumeData,
    type ResumeTheme,
} from '@/types/resume';
import { fullDateRangeParts, generateLatexFromResume } from './latex';
import { latexProblems } from './latexStructure.testkit';

const owner = resumeAiVoiceData();
const DESIGNED: Array<Exclude<CanonicalTemplateId, 'compact'>> = ['executive', 'tech', 'minimal', 'ats-simple'];
const ALL: CanonicalTemplateId[] = ['compact', ...DESIGNED];

const render = (templateId: CanonicalTemplateId, data: ResumeData = owner) => generateLatexFromResume(data, templateId);
const bodyOf = (latex: string) => latex.slice(latex.indexOf('\\begin{document}'));

/** The text between a section heading and the next one. */
function section(latex: string, name: string): string {
    const body = bodyOf(latex);
    const start = body.indexOf(`\\section*{${name}}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = body.indexOf('\\section*{', start + 1);
    return body.slice(start, next < 0 ? undefined : next);
}

const bulletsOf = (description: string) =>
    description.split('\n').map((line) => line.replace(/^[\s•\-*]+/, '').trim()).filter(Boolean);
const esc = (text: string) => text.replace(/%/g, '\\%').replace(/∼/g, '$\\sim$');

describe.each(DESIGNED)('%s prints every field the compact template prints', (templateId) => {
    const latex = render(templateId);

    test('header: name, title, place, phone, email, and links printed as their addresses', () => {
        const body = bodyOf(latex);
        expect(body).toContain('Jai Shankar');
        expect(body).toContain('AI Engineer, Voice Agents');
        expect(body).toContain('Bengaluru, India');
        expect(body).toContain('+91 76440 53913');
        expect(body).toContain('\\href{mailto:jaimauryatech@gmail.com}{jaimauryatech@gmail.com}');
        expect(body).toContain('\\href{https://linkedin.com/in/jai-shankar-b7b388234}{linkedin.com/in/jai-shankar-b7b388234}');
        expect(body).toContain('\\href{https://github.com/jai0651}{github.com/jai0651}');
        expect(body).toContain('\\href{https://jaishankar.dev}{jaishankar.dev}');
    });

    test('standard section names, in the resume\'s order', () => {
        const body = bodyOf(latex);
        const at = (name: string) => body.indexOf(`\\section*{${name}}`);
        expect(at('Experience')).toBeGreaterThan(0);
        expect(at('Experience')).toBeLessThan(at('Projects'));
        expect(at('Projects')).toBeLessThan(at('Education'));
        expect(at('Education')).toBeLessThan(at('Skills'));
    });

    test('a role: company with its tag line, place, title with its stack, both dates in full', () => {
        const experience = section(latex, 'Experience');
        for (const text of ['Plivo', '(established CPaaS, AI voice agents)', 'Software Engineer I', 'Go, C, Python', 'Bengaluru', 'Sep 2025 -- Present', 'Hyperbots', '(seed-stage fintech AI)', 'Java (Spring Boot), Python (FastAPI)', 'Jun 2024 -- Aug 2025']) {
            expect(experience).toContain(text);
        }
        // Two full roles, each one \resumeEntry of four cells.
        expect(experience.match(/\\resumeEntry\{/g)).toHaveLength(2);
    });

    test('every role bullet, whole and escaped', () => {
        const experience = section(latex, 'Experience');
        for (const exp of owner.experience.slice(0, 2)) {
            for (const bullet of bulletsOf(exp.description)) {
                expect(experience).toContain(`\\item ${esc(bullet)}`);
            }
        }
        expect(experience).toContain('cut support workload by $\\sim$50\\%.');
    });

    test('internships are one-line short roles in one block, dates in full', () => {
        const experience = section(latex, 'Experience');
        expect(experience.match(/\\resumeShortRolesStart/g)).toHaveLength(1);
        expect(experience.match(/\\resumeShortRole\{/g)).toHaveLength(2);
        const shortRoles = experience.slice(experience.indexOf('\\resumeShortRolesStart'));
        expect(shortRoles).toContain('2Sigma School');
        expect(shortRoles).toContain('SDE Intern');
        expect(shortRoles).toContain('. Built a safe, fast remote and in-browser code execution engine (Pyodide, Cloud Run), cutting cost 70\\%.');
        expect(shortRoles).toContain('Mar 2024 -- May 2024');
        expect(shortRoles).toContain('. Built a Flutter affiliate app on Shopify with referrals, rewards, payments.');
        expect(shortRoles).toContain('May 2023 -- Jul 2023');
    });

    test('projects: title, stack and links on one line, every bullet under it', () => {
        const projects = section(latex, 'Projects');
        expect(projects.match(/\\resumeLine\{/g)).toHaveLength(3);
        expect(projects).toContain('Voice agent from scratch');
        expect(projects).toContain('Python, PyTorch, WebSockets');
        expect(projects).toContain('Next.js, TypeScript, Postgres, pgvector, OpenAI');
        expect(projects).toContain('\\href{https://github.com/jai0651/VAD-ASR}{repo}');
        expect(projects).toContain('\\href{https://patronus.cv}{patronus.cv}');
        expect(projects).toContain('\\href{https://github.com/theweekendworld-engg/ai-resume-builder}{repo}');
        expect(projects.match(/\\item /g)).toHaveLength(7);
        expect(projects).not.toContain('Tech Stack');
    });

    test('education: institution, degree and field, years', () => {
        const education = section(latex, 'Education');
        expect(education).toContain('Indian Institute of Technology Delhi');
        expect(education).toContain('B.Tech, Engineering and Computational Mechanics');
        expect(education).toContain('2020 -- 2024');
    });

    test('skills: the resume\'s own rows, each with its own label', () => {
        const skills = section(latex, 'Skills');
        for (const group of owner.skillGroups ?? []) {
            expect(skills).toContain(group.label);
            expect(skills).toContain(group.items.slice(0, 3).join(', '));
        }
    });

    test('a summary when there is one, and any section order', () => {
        const data: ResumeData = { ...structuredClone(owner), personalInfo: { ...owner.personalInfo, summary: 'Builds **voice** agents: 50% faster.' } };
        data.sectionOrder = ['summary', 'skills', 'education', 'projects', 'experience'];
        const out = render(templateId, data);
        expect(out).toContain('\\section*{Summary}\nBuilds \\textbf{voice} agents: 50\\% faster.');
        const at = (name: string) => out.indexOf(`\\section*{${name}}`);
        expect(at('Summary')).toBeLessThan(at('Skills'));
        expect(at('Skills')).toBeLessThan(at('Education'));
        expect(at('Projects')).toBeLessThan(at('Experience'));
    });

    test('well formed, one self-contained file with its attribution', () => {
        expect(latexProblems(latex)).toEqual([]);
        expect(latex).not.toMatch(/\\input|\\include\b/);
        expect(latex.split('\n')[0]).toMatch(/^% .*Patronus original design; .*\(SIL Open Font License\)\.$/);
    });
});

describe('every template keeps its PDF text readable by an ATS', () => {
    /**
     * Packages each template loads, all compiled on the service
     * (latex.ytotech.com, pdflatex) on 2026-11-08 in every face and density.
     * Anything new must be compiled there first.
     */
    const COMPILED = new Set(['geometry', 'cmap', 'fontenc', 'latexsym', 'lmodern', 'libertinus', 'plex-sans', 'plex-serif', 'plex-mono', 'sourcesanspro', 'sourceserifpro', 'beramono', 'lato', 'charter', 'microtype', 'titlesec', 'xcolor', 'enumitem', 'tabularx', 'hyperref']);
    const themes: ResumeTheme[] = ALL.flatMap((templateId) => (['sans', 'serif', 'mono'] as const).map((fontFamily) => ({ ...defaultThemeFor(templateId), fontFamily })));

    test.each(themes.map((theme) => [`${theme.templateId}/${theme.fontFamily}`, theme] as const))('%s', (_name, theme) => {
        const latex = generateLatexFromResume(owner, theme);
        const packages = [...latex.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g)].flatMap((m) => m[1].split(','));
        for (const pkg of packages) expect(COMPILED.has(pkg.trim())).toBe(true);
        // Glyphs mapped back to Unicode, so "fi" extracts as "fi".
        expect(latex).toContain('\\usepackage{cmap}');
        expect(latex).toContain('\\usepackage[T1]{fontenc}');
        // No icon fonts (the old Modern's contact line extracted as "§ GitHub ï LinkedIn"), no images.
        expect(latex).not.toMatch(/fontawesome|\\fa[A-Z]|\\includegraphics/);
        // One column: no side-by-side boxes a parser would read across.
        expect(latex).not.toMatch(/multicol|paracol|\\begin\{minipage\}|\\begin\{wrapfigure\}/);
        // Tracked letters extract as "E X P E R I E N C E".
        expect(latex).not.toMatch(/\\textls|letterspace|\\so\{/);
    });

    test.each(DESIGNED)('%s does not turn on pdfTeX fake spaces', (templateId) => {
        // With Libertinus, Plex, Charter and Bera, a fake space after a
        // symbol (•, ×, ∼) drew a box glyph or swallowed the visible space
        // ("•+91", "×←+2" in the extracted text), measured 2026-11-08. Word
        // gaps extract as spaces without it.
        expect(render(templateId)).not.toContain('pdfinterwordspace');
    });
});

describe('each template has its own look, from the theme', () => {
    test('the face each template was designed in, and the other two faces', () => {
        const face = (templateId: CanonicalTemplateId, fontFamily: ResumeTheme['fontFamily']) =>
            generateLatexFromResume(owner, { ...defaultThemeFor(templateId), fontFamily });
        expect(face('executive', 'serif')).toContain('\\usepackage{libertinus}');
        expect(face('executive', 'sans')).toContain('\\renewcommand{\\familydefault}{\\sfdefault}');
        expect(face('tech', 'sans')).toContain('\\usepackage[sfdefault]{plex-sans}');
        expect(face('tech', 'serif')).toContain('\\usepackage{plex-serif}');
        expect(face('tech', 'mono')).toContain('\\usepackage{plex-mono}');
        expect(face('minimal', 'sans')).toContain('\\usepackage[default]{sourcesanspro}');
        expect(face('minimal', 'serif')).toContain('\\usepackage{sourceserifpro}');
        expect(face('ats-simple', 'serif')).toContain('\\usepackage{charter}');
    });

    test('density moves the margins and the spacing', () => {
        for (const templateId of DESIGNED) {
            const at = (density: ResumeTheme['density']) => generateLatexFromResume(owner, { ...defaultThemeFor(templateId), density });
            const margin = (latex: string) => Number(latex.match(/left=([\d.]+)in/)?.[1]);
            expect(margin(at('compact'))).toBeLessThan(margin(at('normal')));
            expect(margin(at('normal'))).toBeLessThan(margin(at('relaxed')));
            for (const density of ['compact', 'relaxed'] as const) expect(latexProblems(at(density))).toEqual([]);
        }
    });

    test('the accent comes from the theme', () => {
        for (const templateId of DESIGNED) {
            expect(generateLatexFromResume(owner, { ...defaultThemeFor(templateId), accentColor: '#ff0000' })).toContain('\\definecolor{accent}{RGB}{255, 0, 0}');
        }
        expect(render('tech')).toContain('\\definecolor{accent}{RGB}{15, 118, 110}');
    });

    test('Executive puts the title before the company; the others the company first', () => {
        const order = (templateId: CanonicalTemplateId) => {
            const experience = section(render(templateId), 'Experience');
            return experience.indexOf('Software Engineer I') < experience.indexOf('Plivo') ? 'title-first' : 'company-first';
        };
        expect(order('executive')).toBe('title-first');
        for (const templateId of ['compact', 'tech', 'minimal', 'ats-simple'] as const) expect(order(templateId)).toBe('company-first');
    });

    test('Tech sets the skills as a table, and falls back to lines for a label too long for a column', () => {
        expect(section(render('tech'), 'Skills')).toContain('\\resumeSkillRow{Speech / AI:}{PyTorch, ASR (Conformer, CTC)');
        const long: ResumeData = { ...structuredClone(owner), skillGroups: [{ label: 'Cloud infrastructure and platform engineering', items: ['AWS'] }], skills: ['AWS'] };
        const skills = section(render('tech', long), 'Skills');
        expect(skills).toContain('\\resumeSkillLine{\\textbf{Cloud infrastructure and platform engineering}: AWS}');
        expect(skills).not.toContain('\\resumeSkillRow');
        // The others always print lines.
        expect(section(render('minimal'), 'Skills')).toContain('\\resumeSkillLine{\\textbf{Languages}: Python, Go');
    });

    test('a short role that already ends a sentence gets no second full stop', () => {
        const data: ResumeData = {
            ...structuredClone(owner),
            experience: [{ id: 'x', company: 'Acme', companyNote: '', role: 'Research Intern.', stack: '', location: '', startDate: '2023-06', endDate: '2023-08', current: false, description: '• Trained a model.' }],
        };
        for (const templateId of DESIGNED) {
            const out = render(templateId, data);
            expect(out).toContain('Trained a model.');
            expect(out).not.toContain('Intern.}.');
            expect(out).not.toContain('Intern..');
        }
    });

    test('dates: both ends in full; one when start and end match; none when neither is known', () => {
        expect(fullDateRangeParts('Mar 2024', 'May 2024', false)).toEqual(['Mar 2024', 'May 2024']);
        expect(fullDateRangeParts('2023-06', '', true)).toEqual(['Jun 2023', 'Present']);
        expect(fullDateRangeParts('2020', '2020', false)).toEqual(['2020']);
        expect(fullDateRangeParts('', '', false)).toEqual([]);
    });
});

describe('template ids: the gallery, the retired ids, the themes', () => {
    test('five templates in the gallery, compact first, each with a name and who it suits', () => {
        expect(RESUME_TEMPLATE_OPTIONS.map((option) => option.value)).toEqual(['compact', 'executive', 'tech', 'minimal', 'ats-simple']);
        for (const option of RESUME_TEMPLATE_OPTIONS) {
            expect(option.label.length).toBeGreaterThan(2);
            expect(option.description).toMatch(/\. For .+\.$/);
        }
        expect(new Set(RESUME_TEMPLATE_OPTIONS.map((option) => option.label)).size).toBe(5);
    });

    test('a retired id stays valid and renders as its successor', () => {
        expect(RESUME_TEMPLATE_IDS).toContain('modern');
        expect(RESUME_TEMPLATE_IDS).toContain('classic');
        expect(LEGACY_TEMPLATE_ALIASES).toEqual({ modern: 'tech', classic: 'executive' });
        expect(canonicalTemplateId('modern')).toBe('tech');
        expect(canonicalTemplateId('classic')).toBe('executive');
        expect(canonicalTemplateId('tech')).toBe('tech');
        // Unknown or missing: what the renderer has always fallen back to.
        expect(canonicalTemplateId('nonsense')).toBe('ats-simple');
        expect(canonicalTemplateId(undefined)).toBe('ats-simple');
        expect(canonicalTemplateId('__proto__')).toBe('ats-simple');
        expect(render('tech')).toBe(generateLatexFromResume(owner, 'modern'));
        expect(render('executive')).toBe(generateLatexFromResume(owner, 'classic'));
        // A saved theme on a retired id keeps its own accent.
        expect(generateLatexFromResume(owner, { templateId: 'modern', accentColor: '#1F4E79', fontFamily: 'sans', density: 'normal' })).toContain('\\definecolor{accent}{RGB}{31, 78, 121}');
    });

    test('each template\'s own theme', () => {
        expect(defaultThemeFor('compact')).toEqual(DEFAULT_RESUME_THEME);
        expect(defaultThemeFor('executive')).toEqual({ templateId: 'executive', accentColor: '#1F4E79', fontFamily: 'serif', density: 'normal' });
        expect(defaultThemeFor('tech')).toEqual({ templateId: 'tech', accentColor: '#0F766E', fontFamily: 'sans', density: 'normal' });
        expect(defaultThemeFor('minimal')).toEqual({ templateId: 'minimal', accentColor: '#111827', fontFamily: 'sans', density: 'normal' });
        expect(defaultThemeFor('modern')).toEqual({ templateId: 'modern', accentColor: '#0F766E', fontFamily: 'sans', density: 'normal' });
    });

    test('picking a template brings its own face and accent, unless the user set their own', () => {
        // Untouched compact → Tech: Tech's sans and teal.
        expect(switchTemplate(DEFAULT_RESUME_THEME, 'tech')).toEqual({ templateId: 'tech', accentColor: '#0F766E', fontFamily: 'sans', density: 'normal' });
        // A hand-picked accent and density survive; the untouched face follows the template.
        const mine: ResumeTheme = { templateId: 'compact', accentColor: '#BE123C', fontFamily: 'serif', density: 'compact' };
        expect(switchTemplate(mine, 'tech')).toEqual({ templateId: 'tech', accentColor: '#BE123C', fontFamily: 'sans', density: 'compact' });
        // A hand-picked face survives too.
        expect(switchTemplate({ ...DEFAULT_RESUME_THEME, fontFamily: 'mono' }, 'executive').fontFamily).toBe('mono');
        // Accent comparison ignores case.
        expect(switchTemplate({ ...DEFAULT_RESUME_THEME, accentColor: '#1f4e79' }, 'tech').accentColor).toBe('#0F766E');
        // And back again lands on the template's own theme.
        expect(switchTemplate(switchTemplate(DEFAULT_RESUME_THEME, 'tech'), 'compact')).toEqual(DEFAULT_RESUME_THEME);
    });
});
