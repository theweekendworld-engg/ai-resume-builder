import { describe, expect, test } from 'bun:test';
import { completionCaption, completionKeyboard } from './telegramGenerationNotifications';

describe('the resume-ready caption', () => {
    test('says what it is, from the compiled PDF and the job; never an ATS estimate', () => {
        expect(completionCaption({ pages: 1, role: 'Forward Deployed AI Engineer', company: 'iServeWorld' }))
            .toBe('One page, tailored for Forward Deployed AI Engineer at iServeWorld.');
        expect(completionCaption({ pages: 2, role: 'SDE II', company: 'Amazon' })).toBe('2 pages, tailored for SDE II at Amazon.');
        expect(completionCaption({ pages: null, role: 'SDE II', company: 'Amazon' })).toBe('Tailored for SDE II at Amazon.');
        expect(completionCaption({ pages: null, role: null, company: null })).toBe('Your tailored resume is ready.');
        expect(completionCaption({ pages: 1, role: 'SDE II', company: 'Amazon' })).not.toMatch(/ATS/);
    });

    test('Open resume and Regenerate under it; no Status button', () => {
        const keyboard = completionKeyboard('sess1', 'https://aicv.example.com/editor/r1');
        expect(keyboard.inline_keyboard).toEqual([[
            { text: 'Open resume', url: 'https://aicv.example.com/editor/r1' },
            { text: 'Regenerate', callback_data: 'regen:sess1' },
        ]]);
    });
});
