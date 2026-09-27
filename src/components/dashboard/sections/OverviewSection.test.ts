import { describe, expect, test } from 'bun:test';
import { nextStepFor } from './OverviewSection';

const base = { hasHistory: false, resumes: 0, tailored: 0, tailoredRemaining: 10, tailoredLimit: 10 };

describe('the dashboard names one next step', () => {
    test('no history → upload your resume', () => {
        expect(nextStepFor(base)?.cta).toBe('Upload your resume');
    });
    test('history, never tailored → tailor it for a job', () => {
        expect(nextStepFor({ ...base, hasHistory: true, resumes: 1 })?.cta).toBe('Tailor it for a job');
    });
    test('already tailoring → no nag, the recent work shows instead', () => {
        expect(nextStepFor({ ...base, hasHistory: true, resumes: 2, tailored: 1 })).toBeNull();
    });
});
