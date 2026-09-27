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

    test('description and highlights become deduplicated bullets', () => {
        expect(data.experience[0].description).toBe('• Cut p95 from 4.2s to 900ms.\n• Led 9-service migration');
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
