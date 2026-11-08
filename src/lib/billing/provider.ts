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
 *     whose checkout is implemented counts. Razorpay is recognised here so the
 *     switch is one place, but its checkout is not built, so it never makes
 *     buttons live.
 *
 * **Dodo Payments is the chosen provider** (owner decision 2026-11-08): a
 * Merchant of Record, so it owns tax, invoices and refunds, and it onboards an
 * India-based individual. It wins over Stripe whenever it is fully configured.
 * Neither of these is the launch switch: while `launchOpenAccess()` is on, the
 * plan page offers checkout to admins only (see `checkoutOffered` in
 * `src/actions/billing.ts`).
 *
 * Pure and env-injectable so the precedence is testable.
 */

export type BillingProvider = 'dodo' | 'stripe' | 'razorpay';

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

export type DodoEnvironment = 'test_mode' | 'live_mode';

/**
 * Test mode unless `live_mode` is asked for by exactly that name. The SDK's own
 * default is live, so leaving the variable unset — or mistyping it — must not
 * be the thing that starts charging real cards.
 */
export function dodoEnvironment(env: Env = process.env): DodoEnvironment {
    return env.DODO_PAYMENTS_ENVIRONMENT?.trim() === 'live_mode' ? 'live_mode' : 'test_mode';
}

/**
 * The Dodo API key. `DODO_PAYMENTS_API_KEY` is the name (the SDK's own); the
 * owner's first test key was stored as `DODO_PAYMENT_TEST_API_KEY`, which is
 * accepted as a fallback in test mode only, so a test key can never be the
 * one a live deployment silently uses.
 */
export function dodoApiKey(env: Env = process.env): string | undefined {
    const primary = env.DODO_PAYMENTS_API_KEY?.trim();
    if (primary) return primary;
    if (dodoEnvironment(env) !== 'test_mode') return undefined;
    const testKey = env.DODO_PAYMENT_TEST_API_KEY?.trim();
    return testKey || undefined;
}

/**
 * Everything Dodo needs to SELL: the API key, the webhook signing key (without
 * it a purchase would be charged and never granted), and a product id for each
 * plan. Half a configuration never makes buttons live.
 */
export const DODO_REQUIRED_ENV = [
    'DODO_PAYMENTS_API_KEY',
    'DODO_PAYMENTS_WEBHOOK_KEY',
    'DODO_PRODUCT_CAREER',
    'DODO_PRODUCT_SEARCH',
] as const;

/** The required names that are missing, by name (the key counts if its test-mode fallback is set). */
export function dodoMissingEnv(env: Env = process.env): string[] {
    return DODO_REQUIRED_ENV.filter((key) =>
        key === 'DODO_PAYMENTS_API_KEY' ? !dodoApiKey(env) : !has(env, key),
    );
}

export function dodoConfigured(env: Env = process.env): boolean {
    return dodoMissingEnv(env).length === 0;
}

/**
 * Can Dodo be TALKED TO: the API key alone. Cancel, portal and refund need only
 * this, so an existing subscription stays manageable even if a product env var
 * is removed.
 */
export function dodoKeyConfigured(env: Env = process.env): boolean {
    return Boolean(dodoApiKey(env));
}

/** Providers whose checkout exists in code. Add 'razorpay' when it ships. */
const CHECKOUT_IMPLEMENTED: ReadonlySet<BillingProvider> = new Set(['dodo', 'stripe']);

export function billingProvider(env: Env = process.env): BillingProvider | null {
    if (dodoConfigured(env)) return 'dodo';
    if (stripeCheckoutReady(env)) return 'stripe';
    if (razorpayConfigured(env)) return 'razorpay';
    return null;
}

export function checkoutAvailable(env: Env = process.env): boolean {
    const provider = billingProvider(env);
    return provider !== null && CHECKOUT_IMPLEMENTED.has(provider);
}

/**
 * What the plan page says when nobody can buy anything yet: the launch
 * (2026-11-07). Everything is included, paid plans come later with notice.
 */
export const BILLING_UNAVAILABLE_COPY =
    'Free while we launch — every feature is included. Paid plans come later, with notice first, and nothing you record is ever deleted.';
