'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ResumeData } from '@/types/resume';
import { auth } from '@clerk/nextjs/server';
import { ResumeDataSchema } from '@/lib/aiSchemas';
import { ResumeVersionSource } from '@prisma/client';

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

async function findLatestResumeIdForUser(userId: string): Promise<string | null> {
    const latest = await prisma.resume.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
    });
    return latest?.id ?? null;
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
    const sourceEnum = (parsed.data.source ?? 'manual') as ResumeVersionSource;

    try {
        const userId = await getAuthenticatedUserId();
        if (!userId) {
            return { success: false, error: 'Not authenticated' };
        }

        const payload = data as object;
        let resume = safeResumeId
            ? await prisma.resume.findFirst({
                where: { id: safeResumeId, userId },
            })
            : null;

        if (!resume) {
            const latestResumeId = await findLatestResumeIdForUser(userId);
            if (latestResumeId) {
                resume = await prisma.resume.findUnique({
                    where: { id: latestResumeId },
                });
            }
        }

        if (!resume) {
            resume = await prisma.resume.create({
                data: { userId, title: safeTitle ?? 'My Resume' },
            });
        }

        const version = await prisma.resumeVersion.create({
            data: {
                userId,
                resumeId: resume.id,
                content: payload,
                source: sourceEnum,
            },
        });

        const metadata = deriveResumeMetadata(data as ResumeData, safeAtsScore);
        await prisma.resume.update({
            where: { id: resume.id },
            data: {
                content: payload,
                title: safeTitle ?? resume.title,
                targetRole: metadata.targetRole,
                targetCompany: metadata.targetCompany,
                atsScore: metadata.atsScore,
                atsSummary: metadata.atsSummary,
                currentVersionId: version.id,
                updatedAt: new Date(),
            },
        });
        return { success: true, resumeId: resume.id };
    } catch (error) {
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
                include: { currentVersion: true },
            })
            : await prisma.resume.findFirst({
                where: { userId },
                orderBy: { updatedAt: 'desc' },
                include: { currentVersion: true },
            });
        if (!resume) return { success: true, data: undefined };

        const content = resume.currentVersion
            ? (resume.currentVersion.content as unknown as ResumeData)
            : (resume.content as unknown as ResumeData | null);
        const updatedAt = resume.currentVersion?.createdAt ?? resume.updatedAt;

        return {
            success: true,
            data: content ?? undefined,
            title: resume.title,
            resumeId: resume.id,
            updatedAt,
        };
    } catch (error) {
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
    } catch (error) {
        console.error('Failed to delete resume from cloud:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export async function listResumeVersions(resumeId?: string, limit = 20): Promise<{
    success: boolean;
    versions?: { id: string; source: string; createdAt: Date }[];
    error?: string;
}> {
    try {
        const userId = await getAuthenticatedUserId();
        if (!userId) {
            return { success: false, error: 'Not authenticated' };
        }

        let targetResumeId = resumeId;
        if (!targetResumeId) {
            targetResumeId = await findLatestResumeIdForUser(userId) ?? undefined;
        }
        if (!targetResumeId) {
            return { success: true, versions: [] };
        }

        const versions = await prisma.resumeVersion.findMany({
            where: { userId, resumeId: targetResumeId },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: { id: true, source: true, createdAt: true },
        });
        return {
            success: true,
            versions: versions.map((v) => ({ id: v.id, source: v.source, createdAt: v.createdAt })),
        };
    } catch (error) {
        console.error('Failed to list resume versions:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export async function restoreResumeVersion(versionId: string, resumeId?: string): Promise<{
    success: boolean;
    data?: ResumeData;
    error?: string;
}> {
    try {
        const userId = await getAuthenticatedUserId();
        if (!userId) {
            return { success: false, error: 'Not authenticated' };
        }

        const version = await prisma.resumeVersion.findFirst({
            where: { id: versionId, userId, ...(resumeId ? { resumeId } : {}) },
        });
        if (!version) {
            return { success: false, error: 'Version not found' };
        }

        const resume = await prisma.resume.findFirst({
            where: { id: version.resumeId, userId },
        });
        if (!resume) {
            return { success: false, error: 'Resume not found' };
        }

        await prisma.resume.update({
            where: { id: resume.id },
            data: { currentVersionId: version.id, content: version.content as object, updatedAt: new Date() },
        });
        return {
            success: true,
            data: version.content as unknown as ResumeData,
        };
    } catch (error) {
        console.error('Failed to restore version:', error);
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
    } catch (error) {
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
                return { success: false, error: saveResult.error ?? 'Failed to initialize resume content' };
            }
        }

        return { success: true, resumeId: resume.id };
    } catch (error) {
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
            include: { currentVersion: true },
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

        const content = original.currentVersion?.content ?? original.content;
        if (content) {
            await prisma.resumeVersion.create({
                data: {
                    userId,
                    resumeId: duplicate.id,
                    source: 'manual',
                    content: content as object,
                },
            }).then(async (version) => {
                await prisma.resume.update({
                    where: { id: duplicate.id },
                    data: { currentVersionId: version.id, content: content as object, updatedAt: new Date() },
                });
            });
        }

        return { success: true, resumeId: duplicate.id };
    } catch (error) {
        console.error('Failed to duplicate resume:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
