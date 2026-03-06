import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/terms',
  '/privacy',
  '/api/telegram/webhook',
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

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }

  if (!limiter) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  const shouldRateLimit =
    pathname.startsWith('/api/')
    && !pathname.startsWith('/api/telegram/webhook');

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
    '/((?!_next|[^?]*\\.(?:html?|css|js|mjs|json|jpg|jpeg|gif|png|svg|webp|ico|woff2?|ttf|map|txt|xml)).*)',
    '/(api|trpc)(.*)',
  ],
};
