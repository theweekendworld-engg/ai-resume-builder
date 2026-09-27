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
    // Policy and pricing pages a payment gateway's KYC review reads logged out.
    '/pricing',
    '/contact',
    '/refund-policy',
    '/shipping-policy',
    // The anonymous ATS score is the top of the funnel and is free with no
    // login (PRD 06 §2.3). `anonScore.ts` is purpose-built for it — its own
    // header reads "Anonymous, auth-free resume scoring" and it deliberately
    // avoids requireAuth — but the route sat behind auth.protect(), so nobody
    // could reach the thing without the account it exists to sell.
    '/score',
    '/api/score',
    // The free-check result kept across sign-up (src/lib/scoreStash.ts).
    '/api/score/stash',
    // Funnel telemetry for that same anonymous flow. Gating it means the
    // acquisition funnel is invisible exactly where it matters most.
    '/api/events/funnel',
    // The pattern gallery exists to be looked at. It already returns notFound()
    // in production, so auth here bought nothing and made the design system
    // reviewable only by someone with an account.
    '/dev/(.*)',
]);

const isSelfAuthenticatedApiRoute = createRouteMatcher([
    '/api/extension(.*)',
    '/api/v1(.*)',
    '/api/telegram/webhook',
    '/api/telegram/process',
    // Stripe webhook is authenticated by signature, not a Clerk session.
    '/api/stripe/webhook',
    // ── Found 2026-09-27 (docs/audit/2026-09-27-user-flow-audit.html §C) ────
    // Each of these authenticates ITSELF and was 404'd by auth.protect() for
    // every caller without a Clerk session, which is every caller they have:
    //   cron tick: Bearer CRON_SECRET. Blocked, no scheduled job ever ran.
    //   magic links: a signed single-purpose token. Blocked, every email
    //     Confirm/Dismiss button went to sign-in.
    //   unsubscribe: a signed token; must work logged out (and by law).
    //   email / WhatsApp webhooks: Svix / Meta HMAC signatures.
    '/api/cron/tick',
    '/w/(.*)',
    '/api/email/unsubscribe',
    '/api/email/webhook',
    '/api/whatsapp/webhook',
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
    if (!isPublicRoute(req) && !isSelfAuthenticatedApiRoute(req)) {
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
    const shouldRateLimit = pathname.startsWith('/api/') && !pathname.startsWith('/api/telegram/webhook') && !pathname.startsWith('/api/telegram/process') && !pathname.startsWith('/api/stripe/webhook');
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
