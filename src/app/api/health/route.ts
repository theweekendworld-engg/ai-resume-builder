/**
 * For an uptime monitor. Public, so it says only "the app and its database
 * answer": which keys are or are not configured is not for strangers; that
 * lives on /admin/ops and in the operator digest.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
    const started = Date.now();
    try {
        await prisma.$queryRaw`SELECT 1`;
        // The cron is daily (Vercel Hobby), so a failed job used to wait a day
        // for its retry. An uptime monitor pinging this route every few minutes
        // now also drains the queue, at most once a minute (audit 2026-10-02).
        const { checkRateLimit } = await import('@/lib/rateLimit');
        if ((await checkRateLimit('kick', 'health')).allowed) {
            const { kickQueue } = await import('@/lib/jobs/kick');
            await kickQueue('health');
        }
        return NextResponse.json({ ok: true, db: 'up', ms: Date.now() - started }, { headers: { 'cache-control': 'no-store' } });
    } catch {
        return NextResponse.json({ ok: false, db: 'down' }, { status: 503, headers: { 'cache-control': 'no-store' } });
    }
}
