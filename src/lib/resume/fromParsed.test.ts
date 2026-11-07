import { describe, expect, test } from 'bun:test';
import { ParsedResumeSchema } from '@/lib/aiSchemas';
import { resumeDataFromParsed, resumeTitleFromParsed } from './fromParsed';

const parsed = ParsedResumeSchema.parse({
    personalInfo: { fullName: 'Priya Raman', title: 'Senior Software Engineer', email: 'p@example.com' },
    experiences: [
        { company: 'Flexport', role: 'Senior SWE', current: true, endDate: 'Present', description: 'Cut p95 from 4.2s to 900ms.', highlights: ['• Led 9-service migration', 'Cut p95 from 4.2s to 900ms.'] },
        { company: '', role: '' },
    ],
    projects: [{ name: 'Search', githubUrl: 'github.com/p/search', technologies: ['Go'] }, { name: '' }],
    education: [{ institution: 'University of Bristol', degree: 'BSc', fieldOfStudy: 'CS' }],
    skills: ['Go', ' Go ', 'Kubernetes', ''],
});

describe('resumeDataFromParsed', () => {
    const data = resumeDataFromParsed(parsed);

    test('keeps every real entry and drops blank ones', () => {
        expect(data.experience).toHaveLength(1);
        expect(data.projects).toHaveLength(1);
        expect(data.education).toHaveLength(1);
    });

    test('highlights become the bullets; the description is not printed beside them', () => {
        // Printing both made a role say the same thing twice, and a summary the
        // model wrote became the first bullet (QA 2026-11-07, finding 1).
        expect(data.experience[0].description).toBe('• Led 9-service migration\n• Cut p95 from 4.2s to 900ms.');
    });

    test('a role with no highlights falls back to its description lines', () => {
        const only = resumeDataFromParsed(ParsedResumeSchema.parse({
            personalInfo: {},
            experiences: [{ company: 'Acme', role: 'Engineer', description: 'Built X.\nShipped Y.' }],
        }));
        expect(only.experience[0].description).toBe('• Built X.\n• Shipped Y.');
    });

    test('tag line, stack and the resume\'s own skills rows are carried', () => {
        const rich = resumeDataFromParsed(ParsedResumeSchema.parse({
            personalInfo: {},
            experiences: [{ company: 'Plivo', role: 'Software Engineer I', companyNote: 'established CPaaS', stack: 'Go, C', highlights: ['Shipped it.'] }],
            projects: [{ name: 'Voice agent', description: 'Built every stage.\nWrote a suppressor.' }],
            skills: ['PyTorch', 'TTS'],
            skillGroups: [{ label: 'Speech / AI', items: ['PyTorch', 'TTS'] }],
        }));
        expect(rich.experience[0].companyNote).toBe('established CPaaS');
        expect(rich.experience[0].stack).toBe('Go, C');
        expect(rich.projects[0].description).toBe('• Built every stage.\n• Wrote a suppressor.');
        expect(rich.skillGroups).toEqual([{ label: 'Speech / AI', items: ['PyTorch', 'TTS'] }]);
    });

    test('a current role has no end date; urls map to url/repoUrl', () => {
        expect(data.experience[0].current).toBe(true);
        expect(data.experience[0].endDate).toBe('');
        expect(data.projects[0].repoUrl).toBe('github.com/p/search');
        expect(data.projects[0].url).toBe('github.com/p/search');
    });

    test('skills are trimmed and unique; nothing is invented', () => {
        expect(data.skills).toEqual(['Go', 'Kubernetes']);
        expect(data.personalInfo.fullName).toBe('Priya Raman');
        expect(data.sectionOrder).toEqual(['summary', 'experience', 'projects', 'education', 'skills']);
    });

    test('the title names the role when there is one', () => {
        expect(resumeTitleFromParsed(parsed)).toBe('Senior Software Engineer resume');
        expect(resumeTitleFromParsed(ParsedResumeSchema.parse({ personalInfo: {} }))).toBe('My resume');
    });
});
