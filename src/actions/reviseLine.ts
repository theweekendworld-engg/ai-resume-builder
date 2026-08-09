'use server';

/**
 * Revise one line of a resume, on instruction, without rebuilding the document.
 *
 * ── Why this exists instead of "regenerate" ─────────────────────────────────
 *
 * The editor's copilot rebuilt the whole resume from the posting every time
 * somebody wanted one bullet sharpened. Three things were wrong with that.
 *
 * It cost the full document: ~8,700 input and ~14,300 output tokens measured,
 * to change forty words. A revision sends the line, its evidence and the
 * instruction — a few hundred tokens in, well under a hundred out. Roughly two
 * orders of magnitude, and output is ~93% of the bill.
 *
 * It changed things nobody asked about. A user who liked their summary and
 * wanted one bullet tightened got a new summary too, and had no way to keep
 * half of the result. Editing is not generating.
 *
 * And it was slow enough to break the loop of working on a document — ~26s for
 * a change you wanted to see and react to.
 *
 * ── What it does NOT do ─────────────────────────────────────────────────────
 *
 * It does not write. The proposal comes back and the editor applies it if the
 * user accepts, so a revision they dislike costs them nothing to discard. And
 * it cannot introduce a fact: the guard checks the rewrite against the same
 * evidence lines the original bullet came from, so "add a metric" gets a
 * refusal rather than an invention when no metric exists.
 */

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';

import { err, ok, type Result } from '@/lib/result';
import { prisma } from '@/lib/prisma';
import { generateStructured } from '@/lib/ai/structured';
import { getRoleEvidence } from '@/lib/resume/tools/evidence';
import { track } from '@/lib/track';

const InputSchema = z.object({
    resumeId: z.string().min(1),
    /** The experience row the line belongs to. Scopes the evidence we send. */
    roleId: z.string().min(1),
    /** The line as it currently reads on the page. */
    line: z.string().min(1).max(600),
    /** What the user asked for, in their words. */
    instruction: z.string().min(2).max(300),
});

const RevisionSchema = z.object({
    /** The rewritten line. Equal to the input when nothing should change. */
    text: z.string(),
    /**
     * False when the instruction cannot be honoured from the evidence — asking
     * for a number that was never recorded, say. Saying so is the correct
     * answer and is far better than inventing one to look useful.
     */
    changed: z.boolean(),
    /** One short sentence the editor shows beneath the suggestion. */
    note: z.string(),
});

export type LineRevision = z.infer<typeof RevisionSchema>;

const SYSTEM = `You revise a single line of a resume on instruction.

You are given the line, the candidate's own source material for the role it sits
in, the other lines already on that role, and what the user asked for.

Return the revised line and nothing else — no preamble, no alternatives.

Rules that do not bend:
- Every fact in your revision must appear in the source material. If the
  instruction asks for something the source cannot support — a metric that was
  never recorded, a technology never mentioned — set changed to false, leave the
  text as it was, and say so plainly in the note. Refusing is the right answer.
- Do not repeat a point another line on this role already makes.
- Keep it one line. A resume bullet is one line.
- If the line is already right, set changed to false rather than rewriting it
  to look busy.`;

export async function reviseLine(input: unknown): Promise<Result<LineRevision>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
        return err(parsed.error.issues[0]?.message ?? 'Invalid request', 'invalid_input');
    }
    const { resumeId, roleId, line, instruction } = parsed.data;

    // Ownership, cheaply. The resume is not read — only proven to be theirs.
    const owns = await prisma.resume.findFirst({
        where: { id: resumeId, userId },
        select: { id: true },
    });
    if (!owns) return err('Resume not found', 'not_found');

    const evidence = await getRoleEvidence(userId, roleId);
    if (!evidence) return err('That role is no longer in your record', 'not_found');

    // Everything the model sees, and the exact text the guard checks against.
    // Scoped to one role deliberately: it is what makes this cheap, and a line
    // has no business drawing on a job it does not belong to.
    const sourceText = evidence.lines.join('\n');

    const siblings = evidence.lines.filter((entry) => entry.trim() !== line.trim());

    const { data } = await generateStructured({
        task: 'bulletWrite',
        feature: 'resume',
        userId,
        schema: RevisionSchema,
        system: SYSTEM,
        prompt: [
            `THE LINE:\n${line}`,
            '',
            `SOURCE MATERIAL for ${evidence.role} at ${evidence.company}:\n${sourceText}`,
            '',
            siblings.length ? `ALREADY ON THIS ROLE:\n${siblings.join('\n')}` : '',
            '',
            `THE USER ASKED:\n${instruction}`,
        ]
            .filter(Boolean)
            .join('\n'),
        guard: { sourceText, fields: ['text'] },
    });

    await track(userId, 'resume_regenerated', {
        feature: 'resume',
        path: 'revise_line',
        changed: data.changed,
        instructionChars: instruction.length,
    });

    // A guard strike blanks the field rather than failing the call, so an empty
    // rewrite means the model reached past its evidence. Return the original.
    if (!data.text.trim()) {
        return ok({
            text: line,
            changed: false,
            note: 'That would have needed something your record does not contain, so the line is unchanged.',
        });
    }

    return ok(data);
}
