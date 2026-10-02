import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cliUser } from '../_auth';

export const dynamic = 'force-dynamic';

/** `patronus whoami`: who this key acts as. */
export async function GET(req: NextRequest): Promise<NextResponse> {
    const who = await cliUser(req);
    if ('response' in who) return who.response;
    const profile = await prisma.userProfile.findUnique({ where: { userId: who.userId }, select: { fullName: true, email: true } });
    return NextResponse.json({ userId: who.userId, name: profile?.fullName ?? null, email: profile?.email ?? null });
}
