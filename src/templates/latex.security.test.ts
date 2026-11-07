import { describe, expect, test } from 'bun:test';
import { generateLatexFromResume, TEMPLATE_OPTIONS } from './latex';
import { latexProblems } from './latexStructure.testkit';
import { initialResumeData, type ResumeData, type ResumeTemplateId } from '@/types/resume';

const TEMPLATES: ResumeTemplateId[] = TEMPLATE_OPTIONS.map((option) => option.value);

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
 * `%`, `_`, `^` or `~` would show in the body outside math mode.
 */
const PAYLOAD = '}\\input{/etc/passwd}\\write18{rm -rf} & 100% #1 $x^2_y$ ~home \\\\ {';
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
            // A one-line internship, which the compact template prints differently.
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
    test.each(TEMPLATES)('%s: every field escaped, document well formed', (templateId) => {
        const latex = generateLatexFromResume(hostileResume(), templateId);
        expect(latexProblems(latex)).toEqual([]);
        expect(latex).not.toContain('\\input{');
        expect(latex).not.toContain('\\write18');
    });

    test.each(TEMPLATES)('%s: the empty resume is well formed too', (templateId) => {
        expect(latexProblems(generateLatexFromResume(initialResumeData, templateId))).toEqual([]);
    });
});
