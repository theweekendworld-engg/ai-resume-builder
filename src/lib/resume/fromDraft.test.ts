import { describe, expect, test } from 'bun:test';
import type { ResumeDraft } from '@/lib/ai/resumeLoop';
import { resumeFromDraft, sourceWasSeen } from './fromDraft';

const EVIDENCE = [
    'Cut checkout p95 latency from 800ms to 180ms by batching the pricing lookup.',
    'Led the migration of 12 services onto Kubernetes.',
    'Project: ledger-service. A double-entry ledger in Go.',
].join('\n');

function draft(patch: Partial<ResumeDraft> = {}): ResumeDraft {
    return {
        headline: 'Backend Engineer',
        summary: 'Backend engineer focused on payments reliability.',
        experience: [{
            roleId: 'r1', company: 'Northwind', role: 'Backend Engineer', startDate: '2021', endDate: 'Present', location: 'Remote',
            bullets: [
                { text: 'Cut checkout p95 latency from 800ms to 180ms by batching pricing lookups', sourceLine: 'Cut checkout p95 latency from 800ms to 180ms by batching the pricing lookup.', answers: [] },
                { text: 'Migrated 12 services onto Kubernetes', sourceLine: 'Led the migration of 12 services onto Kubernetes.', answers: [] },
            ],
        }],
        projects: [{ name: 'ledger-service', description: 'A double-entry ledger in Go.', technologies: ['go'], url: '' }],
        education: [],
        skills: [{ group: 'Languages', items: ['Go'] }],
        rationale: 'test',
        ...patch,
    };
}

const check = (d: ResumeDraft) => resumeFromDraft({ draft: d, contact: null, availableRoles: 1, evidenceSeen: EVIDENCE });

describe('resumeFromDraft (no fabricated quantities)', () => {
    test('a clean draft passes with no violations', () => {
        const result = check(draft());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.violations).toEqual([]);
        expect(result.resume.experience[0].description.split('\n')).toHaveLength(2);
    });

    test('a bullet citing a source line the model never saw is dropped', () => {
        const d = draft();
        d.experience[0].bullets.push({ text: 'Grew revenue 40%', sourceLine: 'Grew revenue 40% in one quarter.', answers: [] });
        const result = check(d);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.resume.experience[0].description).not.toContain('40%');
        expect(result.violations.join(' ')).toContain('source line the record does not contain');
    });

    test('a figure absent from its own source line is dropped', () => {
        const d = draft();
        d.experience[0].bullets[1] = { text: 'Migrated 30 services onto Kubernetes', sourceLine: 'Led the migration of 12 services onto Kubernetes.', answers: [] };
        const result = check(d);
        expect(result.ok && result.resume.experience[0].description).not.toContain('30 services');
    });

    test('an invented figure in the summary or a project is stripped, not shipped', () => {
        const result = check(draft({
            summary: 'Backend engineer who saved $2M a year.',
            projects: [{ name: 'ledger-service', description: 'Handles 50k transactions per second.', technologies: [], url: '' }],
        }));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.resume.personalInfo.summary).toBe('');
        expect(result.resume.projects[0].description).toBe('');
        expect(result.violations.length).toBe(2);
    });

    test('when every line is bad, the draft is empty and refused', () => {
        const d = draft();
        d.experience[0].bullets = [{ text: 'Invented 99% uptime', sourceLine: 'Invented 99% uptime', answers: [] }];
        const result = check(d);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason.kind).toBe('empty');
    });
});

describe('sourceWasSeen', () => {
    test('matches a verbatim line regardless of case and punctuation', () => {
        expect(sourceWasSeen('led the migration of 12 services onto kubernetes', EVIDENCE)).toBe(true);
        expect(sourceWasSeen('Led the migration of 13 services', EVIDENCE)).toBe(false);
        expect(sourceWasSeen('', EVIDENCE)).toBe(false);
    });
});
