/**
 * Revising a stored draft to one instruction ("make it shorter", "add IIT
 * Delhi"). The model EDITS the previous version; it is not asked to write a
 * new message, which is what made "shorter" come back as a different email.
 *
 * Code holds everything that must be true:
 *   - Numbers: the numeric guard over exactly what the model was shown that
 *     can source a fact (the previous version, the evidence lines, and the
 *     instruction itself). A revision the guard had to strip is REJECTED, not
 *     saved degraded: the previous version stands and the user is told why.
 *   - Length and clichés: the outreach checks (`checkDraft`), one corrective
 *     retry, then `enforceLimits`. The same limits as the first draft.
 *   - Evidence: `loadShareableEvidence`, the rule-3 query, chosen by the caller.
 */

import { z } from 'zod';
import { generateStructured } from '@/lib/ai/structured';
import { checkDraft, enforceLimits, FORMAT_RULES, isSignOffBlock, splitSignOff, type EvidenceLine } from '@/lib/scout/outreach';
import type { DraftFormat } from '@/lib/scout/types';

export { REVISION_INSTRUCTIONS } from '@/lib/drafts/revisions';

/** An instruction longer than this is a paste, not an edit. */
export const MAX_INSTRUCTION_CHARS = 1_000;

const RevisionSchema = z.object({
    subject: z.string().max(200).nullable(),
    body: z.string().min(1).max(3000),
});

export const REVISE_SYSTEM = `You edit a message draft that the sender will send themselves. You get the current draft and one instruction from the sender. Apply the instruction and leave everything else alone.

Rules:
- EDIT, do not rewrite. Keep every sentence the instruction does not touch exactly as written, in the same order. Adding one fact adds one clause or one sentence; it does not rephrase the rest.
- Tone and length instructions ("shorter", "stronger", "warmer") apply to the whole draft, but keep its facts, its ask and its sign-off.
- Facts about the sender come ONLY from the current draft, the SENDER EVIDENCE lines, and the instruction itself. Never invent employers, schools, degrees, projects, skills, dates, metrics or numbers.
- When the instruction states a fact about the sender ("add that I went to IIT Delhi"), use it exactly as stated.
- Keep the subject unless the instruction is about the subject. For LinkedIn formats subject is null.
- Keep the paragraph breaks (blank lines) as they are. The sign-off stays its own paragraph after a blank line.
- No emojis, no exclamation marks, no bullet points, no placeholders like [Name].
- Return JSON: {"subject": string | null, "body": string}.`;

export function buildRevisePrompt(params: {
    format: DraftFormat;
    previous: { subject: string | null; body: string; version: number };
    instruction: string;
    evidence: EvidenceLine[];
}): string {
    return [
        `FORMAT: ${FORMAT_RULES[params.format]}`,
        `CURRENT DRAFT (version ${params.previous.version}):\nSubject: ${params.previous.subject ?? '(none)'}\n"""\n${params.previous.body}\n"""`,
        `INSTRUCTION (from the sender, verbatim):\n"""\n${params.instruction}\n"""`,
        `SENDER EVIDENCE (the only facts you may add about the sender):\n${params.evidence.map((line) => `- ${line.text} [${line.source}]`).join('\n') || '- (none recorded)'}`,
    ].join('\n\n');
}

/** "Sign it as Jai Shankar", "drop my name": an instruction about the sign-off itself. */
const ABOUT_SIGN_OFF = /\b(?:sign(?:ed|ing|-?off)?|signature|name at the end|closing)\b/i;

/**
 * The sign-off stays its own paragraph. Version 1 ended "…makes sense.\n\nJai";
 * a revision ("add that I graduated from IIT Delhi") came back
 * "…makes sense.\nJai", the name glued to the paragraph above (live test
 * 2026-11-08). Code puts the blank line back; and when an email revision
 * dropped the sign-off entirely, and the instruction was not about it, the
 * previous one is restored.
 */
export function keepSignOffParagraph(previousBody: string, nextBody: string, instruction: string, format: DraftFormat): string {
    const before = splitSignOff(previousBody).signOff;
    const next = nextBody.trim();
    if (!before || splitSignOff(next).signOff) return next;

    const want = before.split('\n').map((line) => line.trim());
    const firstNameOf = (line: string) => line.toLowerCase().split(/\s+/)[0] ?? '';
    const name = firstNameOf(want[want.length - 1]);
    const lines = next.split('\n');
    // The sign-off's lines at the very end, attached by a single newline.
    for (let k = Math.min(want.length + 1, 3, lines.length - 1); k >= 1; k -= 1) {
        const tail = lines.slice(-k).map((line) => line.trim());
        if (!isSignOffBlock(tail) || firstNameOf(tail[tail.length - 1]) !== name) continue;
        const main = lines.slice(0, -k).join('\n').trimEnd();
        if (main) return `${main}\n\n${tail.join('\n')}`;
    }
    if (format === 'email' && !ABOUT_SIGN_OFF.test(instruction) && !next.toLowerCase().includes(name)) {
        return `${next}\n\n${before}`;
    }
    return next;
}

export type ReviseOutcome =
    | { ok: true; subject: string | null; body: string; costUsd: number }
    /** `guard`: the model would only make the change with a number no source has. */
    | { ok: false; reason: 'guard' | 'empty'; costUsd: number };

export async function reviseDraftText(params: {
    userId: string;
    /** Charged to the run in ApiUsageLog when the draft has one. */
    sessionId?: string | null;
    format: DraftFormat;
    previous: { subject: string | null; body: string; version: number };
    instruction: string;
    evidence: EvidenceLine[];
}): Promise<ReviseOutcome> {
    const instruction = params.instruction.trim().slice(0, MAX_INSTRUCTION_CHARS);
    const sourceText = [
        params.previous.subject ?? '',
        params.previous.body,
        params.evidence.map((line) => line.text).join('\n'),
        instruction,
    ].join('\n\n');
    const basePrompt = buildRevisePrompt({ ...params, instruction });

    let costUsd = 0;
    const call = async (prompt: string) => {
        const result = await generateStructured({
            task: 'draftRevise',
            feature: 'outreach',
            userId: params.userId,
            ...(params.sessionId ? { sessionId: params.sessionId } : {}),
            schema: RevisionSchema,
            system: REVISE_SYSTEM,
            prompt,
            guard: { sourceText, fields: ['subject', 'body'] },
        });
        costUsd += result.usage.costUsd;
        return { draft: result.data, degraded: result.degraded };
    };

    let output = await call(basePrompt);
    const violations = checkDraft(params.format, output.draft);
    if (violations.length) {
        // One corrective pass, naming exactly what was wrong (as outreach does).
        const retry = await call(`${basePrompt}\n\nYOUR PREVIOUS EDIT:\n${JSON.stringify(output.draft)}\n\nFix these problems and return the corrected JSON:\n${violations.map((v) => `- ${v.detail}`).join('\n')}`)
            .catch(() => null);
        if (retry && (!retry.degraded || output.degraded) && checkDraft(params.format, retry.draft).length <= violations.length) output = retry;
    }

    // Fail closed: a stripped field means the model reached for a figure no
    // source has. Saving the stripped text would silently drop the subject or
    // the whole body; keeping the previous version is the honest outcome.
    if (output.degraded) return { ok: false, reason: 'guard', costUsd };

    const final = enforceLimits(params.format, { ...output.draft, body: keepSignOffParagraph(params.previous.body, output.draft.body, instruction, params.format) });
    if (!final.body.trim()) return { ok: false, reason: 'empty', costUsd };
    if (params.format === 'email' && !final.subject && params.previous.subject) {
        final.subject = params.previous.subject;
    }
    return { ok: true, subject: final.subject, body: final.body, costUsd };
}
