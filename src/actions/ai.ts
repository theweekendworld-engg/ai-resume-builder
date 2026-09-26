'use server';

/**
 * Public resume-AI actions. Every one takes identity from the SESSION only.
 *
 * The implementations live in `src/lib/resumeAi.ts`, which is not an endpoint.
 * These wrappers exist so a browser can reach them, and that is exactly why
 * none of them accepts a user id: a `'use server'` export is a public endpoint,
 * and an id in its arguments is an id the caller chose.
 */

import { requireAuth } from '@/lib/auth';
import * as impl from '@/lib/resumeAi';
import type { ResumeData } from '@/types/resume';

export async function improveText(text: string, type: 'summary' | 'bullet' | 'project', customInstruction?: string) {
    return impl.improveText(text, type, customInstruction);
}

export async function extractKeywords(jobDescription: string): Promise<string[]> {
    return impl.extractKeywords(jobDescription);
}

export async function calculateATSScore(resumeData: ResumeData, jobDescription: string) {
    const userId = await requireAuth();
    return impl.calculateATSScore(resumeData, jobDescription, { userId });
}

export async function generateTailoredResume(
    jobDescription: string,
    existingData: ResumeData,
    githubRepos?: { name: string; description: string; language: string; url: string }[],
    knowledgeBullets?: string[],
): Promise<ResumeData> {
    const userId = await requireAuth();
    return impl.generateTailoredResume(jobDescription, existingData, githubRepos, knowledgeBullets, { userId });
}

export async function modifyLatex(currentCode: string, instruction: string) {
    return impl.modifyLatex(currentCode, instruction);
}

export async function resumeToLatex(resumeData: ResumeData): Promise<string> {
    return impl.resumeToLatex(resumeData);
}

export async function latexToResume(latexCode: string): Promise<ResumeData> {
    return impl.latexToResume(latexCode);
}

export async function compileLatex(latexCode: string) {
    const userId = await requireAuth();
    return impl.compileLatex(latexCode, { userId });
}

export async function improveSection(
    sectionType: 'summary' | 'experience' | 'project' | 'skills',
    currentContent: string,
    jobDescription?: string,
    instruction?: string,
): Promise<string> {
    return impl.improveSection(sectionType, currentContent, jobDescription, instruction);
}
