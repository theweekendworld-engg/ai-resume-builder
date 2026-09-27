/**
 * Which payment provider can actually take money right now.
 *
 * The plan page used to read `stripeConfigured()`, which only checked the
 * secret key — so with a key and no Price ids the buttons were live and every
 * click failed with "No price configured", and with nothing configured (the
 * production state on 27 Sep 2026) every button was silently disabled with no
 * reason given. This module is the single answer the UI reads.
 *
 * Two questions, deliberately separate:
 *   - `billingProvider()`   which provider is configured, for display/ops.
 *   - `checkoutAvailable()` can a user start a purchase TODAY. Only a provider
 *     whose checkout is implemented counts. Razorpay (the likely provider for
 *     an India-based founder — Stripe India is invite-only) is recognised here
 *     so the switch is one place, but its checkout is not built yet, so it
 *     never makes buttons live.
 *
 * Pure and env-injectable so the precedence is testable.
 */

export type BillingProvider = 'stripe' | 'razorpay';

type Env = Record<string, string | undefined>;

function has(env: Env, key: string): boolean {
    return Boolean(env[key]?.trim());
}

/** Stripe can sell Career when it has a key AND the Career price id. */
export function stripeCheckoutReady(env: Env = process.env): boolean {
    return has(env, 'STRIPE_SECRET_KEY') && has(env, 'STRIPE_PRICE_CAREER_MONTHLY');
}

export function razorpayConfigured(env: Env = process.env): boolean {
    return has(env, 'RAZORPAY_KEY_ID') && has(env, 'RAZORPAY_KEY_SECRET');
}

/** Providers whose checkout exists in code. Add 'razorpay' when it ships. */
const CHECKOUT_IMPLEMENTED: ReadonlySet<BillingProvider> = new Set(['stripe']);

export function billingProvider(env: Env = process.env): BillingProvider | null {
    if (stripeCheckoutReady(env)) return 'stripe';
    if (razorpayConfigured(env)) return 'razorpay';
    return null;
}

export function checkoutAvailable(env: Env = process.env): boolean {
    const provider = billingProvider(env);
    return provider !== null && CHECKOUT_IMPLEMENTED.has(provider);
}

/** What the plan page says when nobody can buy anything yet. */
export const BILLING_UNAVAILABLE_COPY =
    'Paid plans open soon — everything you use now stays free, and nothing you record is ever deleted.';
