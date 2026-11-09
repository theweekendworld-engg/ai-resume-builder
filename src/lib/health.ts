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

import { dodoConfigured, dodoEnvironment, dodoMissingEnv } from '@/lib/billing/provider';

type Env = Record<string, string | undefined>;

const has = (env: Env, ...keys: string[]) => keys.every((key) => Boolean(env[key]?.trim()));

export function configHealth(env: Env = process.env): HealthCheck[] {
    const stripe = has(env, 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_CAREER_MONTHLY');
    const razorpay = has(env, 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET');
    const dodo = dodoConfigured(env);
    const dodoMissing = dodoMissingEnv(env);
    const launchOpen = env.ENTITLEMENT_LAUNCH_OPEN !== 'false';
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
            ok: dodo || stripe || razorpay,
            severity: 'warn',
            impact: 'Nothing can be purchased; the plan page shows "free while we launch" to everyone, admins included.',
            fix: 'Dodo Payments (see the dodo check) — or Stripe keys and Price ids',
        },
        // The chosen provider (docs/impl/09-payments-dodo.md). Names only.
        {
            id: 'dodo',
            ok: dodo,
            severity: 'warn',
            impact: `Dodo Payments is not fully configured, so checkout stays off (and a purchase without the webhook key would be charged and never granted). Mode: ${dodoEnvironment(env)}.`,
            fix: dodoMissing.length > 0 ? dodoMissing.join(', ') : 'nothing missing',
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
        // Settings → Email & calendar tells customers these are "coming soon";
        // the variable names live here, on /admin/ops and in the boot log.
        {
            id: 'inbound_email',
            // Either provider: Resend Inbound (signed, body fetched by API key) or a Postmark-format one.
            ok: has(env, 'INBOUND_EMAIL_DOMAIN') && (has(env, 'RESEND_INBOUND_WEBHOOK_SECRET', 'RESEND_API_KEY') || has(env, 'INBOUND_EMAIL_SECRET')),
            severity: 'warn',
            impact: 'Job-email forwarding is off: Settings shows "Email forwarding is coming soon" and no application tracks itself from email.',
            fix: 'INBOUND_EMAIL_DOMAIN plus RESEND_INBOUND_WEBHOOK_SECRET and RESEND_API_KEY (Resend webhook → /api/inbound/resend), or INBOUND_EMAIL_SECRET for a Postmark-format provider (/api/inbound/email)',
        },
        {
            id: 'google_calendar',
            ok: has(env, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY'),
            severity: 'warn',
            impact: 'Google Calendar cannot be connected: Settings shows "Google Calendar is coming soon".',
            fix: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY',
        },
        {
            id: 'app_url',
            ok: /^https:\/\//.test(env.NEXT_PUBLIC_APP_URL ?? '') && !/vercel\.app/.test(env.NEXT_PUBLIC_APP_URL ?? ''),
            severity: 'warn',
            impact: 'Links in email and chat point at a protected or local URL.',
            fix: 'NEXT_PUBLIC_APP_URL = the public https custom domain',
        },
    ];

    // Paid plans switched on with nothing to buy them with: every gated user
    // meets a limit and an upgrade that cannot be completed.
    if (!launchOpen) {
        checks.push({
            id: 'paid_plans_without_checkout',
            ok: dodo || stripe,
            severity: 'error',
            impact: 'The launch is off (paid plans are enforced) but no provider can take money: upgrades fail.',
            fix: 'Configure Dodo Payments, or unset ENTITLEMENT_LAUNCH_OPEN to reopen the launch',
        });
    }

    // The vector store is Postgres unless Qdrant is asked for by name, and a
    // Qdrant opt-in without a server is every semantic search failing.
    if (env.VECTOR_STORE === 'qdrant') {
        checks.push({
            id: 'vector_store',
            ok: has(env, 'QDRANT_URL'),
            severity: 'error',
            impact: 'VECTOR_STORE=qdrant with no server: semantic search and Win embedding fail.',
            fix: 'QDRANT_URL (or unset VECTOR_STORE to use Postgres/pgvector)',
        });
    }

    // Per-feature limits fall back to Postgres (src/lib/rateLimit.ts), but the
    // per-IP limit in the middleware needs Upstash: without it, a flood of
    // requests reaches the handlers.
    checks.push({
        id: 'rate_limit_global',
        ok: has(env, 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'),
        severity: 'warn',
        impact: 'No per-IP request limit in the middleware. Per-feature limits still apply (Postgres fallback).',
        fix: 'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (Vercel Marketplace: Upstash for Redis)',
    });

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
