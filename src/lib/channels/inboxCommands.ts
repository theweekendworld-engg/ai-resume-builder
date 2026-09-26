/**
 * The career inbox from chat: /jobs /applied /insights /notes /help.
 *
 * Channel-neutral: each command renders a `RichMessage`, and Telegram or
 * WhatsApp formats it. WhatsApp has no slash commands, so the same words work
 * bare there ("jobs", "notes").
 *
 * Every list is a read over rows the inbox already owns (the tracker, the
 * Insights shelf, Work Log Wins). Nothing here computes a score or re-ranks:
 * order comes from `careerInbox`, so the bot and the dashboard cannot disagree.
 */

import type { Line, RichMessage, ScoutAction } from '@/lib/channels/types';
import type { ScoutChannelDeps } from '@/lib/channels/scoutDeps';
import type { InsightItem, JobBoardItem, NoteItem } from '@/lib/inbox/types';
import type { FitVerdict } from '@/lib/scout/types';

export const INBOX_COMMANDS = ['jobs', 'applied', 'insights', 'notes', 'help'] as const;
export type InboxCommand = (typeof INBOX_COMMANDS)[number];

/** How many rows a list shows. A chat is not a spreadsheet. */
export const LIST_LIMIT = 8;
/** Confirm buttons on /notes. Telegram caps a keyboard sensibly; WhatsApp lists 10. */
export const NOTE_BUTTONS = 5;

/**
 * "/jobs", "/jobs@Patronus_resume_bot", or — on WhatsApp — a bare "jobs".
 * Only an exact word counts: "jobs I applied to last week" is a note, not a
 * command.
 */
export function parseInboxCommand(raw: string, opts: { allowBare: boolean }): InboxCommand | null {
    const text = String(raw ?? '').trim().toLowerCase();
    const slash = /^\/([a-z]+)(?:@\w+)?$/.exec(text);
    const word = slash ? slash[1] : opts.allowBare ? text : null;
    if (!word) return null;
    return (INBOX_COMMANDS as readonly string[]).includes(word) ? (word as InboxCommand) : null;
}

const VERDICT_EMOJI: Record<FitVerdict, string> = {
    strong: '🟢',
    possible: '🟡',
    stretch: '🟠',
    not_a_fit: '🔴',
    unknown: '⚪',
};

function base(appUrl: string): string {
    return appUrl.replace(/\/$/, '');
}

function cityOf(location: string | null): string | null {
    if (!location) return null;
    return location.split(',')[0]?.trim() || null;
}

/** "🟢 Backend Engineer @ Nightfall AI · 72 · Bengaluru" */
export function jobLine(item: JobBoardItem, appUrl: string): Line {
    const emoji = VERDICT_EMOJI[item.verdict ?? 'unknown'];
    const title = [item.role, item.company].filter(Boolean).join(' @ ') || 'Untitled job';
    const meta = [item.fitScore === null ? null : String(item.fitScore), cityOf(item.location)].filter(Boolean).join(' · ');
    const href = item.runId ? `${base(appUrl)}/scout/${item.runId}` : item.sourceUrl ?? undefined;
    return [
        { text: `${emoji} ` },
        { text: title, bold: true, href },
        ...(meta ? [{ text: ` · ${meta}` }] : []),
    ];
}

function heading(text: string): Line {
    return [{ text, bold: true }];
}

function inboxFooter(appUrl: string, path = '/scout'): Line {
    const url = `${base(appUrl)}${path}`;
    return [{ text: 'Everything, arranged: ' }, { text: url, href: url }];
}

export function renderJobs(items: JobBoardItem[], appUrl: string): RichMessage {
    if (items.length === 0) {
        return {
            lines: [
                heading('No jobs to review yet'),
                [{ text: 'Send me any LinkedIn job link and I will check the fit, pay and company, then keep it here.' }],
            ],
            footer: inboxFooter(appUrl),
            actions: [],
        };
    }
    return {
        lines: [heading('Best fits to review'), [], ...items.slice(0, LIST_LIMIT).map((item) => jobLine(item, appUrl))],
        footer: inboxFooter(appUrl),
        actions: [],
    };
}

const APPLIED_LABEL: Record<string, string> = { applied: 'Applied', interviewing: 'Interviewing', offer: 'Offer' };

export function renderApplied(items: JobBoardItem[], appUrl: string): RichMessage {
    if (items.length === 0) {
        return {
            lines: [
                heading('Nothing applied yet'),
                [{ text: 'After you apply, tap 📨 Applied under the job and I will track it here.' }],
            ],
            footer: inboxFooter(appUrl),
            actions: [],
        };
    }
    const lines: Line[] = [];
    for (const column of ['interviewing', 'offer', 'applied'] as const) {
        const inColumn = items.filter((item) => item.column === column);
        if (inColumn.length === 0) continue;
        if (lines.length) lines.push([]);
        lines.push(heading(`${APPLIED_LABEL[column]} (${inColumn.length})`));
        lines.push(...inColumn.slice(0, LIST_LIMIT).map((item) => jobLine(item, appUrl)));
    }
    return { lines, footer: inboxFooter(appUrl), actions: [] };
}

export function renderInsights(items: InsightItem[], appUrl: string): RichMessage {
    if (items.length === 0) {
        return {
            lines: [
                heading('Your Insights shelf is empty'),
                [{ text: 'Send me a LinkedIn post worth keeping and I will save its key takeaways here.' }],
            ],
            footer: inboxFooter(appUrl),
            actions: [],
        };
    }
    const lines: Line[] = [heading('Latest insights'), []];
    for (const item of items.slice(0, 5)) {
        lines.push([{ text: '📚 ' }, { text: item.title, bold: true, href: item.url ?? undefined }]);
        if (item.takeaways[0]) lines.push([{ text: `   ${item.takeaways[0]}` }]);
    }
    return { lines, footer: inboxFooter(appUrl), actions: [] };
}

const NOTE_STATUS: Record<NoteItem['status'], string> = {
    draft: 'draft',
    confirmed: '✓ in Work Log',
    dismissed: 'dismissed',
    archived: 'archived',
};

export function renderNotes(items: NoteItem[], appUrl: string): RichMessage {
    if (items.length === 0) {
        return {
            lines: [
                heading('No notes yet'),
                [{ text: 'Tell me what you worked on, e.g. "shipped the retry queue today, p99 down 40%". I will draft it into your Work Log.' }],
            ],
            footer: inboxFooter(appUrl, '/log'),
            actions: [],
        };
    }
    const shown = items.slice(0, LIST_LIMIT);
    const lines: Line[] = [heading('Your recent notes'), []];
    for (const item of shown) {
        lines.push([{ text: item.status === 'draft' ? '📝 ' : '• ' }, { text: item.title, bold: item.status === 'draft' }, { text: ` · ${NOTE_STATUS[item.status]}` }]);
    }
    const drafts = shown.filter((item) => item.status === 'draft').slice(0, NOTE_BUTTONS);
    const actions: ScoutAction[] = drafts.map((item) => ({
        kind: 'confirm_win' as const,
        winId: item.winId,
        label: `✅ ${item.title}`,
    }));
    if (drafts.length) lines.push([], [{ text: 'Tap a draft to confirm it as evidence.', italic: true }]);
    return { lines, footer: inboxFooter(appUrl, '/log'), actions };
}

export function renderHelp(appUrl: string, opts: { bare: boolean }): RichMessage {
    const cmd = (name: string) => (opts.bare ? name : `/${name}`);
    return {
        lines: [
            heading('Send me anything from your career'),
            [{ text: '• A LinkedIn job or post link: fit, pay, company, interview write-ups, who to ask' }],
            [{ text: '• A note on what you did: drafted into your Work Log' }],
            [{ text: '• A post worth keeping: saved to your Insights shelf' }],
            [],
            heading('Look things up'),
            [{ text: `${cmd('jobs')}: best fits to review` }],
            [{ text: `${cmd('applied')}: what you have applied to and where it stands` }],
            [{ text: `${cmd('insights')}: your saved insights` }],
            [{ text: `${cmd('notes')}: your notes and drafts` }],
        ],
        footer: inboxFooter(appUrl),
        actions: [],
    };
}

/** Run a command for a linked, Scout-enabled user. */
export async function renderInboxCommand(
    command: InboxCommand,
    userId: string,
    deps: Pick<ScoutChannelDeps, 'topFits' | 'listJobBoard' | 'listInsights' | 'listChatNotes'>,
    appUrl: string,
    opts: { bare: boolean },
): Promise<RichMessage> {
    switch (command) {
        case 'jobs':
            return renderJobs(await deps.topFits(userId, { limit: LIST_LIMIT }), appUrl);
        case 'applied':
            return renderApplied(await deps.listJobBoard(userId, { columns: ['applied', 'interviewing', 'offer'], sort: 'recent', limit: 30 }), appUrl);
        case 'insights':
            return renderInsights(await deps.listInsights(userId, { limit: 5 }), appUrl);
        case 'notes':
            return renderNotes(await deps.listChatNotes(userId, { limit: LIST_LIMIT }), appUrl);
        case 'help':
            return renderHelp(appUrl, opts);
    }
}
