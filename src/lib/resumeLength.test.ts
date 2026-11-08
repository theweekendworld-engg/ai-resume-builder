import { describe, expect, test } from 'bun:test';

import { resumeAiVoiceData } from '@/__fixtures__/resume/resumeAiVoice';
import type { CanonicalTemplateId, ResumeData } from '@/types/resume';
import { estimateResumeLength } from './resumeLength';

/**
 * The editor's "~N pages" badge, held to what the compiler said on
 * 2026-11-08 for the owner's resume in each template at normal density:
 * one page as imported, still one page with two one-line bullets added, two
 * pages with a third, and two with a three-line summary.
 */
const SUMMARY =
    'AI engineer building real-time voice agents end to end, from FreeSWITCH media paths in C to streaming ASR and TTS models trained from scratch in PyTorch, with production experience across telephony, messaging and fintech backends.';
const LINE = 'Added one more line of shipped work to find the page break.';

function variant({ extraLines = 0, summary = false }: { extraLines?: number; summary?: boolean }): ResumeData {
    const data = resumeAiVoiceData();
    if (summary) data.personalInfo.summary = SUMMARY;
    if (extraLines > 0) data.experience[1].description += `\n${Array.from({ length: extraLines }, () => `• ${LINE}`).join('\n')}`;
    return data;
}

/** [variant, pages the compiled PDF had] — the same for every template. */
const MEASURED: Array<[string, ResumeData, number]> = [
    ['as imported', variant({}), 1],
    ['two lines added', variant({ extraLines: 2 }), 1],
    ['three lines added', variant({ extraLines: 3 }), 2],
    ['ten lines added', variant({ extraLines: 10 }), 2],
    ['with a summary', variant({ summary: true }), 2],
];

const TEMPLATES: CanonicalTemplateId[] = ['compact', 'executive', 'tech', 'minimal', 'ats-simple'];

describe('estimateResumeLength', () => {
    describe.each(TEMPLATES)('%s: the estimate agrees with the compiled page count', (templateId) => {
        test.each(MEASURED)('%s', (_name, data, pages) => {
            const estimate = estimateResumeLength(data, templateId);
            expect(estimate.pageCount).toBe(pages);
            expect(estimate.fitsOnePage).toBe(pages === 1);
        });
    });

    test('a retired id is estimated as the template it renders as', () => {
        const data = variant({ extraLines: 2 });
        expect(estimateResumeLength(data, 'modern')).toEqual(estimateResumeLength(data, 'tech'));
        expect(estimateResumeLength(data, 'classic')).toEqual(estimateResumeLength(data, 'executive'));
    });

    test('without a template, the default template\'s estimate', () => {
        expect(estimateResumeLength(variant({}))).toEqual(estimateResumeLength(variant({}), 'compact'));
    });

    test('overflow is counted in lines past the page', () => {
        const over = estimateResumeLength(variant({ extraLines: 10 }), 'compact');
        expect(over.overflowLines).toBeGreaterThan(0);
        expect(over.estimatedPages).toBeGreaterThan(1);
        expect(estimateResumeLength(variant({}), 'compact').overflowLines).toBe(0);
    });
});
