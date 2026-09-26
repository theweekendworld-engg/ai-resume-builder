/**
 * Drive the real Telegram bot from this machine, against the LOCAL database.
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/resume_builder \
 *   DIRECT_URL=$DATABASE_URL \
 *   bun scripts/telegram-dev.ts --user <userId> [--minutes 30]
 *
 * Telegram delivers a bot's messages EITHER to a webhook OR to getUpdates,
 * never both. So this borrows the bot: it records the current webhook,
 * removes it, long-polls, and feeds every update through the same
 * `processTelegramUpdate` the webhook route calls. While it runs, production
 * does not hear this bot.
 *
 * The webhook is ALWAYS restored — on Ctrl-C, on SIGTERM, on a crash, and on a
 * dead-man timer (default 30 minutes) — using the recorded URL, allowed
 * updates and max connections, plus TELEGRAM_WEBHOOK_SECRET. That secret must
 * equal production's or the restored webhook will 401; check before running:
 *   curl -X POST -H "x-telegram-bot-api-secret-token: $SECRET" -d '{}' <webhook url>
 * should return 200. A copy of the recorded config is written to the OS temp
 * dir so a hard kill (-9) can be recovered with `--restore-only`.
 *
 * `--user` also enables the `scout` flag for that user and prints a one-time
 * link that connects your Telegram chat to that local user.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Channel } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { invalidateFlagCache } from '@/lib/flags';
import { processTelegramUpdate, TelegramUpdateSchema } from '@/services/telegramAgent';
import { answerTelegramCallbackQuery } from '@/lib/telegram';
import { handleDigestCallback } from '@/lib/jobs/handlers/weeklyDigest';

type WebhookConfig = { url: string; allowed_updates?: string[]; max_connections?: number };

const BACKUP_PATH = join(tmpdir(), 'patronus-telegram-webhook-backup.json');

function token(): string {
    const value = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!value) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    return value;
}

async function tg<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const json = (await response.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) throw new Error(`${method}: ${json.description ?? response.status}`);
    return json.result as T;
}

async function restore(config: WebhookConfig): Promise<void> {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    await tg('setWebhook', {
        url: config.url,
        ...(secret ? { secret_token: secret } : {}),
        ...(config.allowed_updates ? { allowed_updates: config.allowed_updates } : {}),
        ...(config.max_connections ? { max_connections: config.max_connections } : {}),
    });
    const info = await tg<{ url: string }>('getWebhookInfo');
    console.log(`\nwebhook restored → ${info.url}`);
}

function arg(name: string): string | null {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function prepareUser(userId: string): Promise<void> {
    const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { fullName: true } });
    if (!profile) throw new Error(`No local UserProfile for ${userId}`);

    const flag = await prisma.featureFlag.findUnique({ where: { key: 'scout' } });
    const allow = new Set(Array.isArray(flag?.allowUserIds) ? (flag!.allowUserIds as string[]) : []);
    allow.add(userId);
    await prisma.featureFlag.upsert({
        where: { key: 'scout' },
        create: { key: 'scout', enabled: false, allowUserIds: [...allow], description: 'Scout link-in agent' },
        update: { allowUserIds: [...allow] },
    });
    invalidateFlagCache();
    console.log(`scout flag: on for ${profile.fullName ?? userId} (allow-list)`);

    const linked = await prisma.channelIdentity.findFirst({ where: { userId, channel: Channel.telegram, verified: true } });
    if (linked) {
        console.log('telegram: this user is already linked to a chat');
        return;
    }
    const linkToken = randomBytes(16).toString('hex');
    await prisma.channelLinkToken.create({
        data: { userId, channel: Channel.telegram, token: linkToken, expiresAt: new Date(Date.now() + 30 * 60_000) },
    });
    const bot = process.env.TELEGRAM_BOT_USERNAME?.trim();
    console.log(`telegram: open this link once to connect your chat →  https://t.me/${bot}?start=link_${linkToken}`);
}

/** Same routing as `src/app/api/telegram/webhook/route.ts`, minus the HTTP. */
async function handle(update: unknown): Promise<void> {
    const raw = update as { callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } } };
    const callback = raw.callback_query;
    if (callback?.data?.startsWith('d:') && callback.message) {
        const result = await handleDigestCallback({
            data: callback.data,
            chatId: String(callback.message.chat.id),
            messageId: callback.message.message_id,
        });
        if (result.handled) {
            await answerTelegramCallbackQuery(callback.id);
            return;
        }
    }
    const parsed = TelegramUpdateSchema.safeParse(update);
    if (!parsed.success) return;
    if (parsed.data.callback_query?.id) await answerTelegramCallbackQuery(parsed.data.callback_query.id);
    await processTelegramUpdate(parsed.data);
}

async function main() {
    if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
        console.error('Refusing to run: DATABASE_URL is not the local database.');
        process.exit(2);
    }

    if (process.argv.includes('--restore-only')) {
        if (!existsSync(BACKUP_PATH)) throw new Error(`No backup at ${BACKUP_PATH}`);
        await restore(JSON.parse(readFileSync(BACKUP_PATH, 'utf8')) as WebhookConfig);
        return;
    }

    const userId = arg('--user');
    if (userId) await prepareUser(userId);

    const current = await tg<WebhookConfig>('getWebhookInfo');
    // Resuming after a hard kill: the webhook is already gone, the backup is not.
    const config: WebhookConfig | null = current.url
        ? { url: current.url, allowed_updates: current.allowed_updates, max_connections: current.max_connections }
        : existsSync(BACKUP_PATH) ? JSON.parse(readFileSync(BACKUP_PATH, 'utf8')) as WebhookConfig : null;
    if (config) writeFileSync(BACKUP_PATH, JSON.stringify(config));

    let restored = false;
    const shutdown = async (reason: string, code = 0) => {
        if (restored) return;
        restored = true;
        console.log(`\nstopping (${reason})`);
        if (config) await restore(config).catch((error) => console.error('RESTORE FAILED — run with --restore-only', error));
        await prisma.$disconnect().catch(() => undefined);
        process.exit(code);
    };
    process.on('SIGINT', () => void shutdown('Ctrl-C'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('uncaughtException', (error) => {
        console.error(error);
        void shutdown('crash', 1);
    });

    const minutes = Number(arg('--minutes') ?? 30);
    setTimeout(() => void shutdown(`dead-man timer, ${minutes} min`), minutes * 60_000).unref();

    await tg('deleteWebhook', { drop_pending_updates: false });
    console.log(`webhook removed (was ${config?.url ?? 'none'}); polling for ${minutes} min. Ctrl-C restores it.`);

    let offset = 0;
    while (!restored) {
        let updates: { update_id: number }[] = [];
        try {
            updates = await tg<{ update_id: number }[]>('getUpdates', {
                offset,
                timeout: 25,
                allowed_updates: config?.allowed_updates ?? ['message', 'callback_query'],
            });
        } catch (error) {
            console.warn('getUpdates failed, retrying in 3s', String(error));
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            continue;
        }
        for (const update of updates) {
            offset = update.update_id + 1;
            const summary = JSON.stringify(update).slice(0, 160);
            console.log(`← ${summary}`);
            // Not awaited in series with polling: a Scout run takes ~20s and
            // the next message should not wait for it. processTelegramUpdate
            // itself returns once the run is enqueued (inline in dev).
            void handle(update).catch((error) => console.error('handler error', error));
        }
    }
}

main().catch(async (error) => {
    console.error(error);
    process.exit(1);
});
