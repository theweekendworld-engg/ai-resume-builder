/**
 * Outreach drafts: a referral ask, a recruiter note, a cold email.
 *
 * An outreach message is an EXTERNAL artifact — it leaves the building under
 * the user's name — so CLAUDE.md rule 3 applies in full. The user's evidence
 * is read by `loadShareableEvidence`, whose Win query is composed from
 * `externalRetrievalFilter` (confirmed + shareable, in SQL). The model is never
 * told to skip anything; it is simply never shown anything it could leak.
 *
 * The rest of the discipline is in code, not in the prompt:
 *   - Numbers: the numeric guard, against exactly the evidence and posting
 *     text the model was shown.
 *   - Length: LinkedIn connection notes are capped at 300 characters by
 *     LinkedIn itself; a longer draft is not a worse draft, it is one that
 *     cannot be sent. Enforced after generation — one corrective retry, then a
 *     trim at a sentence boundary.
 *   - Clichés: a banned-phrase check with the same one retry. "I hope this
 *     finds you well" is the tell that a message was not written for its reader.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { generateStructured } from '@/lib/ai/structured';
import { loadRun, readSections } from '@/lib/agent/run';
import { externalRetrievalFilter } from '@/lib/graph/visibility';
import { prisma } from '@/lib/prisma';
import {
    LINKEDIN_NOTE_MAX,
    type DraftFormat,
    type DraftTarget,
    type FitData,
    type IngestData,
    type JdData,
    type NetworkData,
    type OutreachDraft,
} from '@/lib/scout/types';

// ───────────────────────────────────────────────────────────────── limits

export const LINKEDIN_MESSAGE_MAX = 600;
export const EMAIL_SUBJECT_MAX = 70;
export const EMAIL_BODY_MAX_WORDS = 120;

export const BANNED_PHRASES = [
    'hope this finds you well',
    'hope you are doing well',
    "hope you're doing well",
    'came across your profile',
    'i stumbled upon',
    'passionate',
    'i am writing to',
    'reaching out to express',
    'dream company',
    'amazing opportunity',
    'i would be a great fit',
    'perfect fit',
    'synergy',
    'to whom it may concern',
] as const;

export function wordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

export type DraftViolation = { kind: 'too_long' | 'cliche' | 'subject_too_long'; detail: string };

export function checkDraft(format: DraftFormat, draft: { subject: string | null; body: string }): DraftViolation[] {
    const violations: DraftViolation[] = [];
    const body = draft.body.trim();
    if (format === 'linkedin_note' && body.length > LINKEDIN_NOTE_MAX) {
        violations.push({ kind: 'too_long', detail: `${body.length} characters; a LinkedIn connection note allows ${LINKEDIN_NOTE_MAX}` });
    }
    if (format === 'linkedin_message' && body.length > LINKEDIN_MESSAGE_MAX) {
        violations.push({ kind: 'too_long', detail: `${body.length} characters; keep it under ${LINKEDIN_MESSAGE_MAX}` });
    }
    if (format === 'email') {
        const words = wordCount(body);
        if (words > EMAIL_BODY_MAX_WORDS) violations.push({ kind: 'too_long', detail: `${words} words; keep the email under ${EMAIL_BODY_MAX_WORDS}` });
        if ((draft.subject ?? '').length > EMAIL_SUBJECT_MAX) {
            violations.push({ kind: 'subject_too_long', detail: `subject is ${(draft.subject ?? '').length} characters; keep it under ${EMAIL_SUBJECT_MAX}` });
        }
    }
    const lower = body.toLowerCase();
    for (const phrase of BANNED_PHRASES) {
        if (lower.includes(phrase)) violations.push({ kind: 'cliche', detail: `contains "${phrase}"` });
    }
    return violations;
}

/** Cut to `max` characters at the last sentence end that fits, else a word. */
export function trimToSentence(text: string, max: number): string {
    const clean = text.trim();
    if (clean.length <= max) return clean;
    const window = clean.slice(0, max);
    const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
    if (lastStop >= max * 0.5) return window.slice(0, lastStop + 1).trim();
    const lastSpace = window.lastIndexOf(' ');
    return `${window.slice(0, lastSpace > 0 ? lastSpace : max - 1).trim().replace(/[,;:]$/, '')}…`;
}

/** Drop whole words past the limit, ending on a sentence where possible. */
export function trimToWords(text: string, maxWords: number): string {
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text.trim();
    const cut = words.slice(0, maxWords).join(' ');
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '), cut.endsWith('.') ? cut.length - 1 : -1);
    return lastStop >= cut.length * 0.5 ? cut.slice(0, lastStop + 1).trim() : `${cut}…`;
}

/** Remove sentences containing a banned phrase, unless that empties the draft. */
function stripCliches(body: string): string {
    const sentences = body.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((sentence) => !BANNED_PHRASES.some((phrase) => sentence.toLowerCase().includes(phrase)));
    return kept.length ? kept.join(' ').trim() : body.trim();
}

export function enforceLimits(format: DraftFormat, draft: { subject: string | null; body: string }): { subject: string | null; body: string } {
    let body = stripCliches(draft.body);
    let subject = draft.subject?.trim() || null;
    if (format === 'linkedin_note') body = trimToSentence(body, LINKEDIN_NOTE_MAX);
    if (format === 'linkedin_message') body = trimToSentence(body, LINKEDIN_MESSAGE_MAX);
    if (format === 'email') {
        body = trimToWords(body, EMAIL_BODY_MAX_WORDS);
        if (subject && subject.length > EMAIL_SUBJECT_MAX) subject = trimToSentence(subject, EMAIL_SUBJECT_MAX).replace(/…$/, '');
    } else {
        subject = null;
    }
    return { subject, body };
}

// ─────────────────────────────────────────────────────────────── evidence

/**
 * The Win query outreach reads. Exported so the thesis-style test can assert
 * the filter itself, not the absence of a word in generated text.
 */
export function outreachWinWhere(userId: string) {
    return externalRetrievalFilter(userId);
}

export type EvidenceLine = { text: string; source: string };

/**
 * Everything outreach may quote about the user.
 *
 * Wins through the external filter (rule 3). Roles and projects are the
 * user's resume record — the same rows every resume they send is built from —
 * and carry no sensitivity field, so they are shareable by construction.
 */
export async function loadShareableEvidence(userId: string): Promise<EvidenceLine[]> {
    const [wins, roles, projects] = await Promise.all([
        prisma.win.findMany({
            where: outreachWinWhere(userId),
            orderBy: { occurredAt: 'desc' },
            take: 40,
            select: { title: true, narrative: true },
        }),
        prisma.userExperience.findMany({
            where: { userId },
            select: { company: true, role: true, current: true, highlights: true, description: true },
        }),
        prisma.userProject.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
            take: 10,
            select: { name: true, description: true, technologies: true },
        }),
    ]);

    const lines: EvidenceLine[] = [];
    for (const role of roles) {
        const where = `${role.role} at ${role.company}${role.current ? ' (current)' : ''}`;
        lines.push({ text: where, source: where });
        const highlights = Array.isArray(role.highlights) ? (role.highlights as unknown[]).filter((h): h is string => typeof h === 'string') : [];
        for (const line of highlights.length ? highlights : [role.description]) {
            if (line?.trim()) lines.push({ text: line.trim(), source: where });
        }
    }
    for (const win of wins) {
        lines.push({ text: win.narrative?.trim() ? `${win.title}. ${win.narrative.trim()}` : win.title, source: 'Work log' });
    }
    for (const project of projects) {
        const tech = Array.isArray(project.technologies) ? (project.technologies as string[]).join(', ') : '';
        lines.push({ text: `${project.name}: ${project.description}${tech ? ` (${tech})` : ''}`.trim(), source: `Project: ${project.name}` });
    }
    return lines;
}

function tokens(text: string): Set<string> {
    return new Set(text.toLowerCase().replace(/[^a-z0-9+#.\s]+/g, ' ').split(/\s+/).filter((token) => token.length >= 3));
}

/** The lines most relevant to this role, so the prompt stays small and specific. */
export function selectEvidence(lines: EvidenceLine[], jd: JdData | null, limit = 10): EvidenceLine[] {
    if (!jd) return lines.slice(0, limit);
    const wanted = tokens([jd.role, jd.domain, ...jd.skills, ...jd.requirements.map((r) => r.text)].join(' '));
    return lines
        .map((line, index) => {
            const overlap = [...tokens(line.text)].filter((token) => wanted.has(token)).length;
            return { line, score: overlap, index };
        })
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, limit)
        .map((entry) => entry.line);
}

// ──────────────────────────────────────────────────────────────── prompt

const DraftSchema = z.object({
    subject: z.string().max(200).nullable(),
    body: z.string().min(1).max(3000),
});

const FORMAT_RULES: Record<DraftFormat, string> = {
    linkedin_note: `A LinkedIn connection-request note. HARD LIMIT ${LINKEDIN_NOTE_MAX} characters including spaces — aim for 220. Two or three short sentences. subject must be null.`,
    linkedin_message: `A LinkedIn direct message. Under ${LINKEDIN_MESSAGE_MAX} characters. Three to five short sentences. subject must be null.`,
    email: `A short email. Subject line under ${EMAIL_SUBJECT_MAX} characters, specific (the role, not "Opportunity"). Body under ${EMAIL_BODY_MAX_WORDS} words, three short paragraphs at most, signed with the sender's first name.`,
};

const TARGET_ASK: Record<DraftTarget, string> = {
    poster: 'They posted about this role. Respond to the post directly and ask the next step (to be considered, or who to send a resume to).',
    recruiter: 'They recruit at the company. Ask to be considered for this role, and whether a short call makes sense.',
    hiring_manager: 'They likely lead or sit on the hiring team. Ask for a 15-minute chat about the team, not for a job.',
    referral: 'They work at the company. Ask whether they would be comfortable referring you for this specific role, and offer to send a resume and a two-line blurb to make it easy.',
    alumni: 'You share a school or past employer. Name that link plainly, then ask for 15 minutes about their experience of the team.',
};

const SYSTEM = `You write outreach messages a thoughtful senior engineer would actually send. They get replies because they are short, specific and easy to say yes to.

Rules:
- One concrete overlap between the sender's real work and this role. Use ONLY the SENDER EVIDENCE lines; never invent projects, employers, skills, metrics, dates or numbers.
- One small, clear ask. Never ask for more than one thing.
- No flattery and no filler: never "I hope this finds you well", "I came across your profile", "passionate", "dream company", "perfect fit", "amazing opportunity".
- No invented familiarity. Do not claim to have met, followed or admired the recipient, or to know their work, unless the brief says so.
- Plain, warm, direct. Short sentences. No emojis, no exclamation marks, no bullet points.
- If the recipient's name is unknown, open with "Hi," — do not use placeholders like [Name].
- Return JSON: {"subject": string | null, "body": string}.`;

function buildPrompt(params: {
    format: DraftFormat;
    target: DraftTarget;
    recipient: { name: string | null; position: string | null; company: string | null; why: string | null };
    sender: { name: string };
    jd: JdData | null;
    ingest: IngestData | null;
    fit: FitData | null;
    evidence: EvidenceLine[];
    note: string | null;
}): string {
    const { jd } = params;
    const role = jd ? `${jd.role}${jd.company ? ` at ${jd.company}` : ''}` : params.ingest?.title ?? 'the role';
    return [
        `FORMAT: ${FORMAT_RULES[params.format]}`,
        `ASK: ${TARGET_ASK[params.target]}`,
        `ROLE: ${role}${jd?.location ? ` (${jd.location})` : ''}`,
        jd?.requirements.length ? `WHAT THE ROLE NEEDS:\n${jd.requirements.filter((r) => r.kind !== 'nice').slice(0, 6).map((r) => `- ${r.text}`).join('\n')}` : '',
        `RECIPIENT: ${params.recipient.name ?? 'unknown name'}${params.recipient.position ? `, ${params.recipient.position}` : ''}${params.recipient.company ? ` at ${params.recipient.company}` : ''}${params.recipient.why ? ` — ${params.recipient.why}` : ''}`,
        params.target === 'poster' && params.ingest?.text ? `THEIR POST (for context, do not quote at length):\n"""${params.ingest.text.slice(0, 1200)}"""` : '',
        `SENDER: ${params.sender.name || 'the candidate'}`,
        `SENDER EVIDENCE (the only facts you may use about the sender):\n${params.evidence.map((line) => `- ${line.text} [${line.source}]`).join('\n') || '- (none recorded)'}`,
        params.fit?.matched.length ? `STRONGEST MATCHES:\n${params.fit.matched.slice(0, 3).map((m) => `- ${m.text} ← ${m.evidence}`).join('\n')}` : '',
        params.note ? `SENDER'S OWN STEER: ${params.note}` : '',
    ].filter(Boolean).join('\n\n');
}

// ───────────────────────────────────────────────────────────── generation

export type GenerateOutreachParams = {
    userId: string;
    runId: string;
    target: DraftTarget;
    format: DraftFormat;
    contactId?: string | null;
    note?: string | null;
};

export async function generateOutreachDraft(params: GenerateOutreachParams): Promise<{ draft: OutreachDraft; costUsd: number }> {
    const run = await loadRun(params.runId);
    if (!run || run.userId !== params.userId) throw new Error('Run not found');
    const sections = readSections(run);
    const data = <T>(name: string): T | null => {
        const section = sections[name];
        if (!section) return null;
        if (section.status === 'ok') return section.data as T;
        if ((section.status === 'unavailable' || section.status === 'needs_input') && section.data) return section.data as T;
        return null;
    };
    const jd = data<JdData>('jd');
    const ingest = data<IngestData>('ingest');
    const fit = data<FitData>('fit');
    const network = data<NetworkData>('network');

    // Recipient: a chosen contact (must be the user's own), else the poster.
    let recipient: { name: string | null; position: string | null; company: string | null; why: string | null } = {
        name: null,
        position: null,
        company: jd?.company ?? null,
        why: null,
    };
    if (params.contactId) {
        const contact = await prisma.contact.findFirst({ where: { id: params.contactId, userId: params.userId } });
        if (!contact) throw new Error('Contact not found');
        const target = network?.targets.find((t) => t.contactId === contact.id);
        recipient = { name: contact.fullName, position: contact.position, company: contact.company, why: target?.why ?? null };
    } else if (params.target === 'poster') {
        const poster = network?.targets.find((t) => t.tier === 'poster');
        recipient = {
            name: poster?.fullName ?? ingest?.author ?? null,
            position: poster?.position ?? null,
            company: poster?.company ?? jd?.company ?? null,
            why: 'Wrote the post about this role',
        };
    }

    const profile = await prisma.userProfile.findUnique({ where: { userId: params.userId }, select: { fullName: true } });
    const evidence = selectEvidence(await loadShareableEvidence(params.userId), jd);

    const sourceText = [
        evidence.map((line) => line.text).join('\n'),
        jd ? [jd.role, jd.company, jd.location ?? '', ...jd.requirements.map((r) => r.text)].join('\n') : '',
        ingest?.text ?? '',
        params.note ?? '',
    ].join('\n\n');

    const basePrompt = buildPrompt({
        format: params.format,
        target: params.target,
        recipient,
        sender: { name: profile?.fullName?.trim() ?? '' },
        jd,
        ingest,
        fit,
        evidence,
        note: params.note?.trim() || null,
    });

    let costUsd = 0;
    const call = async (prompt: string) => {
        const result = await generateStructured({
            task: 'outreachDraft',
            feature: 'outreach',
            userId: params.userId,
            sessionId: params.runId,
            schema: DraftSchema,
            system: SYSTEM,
            prompt,
            guard: { sourceText, fields: ['subject', 'body'] },
        });
        costUsd += result.usage.costUsd;
        return result.data;
    };

    let output = await call(basePrompt);
    const violations = checkDraft(params.format, output);
    if (violations.length) {
        // One corrective pass, naming exactly what was wrong.
        const retry = await call(`${basePrompt}\n\nYOUR PREVIOUS DRAFT:\n${JSON.stringify(output)}\n\nFix these problems and return the corrected JSON:\n${violations.map((v) => `- ${v.detail}`).join('\n')}`)
            .catch(() => null);
        if (retry && checkDraft(params.format, retry).length <= violations.length) output = retry;
    }
    const final = enforceLimits(params.format, output);

    return {
        draft: {
            id: randomUUID(),
            target: params.target,
            format: params.format,
            recipientName: recipient.name,
            subject: final.subject,
            body: final.body,
            createdAt: new Date().toISOString(),
        },
        costUsd,
    };
}
