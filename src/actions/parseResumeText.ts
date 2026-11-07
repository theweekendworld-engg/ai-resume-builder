'use server';

import { z } from 'zod';
import type { ResumeData } from '@/types/resume';
import { requireAuth } from '@/lib/auth';
import { parseResumeText as parseFaithfully } from '@/lib/resumeParser';
import { resumeDataFromParsed } from '@/lib/resume/fromParsed';
import { aiFailureMessage } from '@/lib/usageTracker';

const ParseResumeTextInputSchema = z.object({
    text: z.string().min(1).max(60000),
});

/**
 * Parse raw resume text (e.g. the `extractedText` carried over from the
 * anonymous free checker) into structured `ResumeData`.
 *
 * This had its own prompt and its own model call, asking for each role's
 * "description" as free text — a second importer that could write lines the
 * resume never said. It now runs the one faithful import
 * (`lib/resumeParser.parseResumeText`): a guarded structured call, then every
 * bullet, skills row and tag line rebuilt from the text itself.
 */
export async function parseResumeText(text: string): Promise<ResumeData> {
    const parsedInput = ParseResumeTextInputSchema.safeParse({ text });
    if (!parsedInput.success) {
        throw new Error(parsedInput.error.issues.map((issue) => issue.message).join('; '));
    }
    const userId = await requireAuth();

    try {
        const parsed = await parseFaithfully(parsedInput.data.text, userId);
        return resumeDataFromParsed(parsed);
    } catch (error: unknown) {
        console.error('Parse Resume Text Error:', error);
        // The ceiling's own words when that is why; "try again" would fail the same way.
        throw new Error(aiFailureMessage(error, 'Failed to parse resume text into structured data.'));
    }
}
