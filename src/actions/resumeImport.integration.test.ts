/**
 * Importing a resume into Profile also gives a new user their base resume, so
 * "Tailor my resume" works right after (e2e QA 2026-11-08: a fresh import left
 * a full record and no resume, and tailoring said "Upload your resume first").
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { installMocks, uninstallMocks } from '@/__mocks__';
import { installClerkMock } from '@/__mocks__/clerk';
import { prisma } from '@/lib/prisma';
import type { ParsedResumeData } from '@/lib/aiSchemas';
import { cleanupTestUser, newTestUserId } from '@/services/winFixtures.test-utils';

const clerk = installClerkMock();
const { importParsedResumeData } = await import('@/actions/resumeImport');

const users: string[] = [];
function signIn(label: string): string {
    const id = newTestUserId(`import-${label}`);
    users.push(id);
    clerk.signIn(id);
    return id;
}

// Creating an experience embeds it; never call the real API from a test.
beforeAll(() => installMocks({ only: ['openai'] }));

afterAll(async () => {
    uninstallMocks();
    for (const id of users) {
        await prisma.resume.deleteMany({ where: { userId: id } });
        await cleanupTestUser(id);
    }
});

const PARSED = {
    personalInfo: { fullName: 'Ada Fowler', email: 'ada@example.com', phone: '', location: 'Bengaluru, India', website: '', linkedin: '', github: '', title: 'AI Engineer', summary: '' },
    experiences: [{
        company: 'Plivo', role: 'Software Engineer I', location: 'Bengaluru', startDate: 'Sep 2025', endDate: 'Present', current: true,
        description: '', highlights: ['Built an agentic AI support platform using RAG, cutting support workload by ~50%.'],
    }],
    education: [],
    projects: [],
    skills: ['Go', 'Python'],
    achievements: [],
} as unknown as ParsedResumeData;

const OPTIONS = { mergeProfile: true, sections: { experience: true, education: true, projects: true, achievements: true } } as never;

describe('importParsedResumeData', () => {
    test('a first import creates the base resume that tailoring starts from', async () => {
        const userId = signIn('first');
        const result = await importParsedResumeData(PARSED, OPTIONS);
        expect(result.success).toBe(true);
        expect(result.summary?.baseResumeId).toBeTruthy();

        const base = await prisma.resume.findFirstOrThrow({ where: { userId, baseResumeId: null } });
        expect(base.title).toBe('AI Engineer resume');
        const content = base.content as { experience: { company: string; description: string }[] };
        expect(content.experience[0].company).toBe('Plivo');
        // Faithful: the source line, qualifier and all.
        expect(content.experience[0].description).toContain('~50%');
    });

    test('a second import never makes another base resume', async () => {
        const userId = signIn('second');
        await importParsedResumeData(PARSED, OPTIONS);
        const again = await importParsedResumeData(PARSED, OPTIONS);
        expect(again.summary?.baseResumeId).toBeUndefined();
        expect(await prisma.resume.count({ where: { userId, baseResumeId: null } })).toBe(1);
    });
});
