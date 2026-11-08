import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

/**
 * Baseline security headers (launch audit 2026-10-02: there were none).
 *
 * `frame-ancestors 'self'`: nothing outside the app may frame it (clickjacking
 * on Confirm/Connect buttons), while the editor's own PDF preview iframe keeps
 * working. A full script CSP is deliberately not here yet: Clerk, Stripe and
 * the workflow runtime each need allowances, and a wrong CSP breaks sign-in
 * silently. That is its own change, tested in a preview deploy.
 */
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self)' },
];

/**
 * The sidebar's names, as URLs (e2e QA 2026-11-07, finding 8).
 *
 * The routes predate their labels: Goals lives at /home, Jobs at /scout and
 * Resumes at /dashboard, so typing what the sidebar says gave a 404. The
 * routes are NOT renamed, because Telegram messages, emails and deep links
 * already point at them; the label's URL redirects to the real one, keeping
 * any query string. Permanent (308), since the mapping is not going to move.
 *
 * Kept inline rather than imported so this file has no local imports to
 * resolve while Next loads it. `src/app/routes.test.ts` reads this list and
 * checks each destination is a real page and no source shadows one.
 */
const ROUTE_ALIASES = [
  { source: '/jobs', destination: '/scout' },
  { source: '/goals', destination: '/home' },
  { source: '/resumes', destination: '/dashboard' },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  async redirects() {
    return ROUTE_ALIASES.map((alias) => ({ ...alias, permanent: true }));
  },
};

export default withWorkflow(nextConfig);
