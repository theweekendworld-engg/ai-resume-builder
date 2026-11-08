/**
 * The live preview against the PDF it stands in for. Project bullets used to
 * render as plain lines (Tailwind's preflight strips list markers and only
 * the role bullets set their own), and the full preview cut a project at
 * four bullets that the PDF printed. The compact template's preview follows
 * its LaTeX: internships on one line, the stack on the project's title line.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { resumeAiVoiceData } from '@/__fixtures__/resume/resumeAiVoice';
import { useResumeStore } from '@/store/resumeStore';
import {
    DEFAULT_RESUME_THEME,
    LEGACY_RESUME_THEME,
    RESUME_TEMPLATE_OPTIONS,
    defaultThemeFor,
    type CanonicalTemplateId,
    type ResumeData,
    type ResumeTheme,
} from '@/types/resume';
import { ResumeHtmlPreview, TemplateGallery } from './TemplateGalleryPanel';

const owner = resumeAiVoiceData();

function render(data: ResumeData, theme: ResumeTheme, variant: 'full' | 'thumb' = 'full'): string {
    return renderToStaticMarkup(<ResumeHtmlPreview data={data} theme={theme} variant={variant} />);
}

/** The markup between a section's heading and the next section. */
function sectionHtml(html: string, title: string): string {
    const start = html.indexOf(`>${title}</div>`);
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = html.slice(start);
    const titles = ['Summary', 'About', 'Experience', 'Projects', 'Education', 'Skills'].filter((t) => t !== title);
    const ends = titles.map((t) => rest.indexOf(`>${t}</div>`)).filter((i) => i > 0);
    return ends.length ? rest.slice(0, Math.min(...ends)) : rest;
}

const markers = (html: string) => (html.match(/<li style="[^"]*list-style-type:disc/g) ?? []).length;
/** Minimal draws an en dash, as its PDF does. */
const dashes = (html: string) => (html.match(/<li style="[^"]*list-style-type:none[^>]*><span[^>]*>–<\/span>/g) ?? []).length;

describe.each([
    ['compact', DEFAULT_RESUME_THEME],
    ['ats-simple', LEGACY_RESUME_THEME],
    ['executive', defaultThemeFor('executive')],
    ['tech', defaultThemeFor('tech')],
    ['minimal', defaultThemeFor('minimal')],
] as const)('%s preview', (name, theme) => {
    test('every project bullet is a bullet, as in the PDF', () => {
        const projects = sectionHtml(render(owner, theme), 'Projects');
        expect(name === 'minimal' ? dashes(projects) : markers(projects)).toBe(7);
        expect(projects).toContain('Wrote a streaming OM-LSA noise suppressor');
    });

    test('the full preview shows every bullet; only the thumbnail trims', () => {
        const many: ResumeData = structuredClone(owner);
        many.projects[0].description = ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.'].map((line) => `• ${line}`).join('\n');
        expect(sectionHtml(render(many, theme), 'Projects')).toContain('Six.');
        expect(sectionHtml(render(many, theme, 'thumb'), 'Projects')).not.toContain('Six.');
    });
});

describe('compact preview follows the compact PDF', () => {
    const html = render(owner, DEFAULT_RESUME_THEME);

    test('internships are one line: company, title, what was done, dates', () => {
        const experience = sectionHtml(html, 'Experience');
        expect(experience).toContain('2Sigma School</span>, <i>SDE Intern</i>. Built a safe, fast remote');
        expect(experience).toContain('Mar – May 2024');
        // Two full roles carry bullets; the two internships do not.
        expect(markers(experience)).toBe(7);
    });

    test('tag line, stack and place sit where the PDF puts them', () => {
        const experience = sectionHtml(html, 'Experience');
        expect(experience).toContain('(established CPaaS, AI voice agents)');
        expect(experience).toContain('<i>Software Engineer I | Go, C, Python</i>');
        expect(experience).toContain('Sep 2025 – Present');
    });

    test('a project title carries its stack and its links', () => {
        const projects = sectionHtml(html, 'Projects');
        expect(projects).toContain('<i>Next.js, TypeScript, Postgres, pgvector, OpenAI</i>');
        expect(projects).toMatch(/href="https:\/\/patronus\.cv"[^>]*>patronus\.cv<\/a>/);
        expect(projects).toMatch(/href="https:\/\/github\.com\/jai0651\/VAD-ASR"[^>]*>repo<\/a>/);
    });

    test('the header prints the links as addresses', () => {
        expect(html).toMatch(/href="https:\/\/github\.com\/jai0651"[^>]*>github\.com\/jai0651<\/a>/);
        expect(html).toContain('+91 76440 53913');
    });

    test('skills keep their own labels', () => {
        expect(sectionHtml(html, 'Skills')).toContain('Speech / AI: </span>');
    });
});

/**
 * The designed templates' previews against their PDFs: the same fields in
 * the same rows, the same dates, the same section names. (The LaTeX side of
 * each assertion is in src/templates/latexDesigned.test.ts.)
 */
describe.each(['executive', 'tech', 'minimal', 'ats-simple'] as const)('%s preview follows its PDF', (templateId) => {
    const html = render(owner, defaultThemeFor(templateId));
    const text = (fragment: string) => fragment.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '');

    test('every field: tag line, stack, place, both dates in full', () => {
        const experience = text(sectionHtml(html, 'Experience'));
        for (const field of ['(established CPaaS, AI voice agents)', 'Go, C, Python', 'Bengaluru', 'Sep 2025 – Present', 'Jun 2024 – Aug 2025']) {
            expect(experience).toContain(field);
        }
        // Internships on one line, their dates in full.
        expect(experience).toContain('. Built a safe, fast remote and in-browser code execution engine');
        expect(experience).toContain('Mar 2024 – May 2024');
        expect(markers(sectionHtml(html, 'Experience')) + dashes(sectionHtml(html, 'Experience'))).toBe(7);
    });

    test('the title and the company in the order the PDF prints them', () => {
        const experience = text(sectionHtml(html, 'Experience'));
        const titleFirst = experience.indexOf('Software Engineer I') < experience.indexOf('Plivo');
        expect(titleFirst).toBe(templateId === 'executive');
    });

    test('projects carry their stack and links; skills keep their labels', () => {
        const projects = sectionHtml(html, 'Projects');
        expect(text(projects)).toContain('Next.js, TypeScript, Postgres, pgvector, OpenAI');
        expect(projects).toMatch(/href="https:\/\/patronus\.cv"[^>]*>patronus\.cv<\/a>/);
        expect(text(sectionHtml(html, 'Skills'))).toContain('Speech / AI:');
        expect(text(sectionHtml(html, 'Education'))).toContain('2020 – 2024');
    });

    test('the header prints the links as addresses', () => {
        expect(html).toMatch(/href="https:\/\/github\.com\/jai0651"[^>]*>github\.com\/jai0651<\/a>/);
        expect(html).toContain('+91 76440 53913');
    });
});

describe('the gallery', () => {
    test('a retired id previews as the template it renders as', () => {
        const legacy = (templateId: 'modern' | 'classic') => render(owner, { ...defaultThemeFor(templateId), templateId });
        expect(legacy('modern')).toContain('data-template="tech"');
        expect(legacy('classic')).toContain('data-template="executive"');
    });

    test('one card per template, each named and described; the current one pressed, a retired id included', () => {
        const html = renderToStaticMarkup(<TemplateGallery data={owner} theme={{ ...defaultThemeFor('modern'), templateId: 'modern' }} onSelect={() => {}} />);
        for (const option of RESUME_TEMPLATE_OPTIONS) {
            expect(html).toContain(`>${option.label}</p>`);
            expect(html).toContain(option.description);
            // Every card previews its own template, from the user's own data.
            expect(html).toContain(`data-template="${option.value as CanonicalTemplateId}"`);
        }
        expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
        // The pressed card, up to the next card.
        const at = html.indexOf('aria-pressed="true"');
        const next = html.indexOf('aria-pressed=', at + 1);
        const pressed = html.slice(at, next < 0 ? undefined : next);
        expect(pressed).toContain('data-template="tech"');
        expect(pressed).toContain('>Tech</p>');
        expect(pressed).toContain('Jai Shankar');
    });

    test('picking a card switches the template, carrying only what the user set', () => {
        const before = useResumeStore.getState().theme;
        try {
            useResumeStore.setState({ theme: { ...DEFAULT_RESUME_THEME, accentColor: '#BE123C' } });
            useResumeStore.getState().setTemplateId('tech');
            expect(useResumeStore.getState().theme).toEqual({ templateId: 'tech', accentColor: '#BE123C', fontFamily: 'sans', density: 'normal' });
            expect(useResumeStore.getState().selectedTemplate).toBe('tech');
        } finally {
            useResumeStore.setState({ theme: before });
        }
    });
});
