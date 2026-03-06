'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';

const SaveJobTargetSchema = z.object({
    company: z.string().max(300).default(''),
    role: z.string().max(300).default(''),
    description: z.string().max(50000),
});

export async function saveJobTargetToCloud(company: string, role: string, description: string): Promise<{ success: boolean; error?: string }> {
    const parsed = SaveJobTargetSchema.safeParse({ company, role, description });
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
    }
    try {
        const { userId } = await auth();
        if (!userId) return { success: false, error: 'Not authenticated' };

        await prisma.jobTarget.create({
            data: {
                userId,
                company: parsed.data.company,
                role: parsed.data.role,
                description: parsed.data.description,
            },
        });
        return { success: true };
    } catch (error) {
        console.error('Failed to save job target:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export async function loadLatestJobTargetFromCloud(): Promise<{
    success: boolean;
    jobTarget?: { company: string; role: string; description: string };
    error?: string;
}> {
    try {
        const { userId } = await auth();
        if (!userId) return { success: false, error: 'Not authenticated' };

        const latest = await prisma.jobTarget.findFirst({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
        });
        if (!latest) return { success: true, jobTarget: undefined };
        return {
            success: true,
            jobTarget: { company: latest.company, role: latest.role, description: latest.description },
        };
    } catch (error) {
        console.error('Failed to load job target:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export async function loadJobTargetForResume(resumeId: string): Promise<{
    success: boolean;
    jobTarget?: { company: string; role: string; description: string };
    error?: string;
}> {
    try {
        const { userId } = await auth();
        if (!userId) return { success: false, error: 'Not authenticated' };

        const session = await prisma.generationSession.findFirst({
            where: { resultResumeId: resumeId, userId },
            orderBy: { completedAt: 'desc' },
            select: { jobDescription: true },
        });
        if (session?.jobDescription) {
            return {
                success: true,
                jobTarget: { company: '', role: '', description: session.jobDescription },
            };
        }

        return loadLatestJobTargetFromCloud();
    } catch (error) {
        console.error('Failed to load job target for resume:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
