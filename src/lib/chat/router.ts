/**
 * The chat router: one message in, one action out (docs/prd/10-chat.md §2).
 *
 * The model chooses from a closed list and fills arguments; it never writes an
 * id, a URL it was not given, or a figure. Jobs are picked by their index in a
 * numbered list the code built, as Scout picks sources by index. Everything it
 * returns is re-checked here before any of it is acted on.
 */

import { z } from 'zod';
import { generateStructured } from '@/lib/ai/structured';
import { extractUrls } from '@/lib/scout/message';
import { BOARD_COLUMNS, JOB_ACTIONS } from '@/lib/inbox/types';
import { CHAT_ACTIONS, DRAFT_FORMATS, DRAFT_TARGETS, type ChatContext, type RouteDecision } from './types';

export const CHAT_MESSAGE_MAX = 4_000;
/** Turns of history the router sees. Enough for "tailor it" to mean the last job. */
export const HISTORY_TURNS = 12;

const RouteSchema = z.object({
    action: z.enum(CHAT_ACTIONS),
    reply: z.string().max(1_200),
    url: z.string().max(2_000).nullable(),
    text: z.string().max(CHAT_MESSAGE_MAX).nullable(),
    company: z.string().max(120).nullable(),
    jobIndex: z.number().int().nullable(),
    jobAction: z.enum(JOB_ACTIONS).nullable(),
    draftTarget: z.enum(DRAFT_TARGETS).nullable(),
    draftFormat: z.enum(DRAFT_FORMATS).nullable(),
    query: z.string().max(300).nullable(),
    location: z.string().max(120).nullable(),
    remoteOnly: z.boolean().nullable(),
    column: z.enum(BOARD_COLUMNS).nullable(),
});

export const ROUTER_SYSTEM = `You are Patronus, a career assistant inside an app that keeps the user's private, evidence-backed record of their working life. You do not chat for its own sake: you route each message to ONE action the app performs, and write one short line to show with the result.

Actions:
- analyze_job: the user shares a job link, or pastes a job description or a LinkedIn post, or asks whether a job fits. Put the link in url, or pasted text in text.
- research_company: the user wants to know about a company (funding, size, what it does, whether it is hiring). Put the name in company exactly as they wrote it.
- log_work: the user describes something THEY did at work: shipped, fixed, led, launched, measured, learned, praise they got. Put their words in text, unchanged. It becomes a draft they confirm.
- tailor_resume: the user wants a resume for one of their tracked jobs. Set jobIndex.
- build_resume: the user wants a new resume without a specific job, or to start from scratch.
- draft_outreach: a message to someone about one of their tracked jobs (recruiter, hiring manager, referral, alumni, the poster). Set jobIndex, draftTarget, draftFormat; put any steer in query.
- update_job: the user reports progress on a tracked job (applied, interviewing, offer, rejected, not interested, save it). Set jobIndex and jobAction.
- show_jobs: the user asks what is in their tracker or pipeline. Set column if they name a stage.
- find_jobs: the user wants to discover openings. Put role keywords in query, a place in location, remoteOnly if they ask for remote.
- ask_record: the user asks about their OWN past work ("what did I ship last quarter", "my Kafka work"). Put the topic in query.
- answer: a general career question none of the above covers (how to prepare, how to negotiate, what to say). Answer in reply, briefly and concretely.
- clarify: you cannot tell what they want, or which job they mean. Ask ONE short question in reply.

Rules:
- jobIndex is the number shown in the job list below. If they say "it" or "this job", use the job the conversation was just about. If you are not sure which job, use clarify. Never guess an index that is not in the list.
- Never invent a number, salary, date, statistic or fact about the user or a company. In reply, use only figures that appear in the user's message, the conversation, or the context below. If they ask for a figure you do not have, say you will not guess and suggest the action that would find it.
- reply is one or two plain sentences. No markdown headings, no lists unless the action is answer.
- Leave every field you do not need as null.`;

/** A message that is only a link (or links) needs no model to understand. */
export function deterministicRoute(message: string): RouteDecision | null {
    const urls = extractUrls(message);
    if (urls.length === 0) return null;
    const rest = urls.reduce((text, url) => text.replace(url, ''), message).replace(/[\s.,;:!?-]+/g, ' ').trim();
    if (rest.length > 12) return null;
    return emptyDecision('analyze_job', 'Reading that now.', { url: urls[0] });
}

export function emptyDecision(action: RouteDecision['action'], reply: string, patch: Partial<RouteDecision> = {}): RouteDecision {
    return {
        action,
        reply,
        url: null,
        text: null,
        company: null,
        jobIndex: null,
        jobAction: null,
        draftTarget: null,
        draftFormat: null,
        query: null,
        location: null,
        remoteOnly: null,
        column: null,
        ...patch,
    };
}

/** The context block, as the router reads it. Also the numeric guard's source. */
export function renderContext(context: ChatContext): string {
    const jobs = context.jobs.length === 0
        ? 'Tracked jobs: none yet.'
        : [
            'Tracked jobs (most recent first):',
            ...context.jobs.map((job, i) => {
                const parts = [job.role ?? 'Role not known', job.company ? `at ${job.company}` : null, `status ${job.status}`];
                if (job.verdict && job.verdict !== 'unknown') parts.push(`fit ${job.verdict}${job.fitScore !== null ? ` ${job.fitScore}` : ''}`);
                return `${i + 1}. ${parts.filter(Boolean).join(', ')}`;
            }),
        ].join('\n');
    return [
        jobs,
        `Unconfirmed Work Log drafts: ${context.draftCount}.`,
        `Has a base resume: ${context.hasBaseResume ? 'yes' : 'no'}.`,
        context.openQuestion ? `Scout is waiting on an answer: "${context.openQuestion.question}"` : null,
    ].filter(Boolean).join('\n');
}

export type HistoryTurn = { role: 'user' | 'assistant'; text: string };

/** Re-check what the model returned against what it was shown. */
export function sanitizeDecision(raw: RouteDecision, context: ChatContext, message: string): RouteDecision {
    const decision = { ...raw };
    // An index outside the list is a guess; a guess about which job is a clarify.
    if (decision.jobIndex !== null && (decision.jobIndex < 1 || decision.jobIndex > context.jobs.length)) {
        decision.jobIndex = null;
    }
    // A URL the user did not send is never followed.
    if (decision.url && !extractUrls(message).includes(decision.url)) decision.url = extractUrls(message)[0] ?? null;

    const needsJob = decision.action === 'tailor_resume' || decision.action === 'draft_outreach' || decision.action === 'update_job';
    if (needsJob && decision.jobIndex === null) {
        if (context.jobs.length === 1) decision.jobIndex = 1;
        else {
            return emptyDecision(
                'clarify',
                context.jobs.length === 0
                    ? 'You have no jobs in your tracker yet. Send me a job link first and I will add it.'
                    : 'Which job do you mean? Tell me the company.',
            );
        }
    }
    if (decision.action === 'update_job' && !decision.jobAction) {
        return emptyDecision('clarify', 'What happened with it: applied, interviewing, offer, rejected, or not interested?');
    }
    if (decision.action === 'log_work' && !decision.text?.trim()) decision.text = message;
    if (decision.action === 'analyze_job' && !decision.url && !decision.text?.trim()) {
        const urls = extractUrls(message);
        if (urls.length > 0) decision.url = urls[0];
        else if (message.trim().length >= 200) decision.text = message;
        else return emptyDecision('clarify', 'Send me the job link, or paste the job description.');
    }
    if (decision.action === 'research_company' && !decision.company?.trim()) {
        return emptyDecision('clarify', 'Which company?');
    }
    return decision;
}

export const ROUTER_FALLBACK = 'I could not work that out. Try rephrasing, or send a job link.';
export const NO_GUESS_REPLY = 'I will not guess at a figure I cannot source. Send me the job link, or ask me to research the company, and I will look it up.';

export async function routeMessage(params: {
    userId: string;
    message: string;
    history: HistoryTurn[];
    context: ChatContext;
}): Promise<{ decision: RouteDecision; costUsd: number; degraded: boolean }> {
    const shortcut = deterministicRoute(params.message);
    if (shortcut) return { decision: shortcut, costUsd: 0, degraded: false };

    const contextText = renderContext(params.context);
    const history = params.history
        .slice(-HISTORY_TURNS)
        .map((turn) => `${turn.role === 'user' ? 'User' : 'Patronus'}: ${turn.text.slice(0, 600)}`)
        .join('\n');
    const prompt = [
        `Context:\n${contextText}`,
        history ? `Conversation so far:\n${history}` : null,
        `New message from the user:\n"""\n${params.message}\n"""`,
    ].filter(Boolean).join('\n\n');

    const result = await generateStructured({
        task: 'chatRoute',
        feature: 'chat',
        userId: params.userId,
        schema: RouteSchema,
        system: ROUTER_SYSTEM,
        prompt,
        // The only figures a reply may carry are ones the user or their record
        // supplied (CLAUDE.md: no fabricated quantities).
        guard: { sourceText: `${params.message}\n${history}\n${contextText}`, fields: ['reply'] },
    });

    let decision = sanitizeDecision(result.data as RouteDecision, params.context, params.message);
    if (!decision.reply.trim()) {
        decision = decision.action === 'answer' || decision.action === 'clarify'
            ? { ...decision, action: 'answer', reply: NO_GUESS_REPLY }
            : decision;
    }
    return { decision, costUsd: result.usage.costUsd, degraded: result.degraded };
}
