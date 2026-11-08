import { describe, expect, test } from 'bun:test';
import { escapeLatex, generateLatexFromResume } from './latex';
import { latexProblems } from './latexStructure.testkit';
import {
    RESUME_TEMPLATE_IDS,
    defaultThemeFor,
    initialResumeData,
    type ResumeData,
    type ResumeDensity,
    type ResumeFontFamily,
    type ResumeTemplateId,
    type ResumeTheme,
} from '@/types/resume';

/** Every id a resume can hold, the retired ones (`modern`, `classic`) included. */
const TEMPLATES: ResumeTemplateId[] = [...RESUME_TEMPLATE_IDS];

/** Each template in every face and density: the font and spacing code paths differ per theme. */
const THEMES: ResumeTheme[] = TEMPLATES.flatMap((templateId) =>
    (['sans', 'serif', 'mono'] as ResumeFontFamily[]).flatMap((fontFamily) =>
        (['compact', 'normal', 'relaxed'] as ResumeDensity[]).map((density) => ({ ...defaultThemeFor(templateId), fontFamily, density })),
    ),
);
const themeName = (theme: ResumeTheme) => `${theme.templateId}/${theme.fontFamily}/${theme.density}`;

describe('LaTeX output escapes user-supplied links (audit 2026-10-02)', () => {
    test.each(TEMPLATES)('%s: a link cannot close \\href and inject a command', (templateId) => {
        const data = structuredClone(initialResumeData);
        data.personalInfo = {
            ...data.personalInfo,
            fullName: 'Test Person',
            linkedin: 'https://linkedin.com/in/x}\\input{/etc/passwd}',
            website: 'https://site.dev/a%20b#top',
        };
        const latex = generateLatexFromResume(data, templateId);
        expect(latex).not.toContain('\\input{/etc/passwd}');
        expect(latex).not.toMatch(/\\href\{[^}]*\}\\input/);
        expect(latex).toContain('a\\%20b\\#top');
    });

    test('the default template is one of those covered', () => {
        expect(TEMPLATES).toContain('compact');
        const data = structuredClone(initialResumeData);
        data.personalInfo = { ...data.personalInfo, linkedin: 'https://linkedin.com/in/x}\\input{/etc/passwd}' };
        expect(generateLatexFromResume(data)).not.toContain('\\input{/etc/passwd}');
    });
});

/**
 * No raw user LaTeX, in any template: the same hostile string in every field
 * a resume has, including the dates, the links, and the tag line, stack and
 * skills-row labels. A raw `}` would unbalance the braces; a raw `&`, `#`,
 * `%`, `_`, `^` or `~` would show in the body outside math mode; a `}{` would
 * shift a macro's arguments. The Unicode tail is what PDF extraction and
 * word processors put in real resumes.
 */
const PAYLOAD = '}\\input{/etc/passwd}\\write18{rm -rf} & 100% #1 $x^2_y$ ~home \\\\ {a}{b} café – “quoted” ∼5× → ≥ ±µ';
const URL_PAYLOAD = 'https://x.dev/}\\input{/etc/passwd}%#';

function hostileResume(): ResumeData {
    return {
        personalInfo: {
            fullName: PAYLOAD,
            title: PAYLOAD,
            email: `a@b.dev${PAYLOAD}`,
            phone: PAYLOAD,
            location: PAYLOAD,
            website: URL_PAYLOAD,
            linkedin: URL_PAYLOAD,
            github: URL_PAYLOAD,
            summary: PAYLOAD,
        },
        experience: [
            { id: 'e1', company: PAYLOAD, companyNote: PAYLOAD, role: PAYLOAD, stack: PAYLOAD, startDate: PAYLOAD, endDate: PAYLOAD, current: false, location: PAYLOAD, description: `• ${PAYLOAD}\n• **${PAYLOAD}**` },
            // A one-line internship, which every template prints as a short role.
            { id: 'e2', company: PAYLOAD, companyNote: PAYLOAD, role: `SDE Intern ${PAYLOAD}`, stack: PAYLOAD, startDate: PAYLOAD, endDate: '', current: true, location: PAYLOAD, description: `• ${PAYLOAD}` },
        ],
        projects: [
            { id: 'p1', name: PAYLOAD, description: `${PAYLOAD}\n- ${PAYLOAD}`, url: URL_PAYLOAD, liveUrl: URL_PAYLOAD, repoUrl: URL_PAYLOAD, technologies: [PAYLOAD, 'C#'] },
            { id: 'p2', name: 'Legacy link', description: '', url: URL_PAYLOAD, liveUrl: '', repoUrl: '', technologies: [] },
        ],
        education: [{ id: 'ed1', institution: PAYLOAD, degree: PAYLOAD, fieldOfStudy: PAYLOAD, startDate: PAYLOAD, endDate: PAYLOAD, current: false }],
        skills: [PAYLOAD, 'C++', 'R&D'],
        skillGroups: [{ label: PAYLOAD, items: [PAYLOAD, 'C++'] }, { label: '', items: ['R&D'] }],
        sectionOrder: ['summary', 'experience', 'projects', 'education', 'skills'],
    };
}

describe('no raw user LaTeX in any template', () => {
    test.each(THEMES.map((theme) => [themeName(theme), theme] as const))('%s: every field escaped, document well formed', (_name, theme) => {
        const latex = generateLatexFromResume(hostileResume(), theme);
        expect(latexProblems(latex)).toEqual([]);
        expect(latex).not.toContain('\\input{');
        expect(latex).not.toContain('\\write18');
    });

    test.each(TEMPLATES)('%s: the empty resume is well formed too', (templateId) => {
        expect(latexProblems(generateLatexFromResume(initialResumeData, templateId))).toEqual([]);
    });
});

/**
 * Escaped, and printed. A template that dropped a field would pass the test
 * above; this one tags each field and looks for the tag, escaped once
 * (`escapeLatex` is a single pass, so its output never appears escaped twice).
 */
describe('every field is printed, escaped exactly once', () => {
    const hostile = (field: string) => `${field}}{&%#_^~`;
    const escaped = (field: string) => escapeLatex(hostile(field));

    function taggedResume(): ResumeData {
        return {
            personalInfo: {
                fullName: hostile('NAME'),
                title: hostile('TITLE'),
                email: 'a@b.dev',
                phone: hostile('PHONE'),
                location: hostile('PLACE'),
                website: '',
                linkedin: '',
                github: '',
                summary: hostile('SUMMARY'),
            },
            experience: [
                { id: 'e1', company: hostile('COMPANY'), companyNote: hostile('NOTE'), role: hostile('ROLE'), stack: hostile('STACK'), startDate: '2024-01', endDate: '', current: true, location: hostile('CITY'), description: `• ${hostile('BULLET1')}\n• ${hostile('BULLET2')}` },
                { id: 'e2', company: hostile('INTERNCO'), companyNote: '', role: 'SDE Intern', stack: '', startDate: '2023-05', endDate: '2023-07', current: false, location: '', description: `• ${hostile('INTERNLINE')}` },
            ],
            projects: [{ id: 'p1', name: hostile('PROJECT'), description: `• ${hostile('PBULLET')}`, url: '', liveUrl: '', repoUrl: 'https://github.com/a/b', technologies: [hostile('TECH')] }],
            education: [{ id: 'ed1', institution: hostile('SCHOOL'), degree: hostile('DEGREE'), fieldOfStudy: hostile('FIELD'), startDate: '2016', endDate: '2020', current: false }],
            skills: [hostile('SKILL')],
            skillGroups: [{ label: hostile('LABEL'), items: [hostile('SKILL')] }],
            sectionOrder: ['summary', 'experience', 'projects', 'education', 'skills'],
        };
    }
    const FIELDS = ['NAME', 'TITLE', 'PHONE', 'PLACE', 'SUMMARY', 'COMPANY', 'NOTE', 'ROLE', 'STACK', 'CITY', 'BULLET1', 'BULLET2', 'INTERNCO', 'INTERNLINE', 'PROJECT', 'PBULLET', 'TECH', 'SCHOOL', 'DEGREE', 'FIELD', 'LABEL', 'SKILL'];

    test.each(TEMPLATES)('%s', (templateId) => {
        const latex = generateLatexFromResume(taggedResume(), templateId);
        const body = latex.slice(latex.indexOf('\\begin{document}'));
        for (const field of FIELDS) {
            expect(body).toContain(escaped(field));
        }
        expect(body).not.toContain(escapeLatex(escaped('NAME')));
        expect(latexProblems(latex)).toEqual([]);
    });
});
