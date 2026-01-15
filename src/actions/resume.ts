'use server';

import { prisma } from '@/lib/prisma';
import { ResumeData } from '@/types/resume';
import { auth } from '@clerk/nextjs/server';

/**
 * Save resume to cloud database.
 * Upserts based on userId - each user has one resume.
 */
export async function saveResumeToCloud(resumeData: ResumeData, title?: string): Promise<{ success: boolean; error?: string }> {
    try {
        const { userId } = await auth();

        if (!userId) {
            return { success: false, error: 'Not authenticated' };
        }

        // Find existing resume for this user
        const existingResume = await prisma.resume.findFirst({
            where: { userId },
        });

        if (existingResume) {
            // Update existing
            await prisma.resume.update({
                where: { id: existingResume.id },
                data: {
                    content: resumeData as object,
                    title: title || existingResume.title,
                    updatedAt: new Date(),
                },
            });
        } else {
            // Create new
            await prisma.resume.create({
                data: {
                    userId,
                    content: resumeData as object,
                    title: title || 'My Resume',
                },
            });
        }

        return { success: true };
    } catch (error) {
        console.error('Failed to save resume to cloud:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Load resume from cloud database.
 * Returns null if no resume found for user.
 */
export async function loadResumeFromCloud(): Promise<{
    success: boolean;
    data?: ResumeData;
    title?: string;
    updatedAt?: Date;
    error?: string;
}> {
    try {
        const { userId } = await auth();

        if (!userId) {
            return { success: false, error: 'Not authenticated' };
        }

        const resume = await prisma.resume.findFirst({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
        });

        if (!resume) {
            return { success: true, data: undefined };
        }

        return {
            success: true,
            data: resume.content as unknown as ResumeData,
            title: resume.title,
            updatedAt: resume.updatedAt,
        };
    } catch (error) {
        console.error('Failed to load resume from cloud:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Delete user's resume from cloud.
 */
export async function deleteResumeFromCloud(): Promise<{ success: boolean; error?: string }> {
    try {
        const { userId } = await auth();

        if (!userId) {
            return { success: false, error: 'Not authenticated' };
        }

        await prisma.resume.deleteMany({
            where: { userId },
        });

        return { success: true };
    } catch (error) {
        console.error('Failed to delete resume from cloud:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}
