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
        return NextResponse.json({ ok: true, db: 'up', ms: Date.now() - started }, { headers: { 'cache-control': 'no-store' } });
    } catch {
        return NextResponse.json({ ok: false, db: 'down' }, { status: 503, headers: { 'cache-control': 'no-store' } });
    }
}
