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
import { gateMeteredAction, refundMeteredAction } from '@/lib/entitlements';
import { checkAiRateLimit } from '@/lib/rateLimit';
import * as impl from '@/lib/resumeAi';
import type { ResumeData } from '@/types/resume';

/**
 * Signed in, under the per-user AI rate limit, and inputs bounded. These were
 * reachable at any rate with up to the 1MB server-action body in one prompt
 * (launch audit 2026-10-02); the monthly cost cap was the only ceiling.
 */
async function guard(...inputs: Array<[string | undefined, number]>): Promise<string> {
    const userId = await requireAuth();
    const limited = await checkAiRateLimit(`ai:${userId}`);
    if (!limited.allowed) throw new Error(limited.error ?? 'Too many requests');
    for (const [value, max] of inputs) {
        if (value && value.length > max) throw new Error(`That is too long (over ${max.toLocaleString('en-US')} characters).`);
    }
    return userId;
}

const TEXT = 8_000;
const JD = 30_000;
const LATEX = 120_000;
const RESUME_JSON = 200_000;

export async function improveText(text: string, type: 'summary' | 'bullet' | 'project', customInstruction?: string) {
    await guard([text, TEXT], [customInstruction, 1_000]);
    return impl.improveText(text, type, customInstruction);
}

export async function extractKeywords(jobDescription: string): Promise<string[]> {
    await guard([jobDescription, JD]);
    return impl.extractKeywords(jobDescription);
}

export async function calculateATSScore(resumeData: ResumeData, jobDescription: string) {
    const userId = await guard([jobDescription, JD], [JSON.stringify(resumeData ?? {}), RESUME_JSON]);
    return impl.calculateATSScore(resumeData, jobDescription, { userId });
}

/** A full tailored resume, so it spends a `tailored_generation`, like every other path that writes one. */
export async function generateTailoredResume(
    jobDescription: string,
    existingData: ResumeData,
    githubRepos?: { name: string; description: string; language: string; url: string }[],
    knowledgeBullets?: string[],
): Promise<ResumeData> {
    const userId = await guard(
        [jobDescription, JD],
        [JSON.stringify(existingData ?? {}), RESUME_JSON],
        [JSON.stringify(githubRepos ?? []), 50_000],
        [JSON.stringify(knowledgeBullets ?? []), 50_000],
    );
    await gateMeteredAction(userId, 'tailored_generation');
    try {
        return await impl.generateTailoredResume(jobDescription, existingData, githubRepos, knowledgeBullets, { userId });
    } catch (error) {
        await refundMeteredAction(userId, 'tailored_generation', { reason: 'tailored_generation_failed' });
        throw error;
    }
}

export async function modifyLatex(currentCode: string, instruction: string) {
    await guard([currentCode, LATEX], [instruction, 2_000]);
    return impl.modifyLatex(currentCode, instruction);
}

export async function resumeToLatex(resumeData: ResumeData): Promise<string> {
    await guard([JSON.stringify(resumeData ?? {}), RESUME_JSON]);
    return impl.resumeToLatex(resumeData);
}

export async function latexToResume(latexCode: string): Promise<ResumeData> {
    await guard([latexCode, LATEX]);
    return impl.latexToResume(latexCode);
}

export async function compileLatex(latexCode: string) {
    const userId = await guard([latexCode, LATEX]);
    return impl.compileLatex(latexCode, { userId });
}

export async function improveSection(
    sectionType: 'summary' | 'experience' | 'project' | 'skills',
    currentContent: string,
    jobDescription?: string,
    instruction?: string,
): Promise<string> {
    await guard([currentContent, TEXT * 2], [jobDescription, JD], [instruction, 1_000]);
    return impl.improveSection(sectionType, currentContent, jobDescription, instruction);
}
