import { describe, expect, test } from 'bun:test';

import { resumeAiVoiceData } from '@/__fixtures__/resume/resumeAiVoice';
import { estimateResumeLength } from './resumeLength';

/**
 * The editor's "~N pages" badge, held to what the compiler said on
 * 2026-11-07 for the owner's resume: one page in compact as imported, two
 * with a three-line summary added, two in ats-simple either way.
 */
describe('estimateResumeLength', () => {
    const owner = resumeAiVoiceData();
    const withSummary = structuredClone(owner);
    withSummary.personalInfo.summary =
        'AI engineer building real-time voice agents end to end, from FreeSWITCH media paths in C to streaming ASR and TTS models trained from scratch in PyTorch, with production experience across telephony, messaging and fintech backends.';

    test('compact: the imported resume fits one page; with a summary it does not', () => {
        expect(estimateResumeLength(owner, 'compact').fitsOnePage).toBe(true);
        expect(estimateResumeLength(withSummary, 'compact').fitsOnePage).toBe(false);
    });

    test('the older templates keep their own estimate, which says two pages', () => {
        expect(estimateResumeLength(owner).fitsOnePage).toBe(false);
        expect(estimateResumeLength(owner, 'ats-simple')).toEqual(estimateResumeLength(owner));
    });
});
