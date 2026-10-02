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

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default withWorkflow(nextConfig);
