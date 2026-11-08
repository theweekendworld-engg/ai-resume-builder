import { describe, expect, test } from 'bun:test';
import { resumeFileName } from './resumeFileName';

describe('resumeFileName', () => {
    test('the person and the company, never "tailored-resume.pdf"', () => {
        expect(resumeFileName({ fullName: 'Jai Shankar', company: 'iServeWorld' })).toBe('Jai_Shankar_Resume_iServeWorld.pdf');
    });

    test('safe ASCII, no spaces: accents fold, punctuation and legal suffixes drop', () => {
        expect(resumeFileName({ fullName: 'José  Núñez', company: 'Goldman Sachs Pvt. Ltd.' })).toBe('Jose_Nunez_Resume_GoldmanSachs.pdf');
        expect(resumeFileName({ fullName: 'jai shankar', company: 'Acme, Inc.' })).toBe('Jai_Shankar_Resume_Acme.pdf');
        expect(resumeFileName({ fullName: "Conan O'Brien", company: 'R&D Labs' })).toBe('Conan_O_Brien_Resume_RDLabs.pdf');
        expect(resumeFileName({ fullName: 'Jai Shankar', company: 'Amazon — Chennai' })).toMatch(/^[A-Za-z0-9_]+\.pdf$/);
    });

    test('whatever is missing is left out', () => {
        expect(resumeFileName({ fullName: 'Jai Shankar', company: null })).toBe('Jai_Shankar_Resume.pdf');
        expect(resumeFileName({ fullName: '', company: 'Acme' })).toBe('Resume_Acme.pdf');
        expect(resumeFileName({})).toBe('Resume.pdf');
        expect(resumeFileName({ fullName: '李雷', company: null })).toBe('Resume.pdf');
    });

    test('stays short', () => {
        const name = resumeFileName({ fullName: 'A Very Long Given Name Indeed Here', company: 'The Extraordinarily Long Company Name Of Many Words Technologies' });
        expect(name.length).toBeLessThanOrEqual(80);
        expect(name).toEndWith('.pdf');
        expect(name).not.toContain('_.pdf');
    });
});

describe('names in capitals', () => {
    test('a header parsed in capitals is title-cased; mixed case is kept', async () => {
        const { resumeFileName } = await import('./resumeFileName');
        expect(resumeFileName({ fullName: 'JAI SHANKAR', company: 'Sarvam Labs' })).toBe('Jai_Shankar_Resume_SarvamLabs.pdf');
        expect(resumeFileName({ fullName: 'Ada McDonald', company: 'Acme' })).toBe('Ada_McDonald_Resume_Acme.pdf');
    });
});
