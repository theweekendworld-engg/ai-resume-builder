/**
 * The outbound email channel (ADR-4, P0.3).
 *
 * Shape and error-handling conventions follow src/lib/telegram.ts, with one
 * deliberate inversion: telegram.ts throws on provider failure, sendEmail never
 * does. A digest job that fails because an email bounced is a worse outcome than
 * a missing email, so every failure path here returns a result object.
 *
 * Everything in the top half of this file is pure — no Prisma, no Resend, no
 * network — so preference logic, header construction and webhook parsing are all
 * unit-testable with no database and no API key.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';
import {
    PREFERENCE_FIELD_BY_CATEGORY,
    getTransactionalTemplate,
    type EmailCategory,
    type RenderedEmail,
    type TemplateContext,
    type TransactionalTemplateData,
    type TransactionalTemplateKey,
} from './templates/transactional';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function env(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
}

export function getAppUrl(): string {
    return (env('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
}

/** True when a real send is possible. Checked before any DB work. */
export function emailConfigured(): boolean {
    return Boolean(env('RESEND_API_KEY') && env('EMAIL_FROM'));
}

let resendClient: Resend | null = null;

/**
 * Test seam. Fakes belong at the PROVIDER boundary, never at the boundary of
 * the module under test — mocking `sendEmail` itself would skip the preference
 * checks, suppression rules, plain-text generation and List-Unsubscribe
 * headers, which is precisely the logic most worth testing.
 */
export const __testing = {
    setResendClient(client: Resend | null) {
        resendClient = client;
    },
    reset() {
        resendClient = null;
    },
};

function getResend(): Resend {
    const apiKey = env('RESEND_API_KEY');
    if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
    if (!resendClient) resendClient = new Resend(apiKey);
    return resendClient;
}

// ---------------------------------------------------------------------------
// Preferences — pure
// ---------------------------------------------------------------------------

/** The subset of EmailPreference the suppression decision depends on. */
export type PreferenceSnapshot = {
    unsubscribedAll: boolean;
    weeklyDigest: boolean;
    monthlyReview: boolean;
    radarDigest: boolean;
    missionNudges: boolean;
    productUpdates: boolean;
};

export type SkipReason =
    | 'unsubscribed_all'
    | 'category_opt_out'
    | 'not_configured'
    | 'invalid_recipient';

/**
 * The single place that decides whether an email is allowed out.
 *
 * A missing preference row means the user has never expressed an opinion, which
 * is consent for the schema defaults (all true) — not a reason to suppress.
 */
export function evaluateSuppression(
    category: EmailCategory,
    prefs: PreferenceSnapshot | null,
    options: { critical?: boolean } = {}
): Extract<SkipReason, 'unsubscribed_all' | 'category_opt_out'> | null {
    if (!prefs) return null;

    if (prefs.unsubscribedAll && !options.critical) return 'unsubscribed_all';

    const field = PREFERENCE_FIELD_BY_CATEGORY[category];
    if (field && prefs[field] === false) return 'category_opt_out';

    return null;
}

/** 32 bytes of url-safe randomness. Single-purpose: it only ever grants unsubscribe. */
export function generateUnsubscribeToken(): string {
    return randomBytes(32).toString('base64url');
}

export function buildUnsubscribeUrl(token: string, category?: EmailCategory, appUrl = getAppUrl()): string {
    const url = new URL('/api/email/unsubscribe', appUrl);
    url.searchParams.set('token', token);
    if (category && category !== 'transactional') url.searchParams.set('c', category);
    return url.toString();
}

export function buildPreferencesUrl(appUrl = getAppUrl()): string {
    return new URL('/settings/notifications', appUrl).toString();
}

/**
 * RFC 8058 one-click unsubscribe. Both headers are required: without
 * `List-Unsubscribe-Post`, Gmail and Outlook render a "report spam" flow instead
 * of their own unsubscribe affordance, and complaints count against the domain.
 */
export function buildListUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
    const mailto = env('EMAIL_UNSUBSCRIBE_MAILTO');
    const targets = mailto ? [`<${unsubscribeUrl}>`, `<mailto:${mailto}?subject=unsubscribe>`] : [`<${unsubscribeUrl}>`];
    return {
        'List-Unsubscribe': targets.join(', '),
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(value: string): boolean {
    return EMAIL_SHAPE.test(String(value ?? '').trim());
}

// ---------------------------------------------------------------------------
// sendEmail
// ---------------------------------------------------------------------------

export type SendEmailResult =
    | { status: 'sent'; emailSendId: string | null; providerId: string }
    | { status: 'skipped'; reason: SkipReason }
    | { status: 'failed'; emailSendId: string | null; error: string };

export type SendEmailInput<K extends TransactionalTemplateKey> = {
    userId: string;
    to: string;
    template: K;
    data: TransactionalTemplateData[K];
    /** Passed to Resend so a retried job cannot double-send. */
    idempotencyKey?: string;
    replyTo?: string;
};

/**
 * Renders, preference-checks, sends, and logs one email.
 *
 * NEVER throws. Every exit is a SendEmailResult. Callers are jobs; a failed email
 * must not fail the job that triggered it.
 */
export async function sendEmail<K extends TransactionalTemplateKey>(
    input: SendEmailInput<K>
): Promise<SendEmailResult> {
    const template = getTransactionalTemplate(input.template);

    if (!isPlausibleEmail(input.to)) {
        console.warn('[email] skipped: implausible recipient', { template: template.key, userId: input.userId });
        return { status: 'skipped', reason: 'invalid_recipient' };
    }

    if (!emailConfigured()) {
        console.warn('[email] skipped: RESEND_API_KEY / EMAIL_FROM not configured', {
            template: template.key,
            userId: input.userId,
        });
        return { status: 'skipped', reason: 'not_configured' };
    }

    // 1. Preferences. Fail closed: if we cannot read consent, we do not send.
    let prefs: (PreferenceSnapshot & { unsubscribeToken: string }) | null = null;
    try {
        prefs = await ensureEmailPreference(input.userId);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        console.error('[email] preference lookup failed; not sending', { template: template.key, error: message });
        return { status: 'failed', emailSendId: null, error: `preference lookup failed: ${message}` };
    }

    const skipReason = evaluateSuppression(template.category, prefs, { critical: template.critical });
    if (skipReason) {
        console.info('[email] skipped: user opted out', {
            template: template.key,
            userId: input.userId,
            reason: skipReason,
        });
        return { status: 'skipped', reason: skipReason };
    }

    // 2 + 3. Render both parts and build the one-click unsubscribe headers.
    const unsubscribeUrl = buildUnsubscribeUrl(prefs.unsubscribeToken, template.category);
    const ctx: TemplateContext = {
        unsubscribeUrl,
        preferencesUrl: buildPreferencesUrl(),
        appUrl: getAppUrl(),
    };

    let rendered: RenderedEmail;
    try {
        rendered = template.render(input.data, ctx);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        console.error('[email] render failed', { template: template.key, error: message });
        return { status: 'failed', emailSendId: null, error: `render failed: ${message}` };
    }

    // 5a. Log the attempt before the network call, so a crash mid-send is visible.
    const emailSendId = await createEmailSendRow({
        userId: input.userId,
        template: template.key,
        subject: rendered.subject,
    });

    // 4. Send.
    try {
        const { data, error } = await getResend().emails.send(
            {
                from: env('EMAIL_FROM') as string,
                to: input.to,
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
                replyTo: input.replyTo ?? env('EMAIL_REPLY_TO'),
                headers: buildListUnsubscribeHeaders(unsubscribeUrl),
                tags: [
                    { name: 'template', value: sanitizeTag(template.key) },
                    { name: 'category', value: sanitizeTag(template.category) },
                ],
            },
            input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined
        );

        if (error || !data?.id) {
            const message = error?.message ?? 'provider returned no id';
            await updateEmailSendRow(emailSendId, { status: 'failed', error: message.slice(0, 500) });
            console.error('[email] provider send failed', { template: template.key, error: message });
            return { status: 'failed', emailSendId, error: message };
        }

        // 5b. Capture the provider id — the webhook joins on it.
        await updateEmailSendRow(emailSendId, { status: 'sent', providerId: data.id });
        return { status: 'sent', emailSendId, providerId: data.id };
    } catch (error: unknown) {
        // 6. Nothing escapes into the caller.
        const message = error instanceof Error ? error.message : 'unknown provider error';
        await updateEmailSendRow(emailSendId, { status: 'failed', error: message.slice(0, 500) });
        console.error('[email] provider send threw', { template: template.key, error: message });
        return { status: 'failed', emailSendId, error: message };
    }
}

/** Resend tags accept ASCII letters, digits, underscore and dash only. */
function sanitizeTag(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Reads the preference row, creating the default one (and its unsubscribe token)
 * on first send. The token has to exist before the first email goes out, because
 * that email must carry a working unsubscribe link.
 */
export async function ensureEmailPreference(
    userId: string
): Promise<PreferenceSnapshot & { unsubscribeToken: string }> {
    const row = await prisma.emailPreference.upsert({
        where: { userId },
        create: { userId, unsubscribeToken: generateUnsubscribeToken() },
        update: {},
        select: {
            unsubscribedAll: true,
            weeklyDigest: true,
            monthlyReview: true,
            radarDigest: true,
            missionNudges: true,
            productUpdates: true,
            unsubscribeToken: true,
        },
    });
    return row;
}

/** Best-effort. A logging failure must not stop the email. */
async function createEmailSendRow(input: {
    userId: string;
    template: string;
    subject: string;
}): Promise<string | null> {
    try {
        const created = await prisma.emailSend.create({
            data: { userId: input.userId, template: input.template, subject: input.subject, status: 'queued' },
            select: { id: true },
        });
        return created.id;
    } catch (error: unknown) {
        console.error('[email] could not write EmailSend row', {
            template: input.template,
            error: error instanceof Error ? error.message : 'unknown error',
        });
        return null;
    }
}

async function updateEmailSendRow(
    id: string | null,
    data: { status?: string; providerId?: string; error?: string }
): Promise<void> {
    if (!id) return;
    try {
        await prisma.emailSend.update({ where: { id }, data });
    } catch (error: unknown) {
        console.error('[email] could not update EmailSend row', {
            id,
            error: error instanceof Error ? error.message : 'unknown error',
        });
    }
}

// ---------------------------------------------------------------------------
// Unsubscribe
// ---------------------------------------------------------------------------

/** Categories a user may toggle from an email footer. `transactional` is not one. */
export const UNSUBSCRIBABLE_CATEGORIES = [
    'weeklyDigest',
    'monthlyReview',
    'radarDigest',
    'missionNudges',
    'productUpdates',
] as const;

export type UnsubscribableCategory = (typeof UNSUBSCRIBABLE_CATEGORIES)[number];

export function parseUnsubscribeCategory(value: string | null): UnsubscribableCategory | null {
    if (!value) return null;
    return (UNSUBSCRIBABLE_CATEGORIES as readonly string[]).includes(value)
        ? (value as UnsubscribableCategory)
        : null;
}

export type UnsubscribeOutcome =
    | { ok: true; scope: 'all' | UnsubscribableCategory; subscribed: boolean }
    | { ok: false; reason: 'unknown_token' | 'error' };

/**
 * Idempotent by construction: it writes an absolute value, never a toggle. Calling
 * it twice with the same arguments produces the same row and the same response.
 */
export async function applyUnsubscribe(input: {
    token: string;
    category?: UnsubscribableCategory | null;
    subscribed?: boolean;
}): Promise<UnsubscribeOutcome> {
    const token = String(input.token ?? '').trim();
    if (!token) return { ok: false, reason: 'unknown_token' };

    const subscribed = input.subscribed ?? false;

    try {
        const existing = await prisma.emailPreference.findUnique({
            where: { unsubscribeToken: token },
            select: { userId: true },
        });
        if (!existing) return { ok: false, reason: 'unknown_token' };

        if (input.category) {
            await prisma.emailPreference.update({
                where: { userId: existing.userId },
                data: { [input.category]: subscribed },
            });
            return { ok: true, scope: input.category, subscribed };
        }

        await prisma.emailPreference.update({
            where: { userId: existing.userId },
            data: { unsubscribedAll: !subscribed },
        });
        return { ok: true, scope: 'all', subscribed };
    } catch (error: unknown) {
        console.error('[email] unsubscribe failed', {
            error: error instanceof Error ? error.message : 'unknown error',
        });
        return { ok: false, reason: 'error' };
    }
}

/** Suppresses a recipient permanently. Called on hard bounce and on complaint. */
export async function suppressUserEmail(userId: string, cause: string): Promise<void> {
    try {
        await prisma.emailPreference.upsert({
            where: { userId },
            create: { userId, unsubscribeToken: generateUnsubscribeToken(), unsubscribedAll: true },
            update: { unsubscribedAll: true },
        });
        console.warn('[email] recipient suppressed', { userId, cause });
    } catch (error: unknown) {
        console.error('[email] could not suppress recipient', {
            userId,
            error: error instanceof Error ? error.message : 'unknown error',
        });
    }
}

// ---------------------------------------------------------------------------
// Provider webhook — pure
// ---------------------------------------------------------------------------

const ResendWebhookSchema = z.object({
    type: z.string(),
    created_at: z.string().optional(),
    data: z
        .object({
            email_id: z.string().optional(),
            to: z.array(z.string()).optional(),
            subject: z.string().optional(),
            bounce: z
                .object({
                    type: z.string().optional(),
                    subType: z.string().optional(),
                    message: z.string().optional(),
                })
                .optional(),
            failed: z.object({ reason: z.string().optional() }).optional(),
        })
        .passthrough(),
});

export type ResendWebhookPayload = z.infer<typeof ResendWebhookSchema>;

export function parseResendWebhook(raw: unknown): ResendWebhookPayload | null {
    const parsed = ResendWebhookSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

/**
 * Status ordering. Webhook events are not delivered in order, so a late
 * `email.sent` must never overwrite a `delivered` or `bounced` already recorded.
 */
export const EMAIL_STATUS_RANK: Record<string, number> = {
    queued: 0,
    sent: 1,
    delivered: 2,
    complained: 3,
    bounced: 4,
    failed: 4,
};

export function statusRank(status: string | null | undefined): number {
    return EMAIL_STATUS_RANK[status ?? 'queued'] ?? 0;
}

/**
 * A hard bounce is permanent: the address does not exist or the receiver has
 * blocked us for good. Continuing to send to it is what destroys domain
 * reputation, so it triggers automatic suppression. Transient bounces do not.
 */
export function isHardBounce(bounce: { type?: string; subType?: string } | undefined): boolean {
    const type = (bounce?.type ?? '').toLowerCase();
    const subType = (bounce?.subType ?? '').toLowerCase();
    if (type === 'permanent') return true;
    return ['suppressed', 'onaccountsuppressionlist', 'noemail'].includes(subType);
}

export type ProviderEventUpdate = {
    providerId: string;
    status?: string;
    openedAt?: Date;
    clickedAt?: Date;
    error?: string;
    /** Hard bounce or spam complaint — set unsubscribedAll for this user. */
    suppressRecipient: boolean;
};

/** Maps a Resend event onto the EmailSend columns. Returns null for events we ignore. */
export function mapResendEvent(payload: ResendWebhookPayload): ProviderEventUpdate | null {
    const providerId = payload.data.email_id;
    if (!providerId) return null;

    const at = payload.created_at ? new Date(payload.created_at) : new Date();
    const timestamp = Number.isNaN(at.getTime()) ? new Date() : at;

    switch (payload.type) {
        case 'email.sent':
            return { providerId, status: 'sent', suppressRecipient: false };
        case 'email.delivered':
            return { providerId, status: 'delivered', suppressRecipient: false };
        case 'email.delivery_delayed':
            // Not terminal; the delivered/bounced event still follows.
            return { providerId, suppressRecipient: false };
        case 'email.bounced': {
            const hard = isHardBounce(payload.data.bounce);
            return {
                providerId,
                status: 'bounced',
                error: (payload.data.bounce?.message ?? `bounce:${payload.data.bounce?.type ?? 'unknown'}`).slice(0, 500),
                suppressRecipient: hard,
            };
        }
        case 'email.complained':
            // A spam complaint is a louder unsubscribe than the button. Honour it.
            return { providerId, status: 'complained', error: 'spam complaint', suppressRecipient: true };
        case 'email.failed':
            return {
                providerId,
                status: 'failed',
                error: (payload.data.failed?.reason ?? 'provider failure').slice(0, 500),
                suppressRecipient: false,
            };
        case 'email.opened':
            return { providerId, openedAt: timestamp, suppressRecipient: false };
        case 'email.clicked':
            return { providerId, clickedAt: timestamp, suppressRecipient: false };
        default:
            return null;
    }
}

/**
 * Svix-format signature verification, implemented here rather than pulled in as a
 * dependency (the `svix` package is not installed and adding one is out of scope
 * for this slice). Signed content is `${id}.${timestamp}.${body}`.
 */
export function verifyResendWebhookSignature(input: {
    secret: string;
    id: string | null;
    timestamp: string | null;
    signatureHeader: string | null;
    payload: string;
    nowSeconds?: number;
    toleranceSeconds?: number;
}): boolean {
    const { secret, id, timestamp, signatureHeader, payload } = input;
    if (!secret || !id || !timestamp || !signatureHeader) return false;

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;

    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
    const tolerance = input.toleranceSeconds ?? 300;
    // Replay window. Without it a captured payload is valid forever.
    if (Math.abs(now - ts) > tolerance) return false;

    let key: Buffer;
    try {
        key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    } catch {
        return false;
    }
    if (key.length === 0) return false;

    const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64');
    const expectedBuf = Buffer.from(expected);

    // The header is a space-separated list of `v<version>,<signature>`.
    return signatureHeader.split(' ').some((entry) => {
        const [version, signature] = entry.split(',');
        if (version !== 'v1' || !signature) return false;
        const candidate = Buffer.from(signature);
        if (candidate.length !== expectedBuf.length) return false;
        return timingSafeEqual(candidate, expectedBuf);
    });
}
