import { describe, expect, test } from 'bun:test';

import type { ResumeData } from '@/types/resume';
import { describeFit, fitToPages, nextTrim, type CompileResult } from './pageFit';

const MEDIA = 'Optimized the voice media path and shipped neural noise cancellation as a FreeSWITCH module in C, used on 7.5M calls, raising concurrent call capacity 2x per machine and cutting fleet infrastructure cost by 50%.';

function resume(): ResumeData {
    return {
        personalInfo: {
            fullName: 'Jai Shankar', title: 'AI Engineer', email: '', phone: '', location: '', website: '', linkedin: '', github: '',
            summary: 'Software Engineer I at Plivo, previously at Hyperbots.',
        },
        experience: [
            { id: 'plivo', company: 'Plivo', role: 'Software Engineer I', startDate: 'Sep 2025', endDate: '', current: true, location: '', description: [MEDIA, 'Built an agentic AI support platform.', 'Built SMS routing.', 'Developed deploy automation, cutting time by 70%.'].join('\n') },
            { id: 'hyperbots', company: 'Hyperbots', role: 'Software Engineer I', startDate: 'Jun 2024', endDate: 'Aug 2025', current: false, location: '', description: ['Built 5 microservices.', 'Moved screens to CQRS.', 'Cut API response times by 40%.'].join('\n') },
        ],
        projects: [
            { id: 'p0', name: 'Voice agent', description: ['Built every stage.', 'Halved CER.', 'Wrote an OM-LSA suppressor: 8.1 dB at 16 ms.'].join('\n'), url: '', liveUrl: '', repoUrl: '', technologies: [] },
            { id: 'p1', name: 'Tonecall', description: ['Designed a protocol.', 'Built the telephony runtime.'].join('\n'), url: '', liveUrl: '', repoUrl: '', technologies: [] },
        ],
        education: [],
        skills: ['Python', 'Go', 'PyTorch', 'FreeSWITCH'],
        skillGroups: [
            { label: 'Languages', items: ['Python', 'Go'] },
            { label: 'Speech / AI', items: ['PyTorch'] },
            { label: 'Voice infra', items: ['FreeSWITCH'] },
        ],
        sectionOrder: ['summary', 'experience', 'projects', 'education', 'skills'],
    };
}

/** Lines the fake "renders": one per bullet, one per entry heading, one per skills row, two for the About. */
function size(doc: ResumeData): number {
    const bullets = (text: string) => text.split('\n').filter(Boolean).length;
    return (
        doc.experience.reduce((sum, role) => sum + 1 + bullets(role.description), 0) +
        doc.projects.reduce((sum, project) => sum + 1 + bullets(project.description), 0) +
        (doc.personalInfo.summary ? 2 : 0) +
        new Set(doc.skills).size
    );
}

/** A compiler whose page count is the rendered size over a page's capacity. */
function fakeCompiler(capacity: number) {
    const calls: ResumeData[] = [];
    let current: ResumeData | null = null;
    return {
        calls,
        render: (doc: ResumeData) => {
            current = structuredClone(doc);
            return JSON.stringify(doc);
        },
        compile: async (): Promise<CompileResult> => {
            calls.push(current!);
            return { success: true, pdfBase64: `pdf-${calls.length}`, pages: Math.ceil(size(current!) / capacity) };
        },
    };
}

const allLines = (doc: ResumeData) => [
    ...doc.experience.flatMap((role) => role.description.split('\n')),
    ...doc.projects.flatMap((project) => project.description.split('\n')),
];

describe('fitToPages', () => {
    test('a resume that fits is compiled once and left alone', async () => {
        const fake = fakeCompiler(100);
        const result = await fitToPages({ resume: resume(), ...fake });
        if (!result.ok) throw new Error(result.error);
        expect(result.fit).toMatchObject({ status: 'fits', pages: 1, attempts: 1, trimmed: [] });
        expect(result.resume).toEqual(resume());
        expect(result.pdfBase64).toBe('pdf-1');
    });

    test('over one page: the weakest project bullet goes first, then recompiles', async () => {
        const fake = fakeCompiler(size(resume()) - 1);
        const result = await fitToPages({ resume: resume(), ...fake });
        if (!result.ok) throw new Error(result.error);
        expect(result.fit.status).toBe('trimmed');
        expect(result.fit.pages).toBe(1);
        expect(result.fit.attempts).toBe(2);
        expect(result.fit.trimmed).toEqual([
            { kind: 'project_bullet', text: 'Built the telephony runtime.', targetId: 'p1', targetKind: 'project', targetLabel: 'Tonecall' },
        ]);
        // The kept PDF is the one that fits, from the trimmed document.
        expect(result.pdfBase64).toBe('pdf-2');
        expect(result.resume.projects[1].description).toBe('Designed a protocol.');
    });

    test('the order is project bullet, project, About line, skills row, experience bullet', async () => {
        const steps: string[] = [];
        const doc = resume();
        for (let step = nextTrim(doc); step; step = nextTrim(doc)) {
            steps.push(step.item.kind);
            step.apply(doc);
        }
        expect(steps).toEqual([
            'project_bullet', 'project_bullet', 'project_bullet',
            'project', 'project',
            'summary',
            'skills_row', 'skills_row',
            'experience_bullet', 'experience_bullet', 'experience_bullet',
        ]);
        // Never below two lines a role.
        expect(doc.experience.map((role) => role.description.split('\n').length)).toEqual([2, 2]);
    });

    test('lines are cut whole: the metric half of a bullet is never what goes', async () => {
        const fake = fakeCompiler(8);
        const result = await fitToPages({ resume: resume(), ...fake, maxAttempts: 20 });
        if (!result.ok) throw new Error(result.error);
        const original = new Set(allLines(resume()));
        for (const line of allLines(result.resume)) expect(original.has(line)).toBe(true);
        // The strongest line of the strongest role survives everything.
        expect(result.resume.experience[0].description.split('\n')[0]).toBe(MEDIA);
    });

    test('bounded: when it cannot fit, it stops and says so', async () => {
        const fake = fakeCompiler(2);
        const result = await fitToPages({ resume: resume(), ...fake, maxAttempts: 4 });
        if (!result.ok) throw new Error(result.error);
        expect(result.fit.status).toBe('over');
        expect(result.fit.attempts).toBe(4);
        expect(fake.calls).toHaveLength(4);
        expect(result.fit.pages).toBeGreaterThan(1);
        expect(describeFit(result.fit)).toContain('Still');
    });

    test('nothing left to trim is "over", not a loop', async () => {
        const fake = fakeCompiler(1);
        const result = await fitToPages({ resume: resume(), ...fake, maxAttempts: 100 });
        if (!result.ok) throw new Error(result.error);
        expect(result.fit.status).toBe('over');
        expect(result.fit.attempts).toBeLessThan(100);
    });

    test('a known overflow is trimmed in one pass, not one recompile per line', async () => {
        const fake = fakeCompiler(size(resume()) - 4);
        const result = await fitToPages({
            resume: resume(),
            ...fake,
            measure: async () => ({ pages: Math.ceil(size(fake.calls.at(-1)!) / (size(resume()) - 4)), overflowLines: 4 }),
        });
        if (!result.ok) throw new Error(result.error);
        expect(result.fit.status).toBe('trimmed');
        expect(result.fit.attempts).toBe(2);
        expect(result.fit.trimmed.length).toBeGreaterThanOrEqual(3);
    });

    test('an unmeasurable PDF is shipped as unchecked, never silently as fitting', async () => {
        const result = await fitToPages({
            resume: resume(),
            render: () => 'x',
            compile: async () => ({ success: true, pdfBase64: 'pdf' }),
            measure: async () => ({ pages: null }),
        });
        if (!result.ok) throw new Error(result.error);
        expect(result.fit.status).toBe('unchecked');
        expect(result.fit.trimmed).toEqual([]);
    });

    test('a compile failure is an error, not a resume', async () => {
        const result = await fitToPages({ resume: resume(), render: () => 'x', compile: async () => ({ success: false, error: 'boom' }) });
        expect(result).toEqual({ ok: false, error: 'boom' });
    });

    test('a two-page budget lets two pages through', async () => {
        const fake = fakeCompiler(Math.ceil(size(resume()) / 2));
        const result = await fitToPages({ resume: resume(), ...fake, maxPages: 2 });
        if (!result.ok) throw new Error(result.error);
        expect(result.fit).toMatchObject({ status: 'fits', pages: 2, maxPages: 2 });
    });
});
