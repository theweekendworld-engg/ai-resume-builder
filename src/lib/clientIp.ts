import type { NextRequest } from 'next/server';

/** The caller's IP as Vercel reports it, for per-IP limits on anonymous routes. */
export function getClientIp(req: NextRequest): string {
    return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || req.headers.get('x-real-ip')?.trim()
        || 'anonymous';
}
