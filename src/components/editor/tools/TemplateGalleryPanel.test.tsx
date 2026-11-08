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
import { DEFAULT_RESUME_THEME, LEGACY_RESUME_THEME, type ResumeData, type ResumeTheme } from '@/types/resume';
import { ResumeHtmlPreview } from './TemplateGalleryPanel';

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

describe.each([
    ['compact', DEFAULT_RESUME_THEME],
    ['ats-simple', LEGACY_RESUME_THEME],
] as const)('%s preview', (_name, theme) => {
    test('every project bullet is a bullet, as in the PDF', () => {
        const projects = sectionHtml(render(owner, theme), 'Projects');
        expect(markers(projects)).toBe(7);
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
