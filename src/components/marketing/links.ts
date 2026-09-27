/**
 * Where "Start free" sends a new visitor.
 *
 * One constant rather than a string on every CTA. It used to be
 * `/sign-up?redirect_url=/build` in six places, which dropped every new user
 * onto a paste-a-job-description wizard with an empty profile (audit
 * 2026-09-27, flow D). Onboarding decides the first screen now; the landing
 * page only needs to get people into it.
 */
export const START_FREE_HREF = '/sign-up?redirect_url=/dashboard';

/** The public policy pages a payment gateway's review expects to find. */
export const POLICY_LINKS = [
    { href: '/pricing', label: 'Pricing' },
    { href: '/terms', label: 'Terms' },
    { href: '/privacy', label: 'Privacy' },
    { href: '/refund-policy', label: 'Refunds & cancellation' },
    { href: '/shipping-policy', label: 'Delivery' },
    { href: '/contact', label: 'Contact' },
] as const;
