import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
    '/',
    '/sign-in(.*)',
    '/sign-up(.*)',
]);

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
});

export const config = {
    matcher: [
        // Skip Next.js internals and all static files, unless found in search params
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        // Always run for API routes
        '/(api|trpc)(.*)',
    ],
};
