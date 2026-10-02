/**
 * A chat reply as plain text, for channels that cannot render cards
 * (Telegram, WhatsApp). Every card keeps one link back to its full page.
 */

import type { ChatCard } from './types';

const VERDICT: Record<string, string> = {
    strong: 'Strong fit',
    possible: 'Possible fit',
    stretch: 'Stretch',
    not_a_fit: 'Not a fit',
};

const STATUS: Record<string, string> = {
    discovered: 'saved', analyzed: 'saved', drafting: 'drafting', in_progress: 'applying', submitted: 'applied',
    applied: 'applied', in_review: 'in review', interview: 'interviewing', offer: 'offer', rejected: 'rejected',
    ghosted: 'no reply', archived: 'not interested',
};

function cardLines(card: ChatCard, appUrl: string): string[] {
    const base = appUrl.replace(/\/$/, '');
    switch (card.type) {
        case 'scout_run':
            return [`${card.headline || 'Working on it'}: ${base}/scout/${card.runId}`];
        case 'win_draft':
            return [`📝 ${card.title}`, card.narrative].filter(Boolean);
        case 'generation':
            return card.resumeId ? [`📄 Resume for ${card.title}: ${base}/editor/${card.resumeId}`] : [`📄 Resume for ${card.title}`];
        case 'outreach':
            return [card.draft.subject ? `Subject: ${card.draft.subject}` : null, card.draft.body].filter((l): l is string => Boolean(l));
        case 'jobs':
            return card.items.map((job, i) => {
                const verdict = job.verdict && VERDICT[job.verdict] ? ` · ${VERDICT[job.verdict]}` : '';
                return `${i + 1}. ${job.role ?? 'Role'}${job.company ? ` at ${job.company}` : ''} · ${STATUS[job.status] ?? job.status}${verdict}`;
            });
        case 'postings':
            return [
                ...card.items.map((p) => `• ${p.title} · ${p.company}${p.location ? ` · ${p.location}` : ''}${p.pay ? ` · ${p.pay}` : ''}\n  ${p.url}`),
                ...(card.note ? [card.note] : []),
            ];
        case 'record':
            return card.items.map((item) => `• ${item.title}`);
        case 'link':
            return [`${card.label}: ${base}${card.href}`];
    }
}

export function replyToText(reply: { text: string; cards: ChatCard[] }, appUrl: string): string {
    return [reply.text, ...reply.cards.flatMap((card) => cardLines(card, appUrl))].filter(Boolean).join('\n\n');
}
