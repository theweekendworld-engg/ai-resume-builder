'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ResumeData } from '@/types/resume';
import { auth } from '@clerk/nextjs/server';
import { ResumeDataSchema } from '@/lib/aiSchemas';

const SaveResumeSchema = z.object({
    resumeData: ResumeDataSchema,
    title: z.string().max(500).optional(),
    source: z.enum(['manual', 'ai', 'import']).optional(),
    resumeId: z.string().cuid().optional(),
    atsScore: z.number().int().min(0).max(100).optional(),
});

const CreateResumeSchema = z.object({
    title: z.string().max(500).optional(),
    resumeData: ResumeDataSchema.optional(),
    source: z.enum(['manual', 'ai', 'import']).optional(),
    atsScore: z.number().int().min(0).max(100).optional(),
});

function deriveResumeMetadata(resumeData: ResumeData, atsScore?: number) {
    const targetRole = resumeData.personalInfo.title?.trim() || resumeData.experience[0]?.role?.trim() || null;
    const targetCompany = resumeData.experience[0]?.company?.trim() || null;
    const summaryRaw = resumeData.personalInfo.summary?.trim() || '';
    const atsSummary = summaryRaw ? summaryRaw.slice(0, 180) : null;

    return {
        targetRole,
        targetCompany,
        atsScore: typeof atsScore === 'number' ? atsScore : null,
        atsSummary,
    };
}

async function getAuthenticatedUserId(): Promise<string | null> {
    const { userId } = await auth();
    return userId ?? null;
}

export async function saveResumeToCloud(
    resumeData: ResumeData,
    title?: string,
    source: 'manual' | 'ai' | 'import' = 'manual',
    resumeId?: string,
    atsScore?: number
): Promise<{ success: boolean; resumeId?: string; error?: string }> {
    const parsed = SaveResumeSchema.safeParse({ resumeData, title, source, resumeId, atsScore });
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
    }
    const { resumeData: data, title: safeTitle, resumeId: safeResumeId, atsScore: safeAtsScore } = parsed.data;

    try {
        const userId = await getAuthenticatedUserId();
        if (!userId) {
            return { success: false, error: 'Not authenticated' };
        }

        const payload = data as object;
        const resume = safeResumeId
            ? await prisma.resume.findFirst({
                where: { id: safeResumeId, userId },
            })
            : null;

        const metadata = deriveResumeMetadata(data as ResumeData, safeAtsScore);
        const savedResumeId = await prisma.$transaction(async (tx) => {
            const targetResume = resume ?? await tx.resume.create({
                data: { userId, title: safeTitle ?? 'My Resume' },
            });

            await tx.resume.update({
                where: { id: targetResume.id },
                data: {
                    content: payload,
                    title: safeTitle ?? targetResume.title,
                    targetRole: metadata.targetRole,
                    targetCompany: metadata.targetCompany,
                    atsScore: metadata.atsScore,
                    atsSummary: metadata.atsSummary,
                    updatedAt: new Date(),
                },
            });

            return targetResume.id;
        });
        return { success: true, resumeId: savedResumeId };
    } catch (error: unknown) {
        console.error('Failed to save resume to cloud:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export async function loadResumeFromCloud(resumeId?: string): Promise<{
    success: boolean;
    data?: ResumeData;
    title?: string;
    resumeId?: string;
    updatedAt?: Date;
    error?: string;
}> {
    try {
        const userId = await getAuthenticatedUserId();
        if (!userId) {
            return { success: false, error: 'Not authenticated' };
        }

        const resume = resumeId
            ? await prisma.resume.findFirst({
                where: { id: resumeId, userId },
            })
            : await prisma.resume.findFirst({
                where: { userId },
                orderBy: { updatedAt: 'desc' },
            });
        if (!resume) return { success: true, data: undefined };

        const content = (resume.content ?? null) as ResumeData | null;
        const updatedAt = resume.updatedAt;

        return {
            success: true,
            data: content ?? undefined,
            title: resume.title,
            resumeId: resume.id,
            updatedAt,
        };
    } catch (error: unknown) {
        console.error('Failed to load resume from cloud:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export async function deleteResumeFromCloud(resumeId?: string): Promise<{ success: boolean; error?: string }> {
    try {
        const userId = await getAuthenticatedUserId();
        if (!userId) {
            return { success: false, error: 'Not authenticated' };
        }

        if (resumeId) {
            await prisma.resume.deleteMany({ where: { id: resumeId, userId } });
            return { success: true };
        }

        await prisma.jobTarget.deleteMany({ where: { userId } });
        await prisma.resume.deleteMany({ where: { userId } });
        return { success: true };
    } catch (error: unknown) {
        console.error('Failed to delete resume from cloud:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export async function listResumes(): Promise<{
    success: boolean;
    resumes?: {
        id: string;
        title: string;
        updatedAt: Date;
        createdAt: Date;
        targetRole: string | null;
        targetCompany: string | null;
        atsScore: number | null;
        atsSummary: string | null;
    }[];
    error?: string;
}> {
    try {
        const userId = await getAuthenticatedUserId();
        if (!userId) {
            return { success: false, error: 'Not authenticated' };
        }

        const resumes = await prisma.resume.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
            select: {
                id: true,
                title: true,
                updatedAt: true,
                createdAt: true,
                targetRole: true,
                targetCompany: true,
                atsScore: true,
                atsSummary: true,
            },
        });

        return { success: true, resumes };
    } catch (error: unknown) {
        console.error('Failed to list resumes:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export async function createResume(input?: {
    title?: string;
    resumeData?: ResumeData;
    source?: 'manual' | 'ai' | 'import';
    atsScore?: number;
}): Promise<{ success: boolean; resumeId?: string; error?: string }> {
    const parsed = CreateResumeSchema.safeParse(input ?? {});
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
    }

    try {
        const userId = await getAuthenticatedUserId();
        if (!userId) {
            return { success: false, error: 'Not authenticated' };
        }

        const resume = await prisma.resume.create({
            data: {
                userId,
                title: parsed.data.title ?? 'Untitled Resume',
            },
            select: { id: true },
        });

        if (parsed.data.resumeData) {
            const saveResult = await saveResumeToCloud(
                parsed.data.resumeData,
                parsed.data.title,
                parsed.data.source ?? 'manual',
                resume.id,
                parsed.data.atsScore
            );
            if (!saveResult.success) {
                await prisma.resume.deleteMany({
                    where: { id: resume.id, userId },
                });
                return { success: false, error: saveResult.error ?? 'Failed to initialize resume content' };
            }
        }

        return { success: true, resumeId: resume.id };
    } catch (error: unknown) {
        console.error('Failed to create resume:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export async function duplicateResume(resumeId: string): Promise<{
    success: boolean;
    resumeId?: string;
    error?: string;
}> {
    try {
        const userId = await getAuthenticatedUserId();
        if (!userId) {
            return { success: false, error: 'Not authenticated' };
        }

        const original = await prisma.resume.findFirst({
            where: { id: resumeId, userId },
        });
        if (!original) {
            return { success: false, error: 'Resume not found' };
        }

        const duplicate = await prisma.resume.create({
            data: {
                userId,
                title: `${original.title} (Copy)`,
            },
            select: { id: true },
        });

        const content = original.content;
        if (content) {
            await prisma.resume.update({
                where: { id: duplicate.id },
                data: { content: content as object, updatedAt: new Date() },
            });
        }

        return { success: true, resumeId: duplicate.id };
    } catch (error: unknown) {
        console.error('Failed to duplicate resume:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
