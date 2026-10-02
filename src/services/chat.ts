/**
 * Chat: one message in, an action run, a reply with cards out
 * (docs/prd/10-chat.md).
 *
 * Every action here is a call into the service its own page already uses, so
 * metering, dedupe and the rule-5 transaction behave exactly as they do there.
 * Nothing in this file confirms a Win, sends a message or deletes anything:
 * those are buttons on the cards.
 *
 * Plain server code, not a server action: the identity comes from the caller
 * (`src/actions/chat.ts` takes it from the session), never from input.
 */

import { Channel, Prisma, WinSource, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { track } from '@/lib/track';
import { err, ok, type Result } from '@/lib/result';
import { buildChatContext, toChatJob } from '@/lib/chat/context';
import { searchRecord } from '@/lib/chat/askRecord';
import { findPostings } from '@/lib/chat/findJobs';
import { CHAT_MESSAGE_MAX, ROUTER_FALLBACK, routeMessage, type HistoryTurn } from '@/lib/chat/router';
import type { ChatAction, ChatCard, ChatContext, ChatJob, ChatMessageView, RouteDecision } from '@/lib/chat/types';
import { listJobBoard, setJobStatus } from '@/services/careerInbox';
import { draftScoutOutreach, startScoutRun } from '@/services/scout';
import { tailorResumeForRun } from '@/services/tailor';
import { createWinDraftForUser } from '@/services/wins';

export const THREAD_PAGE = 60;

type Reply = { text: string; cards: ChatCard[] };

// ───────────────────────────────────────────────────────────── storage

export async function ensureConversation(userId: string, channel: Channel = Channel.web) {
    return prisma.chatConversation.upsert({
        where: { userId_channel: { userId, channel } },
        create: { userId, channel },
        update: {},
    });
}

type MessageRow = { id: string; role: string; text: string; cards: Prisma.JsonValue; action: string | null; createdAt: Date };

export function toMessageView(row: MessageRow): ChatMessageView {
    return {
        id: row.id,
        role: row.role === 'user' ? 'user' : 'assistant',
        text: row.text,
        cards: Array.isArray(row.cards) ? (row.cards as unknown as ChatCard[]) : [],
        action: (row.action as ChatAction | null) ?? null,
        createdAt: row.createdAt.toISOString(),
    };
}

export async function listThread(userId: string, channel: Channel = Channel.web): Promise<ChatMessageView[]> {
    const conversation = await prisma.chatConversation.findUnique({ where: { userId_channel: { userId, channel } } });
    if (!conversation) return [];
    const rows = await prisma.chatMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        take: THREAD_PAGE,
    });
    return hydrateDrafts(userId, rows.reverse().map(toMessageView));
}

/** Read each Win draft card's current state from its Win: the card was a snapshot. */
async function hydrateDrafts(userId: string, messages: ChatMessageView[]): Promise<ChatMessageView[]> {
    const winIds = messages.flatMap((m) => m.cards.flatMap((card) => (card.type === 'win_draft' ? [card.winId] : [])));
    if (winIds.length === 0) return messages;
    const wins = await prisma.win.findMany({ where: { id: { in: winIds }, userId }, select: { id: true, status: true } });
    const state = new Map(wins.map((win) => [win.id, win.status]));
    return messages.map((m) => ({
        ...m,
        cards: m.cards.map((card) => {
            if (card.type !== 'win_draft') return card;
            const status = state.get(card.winId);
            const current = status === WinStatus.draft ? 'draft' : status === WinStatus.dismissed || !status ? 'dismissed' : 'confirmed';
            return { ...card, current };
        }),
    }));
}

// ───────────────────────────────────────────────────────────── actions

function jobAt(context: ChatContext, decision: RouteDecision): ChatJob | null {
    return decision.jobIndex ? context.jobs[decision.jobIndex - 1] ?? null : null;
}

function jobName(job: ChatJob): string {
    return [job.role, job.company ? `at ${job.company}` : null].filter(Boolean).join(' ') || 'this job';
}

/** An `err` from a service, said plainly. Entitlement copy already names the fix. */
function failure(error: string): Reply {
    return { text: error, cards: [] };
}

export type ActionChannel = 'web' | 'telegram' | 'whatsapp';

export async function runAction(
    userId: string,
    decision: RouteDecision,
    context: ChatContext,
    opts: { channel?: ActionChannel } = {},
): Promise<Reply> {
    const channel = opts.channel ?? 'web';
    const say = (fallback: string) => decision.reply.trim() || fallback;

    switch (decision.action) {
        case 'analyze_job': {
            const started = await startScoutRun({
                userId,
                input: { url: decision.url, text: decision.url ? null : decision.text, source: 'dashboard' },
                channel: Channel.web,
            });
            if (!started.success) return failure(started.error);
            const { run, created } = started.data;
            return {
                text: created ? say('Reading it now. The fit, company and pay land below as they come in.') : 'You have shared this one before; here is what I found.',
                cards: [{ type: 'scout_run', runId: run.id, status: run.status, kind: run.kind, headline: run.headline }],
            };
        }

        case 'research_company': {
            const company = (decision.company ?? '').trim();
            const started = await startScoutRun({
                userId,
                input: { text: `Research the company: ${company}`, source: 'dashboard', intent: 'company_research', company },
                channel: Channel.web,
            });
            if (!started.success) return failure(started.error);
            const { run } = started.data;
            return {
                text: say(`Looking into ${company}: what it does, funding, size and open roles, each with its source.`),
                cards: [{ type: 'scout_run', runId: run.id, status: run.status, kind: run.kind, headline: run.headline }],
            };
        }

        case 'log_work': {
            const drafted = await createWinDraftForUser({ userId, text: decision.text ?? '', source: WinSource.chat });
            if (!drafted.success) return failure(drafted.error);
            const draft = drafted.data;
            return {
                text: draft.status === 'merge_proposed'
                    ? 'This looks like something already in your Work Log, so I did not add it twice.'
                    : 'Here is the draft. It goes into your record when you confirm it.',
                cards: [{
                    type: 'win_draft',
                    winId: draft.winId,
                    title: draft.title,
                    narrative: draft.narrative,
                    category: draft.category,
                    status: draft.status,
                }],
            };
        }

        case 'tailor_resume': {
            const job = jobAt(context, decision);
            if (!job) return failure('Which job? Tell me the company.');
            if (!job.runId) return failure(`I do not have the posting for ${jobName(job)}. Send me its link and I will tailor from that.`);
            // The session carries the channel, so a Telegram request gets its
            // questions and the finished resume in Telegram.
            const started = await tailorResumeForRun(userId, job.runId, channel);
            if (!started.success) {
                if (started.code === 'no_base_resume') {
                    return {
                        text: started.error,
                        cards: [{ type: 'link', label: 'Upload your resume', href: '/build', description: 'Tailoring starts from the resume you already have.' }],
                    };
                }
                return failure(started.error);
            }
            const session = started.data;
            return {
                text: session.status === 'awaiting_clarification'
                    ? 'One question first, so the resume says the right thing.'
                    : say(`Tailoring your resume for ${jobName(job)}.`),
                cards: [{
                    type: 'generation',
                    sessionId: session.sessionId,
                    resumeId: session.resumeId,
                    status: session.status,
                    title: jobName(job),
                    question: session.nextQuestion?.question ?? null,
                }],
            };
        }

        case 'draft_outreach': {
            const job = jobAt(context, decision);
            if (!job?.runId) return failure('I need the job link for that one first.');
            const drafted = await draftScoutOutreach(userId, job.runId, {
                target: decision.draftTarget ?? 'recruiter',
                format: decision.draftFormat ?? 'linkedin_message',
                note: decision.query,
            });
            if (!drafted.success) return failure(drafted.error);
            return {
                text: 'A draft to edit and send yourself. Nothing is sent from here.',
                cards: [{ type: 'outreach', runId: job.runId, draft: drafted.data }],
            };
        }

        case 'update_job': {
            const job = jobAt(context, decision);
            if (!job || !decision.jobAction) return failure('Which job, and what happened?');
            const moved = await setJobStatus(userId, { workspaceId: job.workspaceId }, decision.jobAction);
            if (!moved.success) return failure(moved.error);
            return {
                text: say(`Updated ${jobName(job)}.`),
                cards: [{ type: 'jobs', title: 'Updated', items: [toChatJob(moved.data)] }],
            };
        }

        case 'show_jobs': {
            const items = await listJobBoard(userId, decision.column ? { columns: [decision.column] } : {});
            const jobs = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8).map(toChatJob);
            if (jobs.length === 0) {
                return { text: 'Nothing in your tracker yet. Send me a job link and I will score it against your record.', cards: [] };
            }
            return { text: say('Here is your pipeline.'), cards: [{ type: 'jobs', title: 'Your jobs', items: jobs }] };
        }

        case 'find_jobs': {
            const query = decision.query ?? '';
            const { items, searched } = await findPostings({
                query,
                location: decision.location,
                remoteOnly: decision.remoteOnly ?? false,
            });
            const note = searched === 0
                ? null
                : `Searched ${searched.toLocaleString('en-US')} open roles on the company job boards I follow. Send me any other job link and I will score it the same way.`;
            if (items.length === 0) {
                return {
                    text: searched === 0
                        ? 'I am not following any job boards yet. Send me a job link from anywhere and I will score it against your record.'
                        : 'Nothing open matches that on the boards I follow. Try fewer words, or send me a link you found.',
                    cards: [],
                };
            }
            return { text: say('Open roles that match.'), cards: [{ type: 'postings', query, items, note }] };
        }

        case 'ask_record': {
            const query = decision.query ?? '';
            const items = await searchRecord(userId, query);
            if (items.length === 0) {
                return {
                    text: 'I found nothing in your confirmed record about that. Tell me what you did and I will draft it.',
                    cards: [],
                };
            }
            return { text: say('From your record.'), cards: [{ type: 'record', query, items }] };
        }

        case 'build_resume':
            return {
                text: say('Start a new resume here.'),
                cards: [{ type: 'link', label: 'Open the resume builder', href: '/build', description: 'Upload a resume or start from your record.' }],
            };

        case 'answer':
        case 'clarify':
            return { text: decision.reply.trim() || ROUTER_FALLBACK, cards: [] };
    }
}

// ───────────────────────────────────────────────────────────── the turn

export type SendResult = { user: ChatMessageView; assistant: ChatMessageView };

export async function sendChatMessage(params: {
    userId: string;
    text: string;
    clientId: string;
    channel?: Channel;
}): Promise<Result<SendResult>> {
    const text = params.text.trim();
    if (!text) return err('Type a message', 'invalid_input');
    if (text.length > CHAT_MESSAGE_MAX) return err(`Keep it under ${CHAT_MESSAGE_MAX.toLocaleString('en-US')} characters`, 'invalid_input');

    const conversation = await ensureConversation(params.userId, params.channel ?? Channel.web);

    // The same clientId twice is one message: return the turn already stored.
    const existing = await prisma.chatMessage.findUnique({
        where: { conversationId_clientId: { conversationId: conversation.id, clientId: params.clientId } },
    });
    if (existing) {
        const reply = await prisma.chatMessage.findFirst({
            where: { conversationId: conversation.id, role: 'assistant', createdAt: { gte: existing.createdAt } },
            orderBy: { createdAt: 'asc' },
        });
        if (reply) return ok({ user: toMessageView(existing), assistant: toMessageView(reply) });
        return err('Still working on that one.', 'in_flight');
    }

    let userRow;
    try {
        userRow = await prisma.chatMessage.create({
            data: { conversationId: conversation.id, userId: params.userId, role: 'user', text, clientId: params.clientId },
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return err('Still working on that one.', 'in_flight');
        }
        throw error;
    }

    const recent = await prisma.chatMessage.findMany({
        where: { conversationId: conversation.id, id: { not: userRow.id } },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { role: true, text: true },
    });
    const history: HistoryTurn[] = recent.reverse().map((row) => ({ role: row.role === 'user' ? 'user' : 'assistant', text: row.text }));

    let action: ChatAction | null = null;
    let reply: Reply;
    try {
        const context = await buildChatContext(params.userId);
        const routed = await routeMessage({ userId: params.userId, message: text, history, context });
        action = routed.decision.action;
        reply = await runAction(params.userId, routed.decision, context);
    } catch (error) {
        // Never lose what the user typed: their message is stored, and they
        // get a reply that says what to do next.
        console.error('[chat] turn failed', { userId: params.userId, action, error: error instanceof Error ? error.message : String(error) });
        reply = { text: ROUTER_FALLBACK, cards: [] };
    }

    const assistantRow = await prisma.chatMessage.create({
        data: {
            conversationId: conversation.id,
            userId: params.userId,
            role: 'assistant',
            text: reply.text,
            cards: reply.cards as unknown as Prisma.InputJsonValue,
            action,
        },
    });
    await prisma.chatConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: assistantRow.createdAt } });
    await track(params.userId, 'chat_message', { action, cards: reply.cards.map((card) => card.type), channel: params.channel ?? 'web' });

    return ok({ user: toMessageView(userRow), assistant: toMessageView(assistantRow) });
}

// ───────────────────────────────────────────────────────────── channels

/**
 * What a channel should do with free text (docs/prd/10-chat.md §4).
 *
 * Recording a note, analysing a job and researching a company keep the
 * channel's own Scout flow, with its live progress message and Confirm
 * buttons: `scout`. Everything else runs here and comes back as text.
 * Null means "do what you did before": chat is off for this user, or the
 * router failed, and a note must never be lost to a routing error.
 */
export type ChannelRoute =
    | { kind: 'scout'; company: string | null }
    | { kind: 'reply'; text: string };

const SCOUT_ACTIONS = new Set<ChatAction>(['log_work', 'analyze_job', 'research_company']);

export async function routeChannelText(userId: string, text: string, channel: 'telegram' | 'whatsapp'): Promise<ChannelRoute | null> {
    const { isEnabled } = await import('@/lib/flags');
    if (!(await isEnabled(userId, 'chat'))) return null;
    try {
        const context = await buildChatContext(userId);
        const { decision } = await routeMessage({ userId, message: text, history: [], context });
        await track(userId, 'chat_message', { action: decision.action, channel });
        if (SCOUT_ACTIONS.has(decision.action)) {
            return { kind: 'scout', company: decision.action === 'research_company' ? decision.company : null };
        }
        const reply = await runAction(userId, decision, context, { channel });
        const { config } = await import('@/lib/config');
        const { replyToText } = await import('@/lib/chat/renderText');
        return { kind: 'reply', text: replyToText(reply, config.app.url) };
    } catch (error) {
        console.warn('[chat] channel routing failed; using the Scout flow', {
            channel,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
