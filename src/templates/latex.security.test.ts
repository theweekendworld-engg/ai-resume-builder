import { describe, expect, test } from 'bun:test';
import { generateLatexFromResume } from './latex';
import { initialResumeData } from '@/types/resume';

describe('LaTeX output escapes user-supplied links (audit 2026-10-02)', () => {
    test('a link cannot close \\href and inject a command', () => {
        const data = structuredClone(initialResumeData);
        data.personalInfo = {
            ...data.personalInfo,
            fullName: 'Test Person',
            linkedin: 'https://linkedin.com/in/x}\\input{/etc/passwd}',
            website: 'https://site.dev/a%20b#top',
        };
        const latex = generateLatexFromResume(data);
        expect(latex).not.toContain('\\input{/etc/passwd}');
        expect(latex).not.toMatch(/\\href\{[^}]*\}\\input/);
        expect(latex).toContain('a\\%20b\\#top');
    });
});
