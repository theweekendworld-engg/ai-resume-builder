import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const isPublicRoute = createRouteMatcher([
    '/',
    '/account(.*)',
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/terms',
    '/privacy',
    '/api/telegram/webhook',
    '/api/telegram/process',
]);

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    : null;

const limiter = redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(120, '1 m'),
        analytics: true,
    })
    : null;

function isAdminUserId(userId: string | null | undefined): boolean {
    if (!userId) return false;
    const admins = new Set(
        (process.env.ADMIN_USER_IDS ?? '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
    );
    return admins.has(userId);
}

export default clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
        const session = await auth.protect();
        const pathname = req.nextUrl.pathname;
        const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');
        if (isAdminRoute && !isAdminUserId(session.userId)) {
            return Response.redirect(new URL('/dashboard', req.url));
        }
    }

    if (!limiter) {
        return NextResponse.next();
    }

    const pathname = req.nextUrl.pathname;
    const shouldRateLimit = pathname.startsWith('/api/') && !pathname.startsWith('/api/telegram/webhook') && !pathname.startsWith('/api/telegram/process');
    if (!shouldRateLimit) {
        return NextResponse.next();
    }

    const identifier = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || req.headers.get('x-real-ip')
        || 'anonymous';

    const result = await limiter.limit(`mw:${identifier}`);
    if (!result.success) {
        return NextResponse.json(
            { success: false, error: 'Too many requests. Please try again shortly.' },
            { status: 429 }
        );
    }

    return NextResponse.next();
});

export const config = {
    matcher: [
        // Skip Next.js internals and all static files, unless found in search params
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        // Always run for API routes
        '/(api|trpc)(.*)',
    ],
};
