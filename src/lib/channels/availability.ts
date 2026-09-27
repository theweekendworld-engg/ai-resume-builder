/**
 * Which chat channels actually work on this deployment.
 *
 * Copy that names a channel must ask here first. Production advertised
 * WhatsApp in five places while no WHATSAPP_* variable was set (audit
 * 2026-09-27, flow L): every mention of it was a dead end. Pure over `env`
 * so the gating is testable.
 */

import { readWhatsAppConfig } from '@/lib/whatsapp';

export type ChannelsAvailable = {
    telegram: boolean;
    whatsapp: boolean;
    /** Without the leading @. Null when unset. */
    telegramBotUsername: string | null;
};

export function channelsAvailable(env: Record<string, string | undefined> = process.env): ChannelsAvailable {
    const username = env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '') || null;
    return {
        telegram: Boolean(env.TELEGRAM_BOT_TOKEN?.trim()),
        whatsapp: readWhatsAppConfig(env) !== null,
        telegramBotUsername: username,
    };
}

/** "Telegram", "WhatsApp", "Telegram or WhatsApp" — the apps a user can link. */
export function chatAppsLabel(available: Pick<ChannelsAvailable, 'telegram' | 'whatsapp'>, joiner: 'or' | '&' = 'or'): string {
    const names = [available.telegram ? 'Telegram' : null, available.whatsapp ? 'WhatsApp' : null].filter(Boolean);
    if (names.length === 0) return 'a chat app';
    return names.join(` ${joiner} `);
}
