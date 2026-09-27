/**
 * The bot's linking and welcome copy, in one place, for Telegram and WhatsApp.
 *
 * Before, every one of these said "use /generate <job description>", the
 * resume command from before Scout, and the "already linked" reply hid a
 * conflict: a chat linked to a DIFFERENT Patronus account was told it was
 * fine, and everything it sent went on landing in the other account.
 * Plain text; the channel escapes it.
 */

export function whatTheBotDoes(opts: { bare: boolean }): string {
    const c = (name: string) => (opts.bare ? name : `/${name}`);
    return [
        'Send me:',
        '• a LinkedIn job or post link: fit, pay, company, interview write-ups, who to ask',
        '• a line about your work: drafted into your Work Log',
        '• a post worth keeping: saved to your Insights shelf',
        '',
        `${c('jobs')} best fits · ${c('applied')} where things stand · ${c('notes')} your drafts${opts.bare ? '' : ' · /generate a tailored resume'} · ${c('help')} everything`,
    ].join('\n');
}

export function linkedText(account: string, opts: { bare: boolean }): string {
    return `Linked to ${account}.\n\n${whatTheBotDoes(opts)}`;
}

export function welcomeBackText(account: string, opts: { bare: boolean }): string {
    return `Welcome back. This chat records to ${account}.\n\n${whatTheBotDoes(opts)}`;
}

/** A bare /start, or any message, from a chat that is not linked yet. */
export function notLinkedText(dashboardUrl: string, app: 'Telegram' | 'WhatsApp'): string {
    return [
        `This ${app} is not linked to Patronus yet.`,
        '',
        `Open ${dashboardUrl} and tap "Link ${app}". It brings you straight back here, already linked.`,
    ].join('\n');
}

/** The chat belongs to a different Patronus account than the one linking. */
export function conflictText(params: { otherAccount: string; app: 'Telegram' | 'WhatsApp'; unlinkCommand: string }): string {
    return [
        `This ${params.app} is linked to another Patronus account (${params.otherAccount}).`,
        '',
        `To move it here, open Patronus on that account and tap Unlink, or send ${params.unlinkCommand} here, then use the link again.`,
    ].join('\n');
}

/** The link token was spent or expired, and the chat is already linked. */
export function alreadyLinkedText(account: string): string {
    return `This chat is already linked to ${account}. That link had expired or was already used, so nothing changed.`;
}

export const UNLINK_CONFIRM = 'Unlink this chat from Patronus? Messages sent here will stop being recorded until you link again.';

export function unlinkedText(dashboardUrl: string): string {
    return `Unlinked. Nothing you send here is recorded now. To link an account, open ${dashboardUrl}.`;
}
