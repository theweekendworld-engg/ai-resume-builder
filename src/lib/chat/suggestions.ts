/**
 * Starter prompts, chosen from the user's state rather than a fixed list: the
 * most useful next step for someone with no jobs tracked is not the same as for
 * someone with three drafts waiting.
 */

import type { ChatContext } from './types';

export type ChatSuggestion = {
    label: string;
    /** Sent as the message when tapped. */
    message: string;
    /** Put in the composer for the user to finish, instead of sending. */
    prefill?: boolean;
};

const name = (role: string | null, company: string | null) =>
    [role, company ? `at ${company}` : null].filter(Boolean).join(' ') || 'my last job';

export function suggestionsFor(context: ChatContext): ChatSuggestion[] {
    const out: ChatSuggestion[] = [];
    const latest = context.jobs[0] ?? null;

    if (!latest) {
        out.push({ label: 'Check a job', message: 'Is this job a fit for me? ', prefill: true });
    } else {
        if (latest.runId) out.push({ label: `Tailor for ${latest.company ?? 'my last job'}`, message: `Tailor my resume for ${name(latest.role, latest.company)}` });
        if (latest.company) out.push({ label: `About ${latest.company}`, message: `Tell me about ${latest.company}` });
        out.push({ label: 'My pipeline', message: 'Show my job pipeline' });
    }
    out.push({ label: 'Log a win', message: 'This week I ', prefill: true });
    const role = context.looking.roles[0];
    const place = context.looking.remote ? 'remote' : context.looking.locations[0];
    out.push(role
        ? { label: `Find ${role} roles`, message: `Find ${role} roles${place ? (place === 'remote' ? ', remote' : ` in ${place}`) : ''}` }
        : { label: 'Find roles', message: 'Find open roles that fit me' });
    out.push({ label: 'What did I ship?', message: 'What have I shipped recently?' });
    if (!context.hasBaseResume) out.push({ label: 'Build a resume', message: 'I want to build a new resume' });
    return out.slice(0, 6);
}
