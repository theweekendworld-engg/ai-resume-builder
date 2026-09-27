/**
 * Does production have what the switched-on features need?
 *
 * Four production failures in one week (2026-09-23 → 27) had the same shape:
 * a feature was on while something it depends on was absent, and nothing said
 * so. The retired workflow beta, the cron behind the login wall, no email
 * provider, no payment provider. Each was invisible until a user hit it.
 *
 * Pure over an env record: names only, never values. Surfaced on /admin/ops
 * and logged at boot (src/instrumentation.ts).
 */

export type HealthSeverity = 'error' | 'warn';

export type HealthCheck = {
    id: string;
    ok: boolean;
    severity: HealthSeverity;
    /** What breaks for users when this is not ok. Plain language. */
    impact: string;
    /** What to set, by name. */
    fix: string;
};

type Env = Record<string, string | undefined>;

const has = (env: Env, ...keys: string[]) => keys.every((key) => Boolean(env[key]?.trim()));

export function configHealth(env: Env = process.env): HealthCheck[] {
    const stripe = has(env, 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_CAREER_MONTHLY');
    const razorpay = has(env, 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET');
    const whatsappAny = Object.keys(env).some((key) => key.startsWith('WHATSAPP_') && env[key]?.trim());

    const checks: HealthCheck[] = [
        {
            id: 'cron_secret',
            ok: has(env, 'CRON_SECRET'),
            severity: 'error',
            impact: 'The daily tick cannot authenticate, so no background job (digests, GitHub sync, embeddings) runs.',
            fix: 'CRON_SECRET',
        },
        {
            id: 'model_gateway',
            ok: has(env, 'OPENROUTER_API_KEY') || has(env, 'OPENAI_API_KEY'),
            severity: 'error',
            impact: 'Every AI feature fails.',
            fix: 'OPENROUTER_API_KEY or OPENAI_API_KEY',
        },
        {
            id: 'email',
            ok: has(env, 'RESEND_API_KEY', 'EMAIL_FROM'),
            severity: 'error',
            impact: 'No email is ever sent: weekly digest, Month in Review, nudges.',
            fix: 'RESEND_API_KEY and EMAIL_FROM',
        },
        {
            id: 'magic_links',
            ok: has(env, 'WIN_MAGIC_LINK_SECRET'),
            severity: 'error',
            impact: 'Digest emails are refused (their Confirm buttons cannot be signed).',
            fix: 'WIN_MAGIC_LINK_SECRET',
        },
        {
            id: 'payments',
            ok: stripe || razorpay,
            severity: 'warn',
            impact: 'Nothing can be purchased; the plan page shows "paid plans open soon".',
            fix: 'Razorpay (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) or Stripe keys and Price ids',
        },
        {
            id: 'research',
            ok: has(env, 'TAVILY_API_KEY'),
            severity: 'warn',
            impact: 'Scout cannot research pay, company facts or interview write-ups.',
            fix: 'TAVILY_API_KEY',
        },
        {
            id: 'telegram',
            ok: has(env, 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_BOT_USERNAME'),
            severity: 'warn',
            impact: 'The Telegram bot cannot link accounts or reply.',
            fix: 'TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME',
        },
        {
            id: 'app_url',
            ok: /^https:\/\//.test(env.NEXT_PUBLIC_APP_URL ?? '') && !/vercel\.app/.test(env.NEXT_PUBLIC_APP_URL ?? ''),
            severity: 'warn',
            impact: 'Links in email and chat point at a protected or local URL.',
            fix: 'NEXT_PUBLIC_APP_URL = the public https custom domain',
        },
    ];

    // Half a WhatsApp config is worse than none: the UI offers linking that fails.
    if (whatsappAny) {
        checks.push({
            id: 'whatsapp',
            ok: has(env, 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'),
            severity: 'warn',
            impact: 'WhatsApp is partly configured: linking or webhooks will fail.',
            fix: 'WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN',
        });
    }
    return checks;
}

/** Log failing checks once at boot. Never throws. */
export function logConfigHealth(env: Env = process.env): void {
    try {
        for (const check of configHealth(env)) {
            if (check.ok) continue;
            const line = `[health] ${check.severity.toUpperCase()} ${check.id}: ${check.impact} Set: ${check.fix}`;
            if (check.severity === 'error') console.error(line);
            else console.warn(line);
        }
    } catch {
        // Health reporting must never take the app down.
    }
}
