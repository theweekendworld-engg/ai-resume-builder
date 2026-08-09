import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';

import { aiOpenAI } from '@/lib/aiProvider';
import { resolveTaskModel } from '@/lib/ai/tasks';
import {
    getContactCard,
    getRoleEvidence,
    getSkillsWithEvidence,
    listEducation,
    listProjects,
    listRoles,
} from '@/lib/resume/tools/evidence';

/**
 * Agentic resume assembly.
 *
 * ── Why a loop instead of a pipeline ────────────────────────────────────────
 *
 * The fixed pipeline could not make editorial judgements, and a resume is
 * mostly editorial judgement. Assembled by hand from the same record, four
 * decisions separated a good document from the pipeline's output: true
 * reverse-chronological order, dropping the role summary that restates its own
 * highlights, selecting three of six projects by relevance to the posting
 * rather than by recency, and surfacing the degree in the summary rather than
 * only at the foot. None of those are expressible as a fixed step order,
 * because each depends on what the others found.
 *
 * The pipeline also failed silently. Each stage passed a fixed slice of context
 * to the next, and when one returned something the next did not expect, content
 * vanished with no error — a real account produced a resume with zero roles and
 * nothing anywhere said so. A model that can ask "does this role have usable
 * lines?" and go look catches that; a fixed chain cannot.
 *
 * ── Why this file lives in src/lib/ai/ ──────────────────────────────────────
 *
 * `generateText` may only be called here (rule 2), and the loop is the one
 * legitimate use of it in the codebase: tool calling is not expressible through
 * `generateStructured`, which owns single-shot structured calls. The model id
 * still resolves from the task map (rule 1) and never from a call site.
 *
 * ── The contract with the model ─────────────────────────────────────────────
 *
 * Tools are read-only and none of them can see the job posting. That is
 * deliberate: a retrieval function that could read the posting is a function
 * that could return the posting's wishlist as if it were the candidate's
 * experience, which is the exact failure this product exists to replace.
 * The posting reaches the model only as prose in the prompt, so it can inform
 * SELECTION and never supply CONTENT.
 *
 * The loop ends when the model calls `submit_resume`. Using a tool for the
 * final answer rather than parsing free text means the schema is enforced at
 * the tool boundary and the model retries against a validation error, instead
 * of us regex-hunting JSON out of a paragraph.
 */

const BulletSchema = z.object({
    text: z.string().min(1),
    /**
     * The exact source line this came from. Not decoration — it is what the
     * numeric guard checks against, and requiring it per bullet makes
     * fabrication awkward to express rather than merely forbidden.
     */
    sourceLine: z.string().min(1),
});

const DraftSchema = z.object({
    headline: z.string(),
    summary: z.string(),
    experience: z.array(
        z.object({
            roleId: z.string(),
            company: z.string(),
            role: z.string(),
            startDate: z.string(),
            endDate: z.string(),
            location: z.string(),
            bullets: z.array(BulletSchema),
        }),
    ),
    projects: z.array(
        z.object({
            name: z.string(),
            description: z.string(),
            technologies: z.array(z.string()),
            url: z.string(),
        }),
    ),
    education: z.array(
        z.object({
            institution: z.string(),
            degree: z.string(),
            fieldOfStudy: z.string(),
            startDate: z.string(),
            endDate: z.string(),
        }),
    ),
    skills: z.array(z.object({ group: z.string(), items: z.array(z.string()) })),
    /** Why these roles and projects, in one line. Read by nobody but useful in logs. */
    rationale: z.string(),
});

export type ResumeDraft = z.infer<typeof DraftSchema>;

const SYSTEM = `You assemble a resume from a candidate's verified record.

You have tools that read their record. Call them. Never write a line that is
not traceable to something a tool returned — every bullet must carry the exact
sourceLine it came from, and if you cannot name that line, do not write the
bullet.

WHAT YOU MUST NOT DO
- Do not invent numbers, percentages, scopes, technologies, employers or dates.
- Do not add a skill because the job posting asks for it. The posting tells you
  what to SELECT and EMPHASISE from this candidate's record. It never tells you
  what they know.
- Do not pad. A role with two strong lines gets two bullets, not four.

HOW A GOOD RESUME DIFFERS FROM A DATA DUMP
- Order roles by actual date, most recent first. Stored order is unreliable.
- A role's summary line usually restates its own specifics. Prefer the
  specifics; do not print both.
- Choose projects by relevance to this posting, not by recency. Three strong,
  relevant ones beat six.
- Lead the summary with what makes this candidate credible for THIS role —
  a strong degree, a scale figure, the closest-matching experience.
- Group skills into meaningful categories rather than one long list.
- Cut anything that does not earn its space. One page unless the record and
  the seniority genuinely justify two.

Work in this order: read the posting in the prompt, list the roles, pull the
evidence for the ones that matter, look at projects and skills, then submit.
Call submit_resume exactly once when the document is ready.`;

export type LoopResult = {
    draft: ResumeDraft;
    /** Every tool the model called, in order. The audit trail the pipeline lacked. */
    toolCalls: string[];
    /** Concatenated text of everything the tools returned — the guard's source. */
    evidenceSeen: string;
    steps: number;
};

/** Hard ceiling. Output tokens are ~93% of spend; an unbounded loop is an unbounded bill. */
const MAX_STEPS = 14;

export async function assembleResume(params: {
    userId: string;
    jobDescription: string;
}): Promise<LoopResult> {
    const { userId, jobDescription } = params;

    const toolCalls: string[] = [];
    const evidence: string[] = [];
    let submitted: ResumeDraft | null = null;

    /** Record what the model was actually shown, so the guard can check against it. */
    const seen = <T>(label: string, value: T): T => {
        toolCalls.push(label);
        evidence.push(JSON.stringify(value));
        return value;
    };

    const tools = {
        list_roles: tool({
            description:
                'Every role in the record with dates and how many evidence lines each has. No bullet text. Call this first to plan.',
            inputSchema: z.object({}),
            execute: async () => seen('list_roles', await listRoles(userId)),
        }),
        get_role_evidence: tool({
            description:
                'Every usable source line for one role. Use the id from list_roles.',
            inputSchema: z.object({ roleId: z.string() }),
            execute: async ({ roleId }) =>
                seen(`get_role_evidence(${roleId})`, await getRoleEvidence(userId, roleId)),
        }),
        list_projects: tool({
            description: 'Projects with descriptions, technologies and links.',
            inputSchema: z.object({}),
            execute: async () => seen('list_projects', await listProjects(userId)),
        }),
        list_education: tool({
            description: 'Degrees, institutions and dates.',
            inputSchema: z.object({}),
            execute: async () => seen('list_education', await listEducation(userId)),
        }),
        get_contact_card: tool({
            description:
                "Name, contact details, links, and the candidate's own summary of themselves. The summary is context for you, not copy to reuse verbatim.",
            inputSchema: z.object({}),
            execute: async () => seen('get_contact_card', await getContactCard(userId)),
        }),
        get_skills_with_evidence: tool({
            description:
                'Skills the candidate can evidence, each with where it is demonstrated. A skill absent here cannot go on the resume.',
            inputSchema: z.object({}),
            execute: async () =>
                seen('get_skills_with_evidence', await getSkillsWithEvidence(userId)),
        }),
        submit_resume: tool({
            description:
                'Submit the finished resume. Call exactly once, when the document is complete.',
            inputSchema: DraftSchema,
            execute: async (draft) => {
                submitted = draft as ResumeDraft;
                toolCalls.push('submit_resume');
                return { accepted: true };
            },
        }),
    };

    const result = await generateText({
        model: aiOpenAI(resolveTaskModel('resumeAssemble')),
        system: SYSTEM,
        prompt: `Assemble this candidate's resume for the following posting.\n\n${jobDescription}`,
        tools,
        // The loop terminates on submit_resume; this is the backstop for a model
        // that never gets there.
        stopWhen: stepCountIs(MAX_STEPS),
    });

    if (!submitted) {
        // Distinct from a schema failure. The model ran out of steps, or decided
        // it could not produce a document — either way there is no draft, and
        // returning a half-empty one is how the pipeline shipped blank resumes.
        throw new Error(
            `Assembly finished without submitting a resume after ${result.steps.length} steps. Tools called: ${toolCalls.join(', ') || 'none'}`,
        );
    }

    return {
        draft: submitted,
        toolCalls,
        evidenceSeen: evidence.join('\n'),
        steps: result.steps.length,
    };
}
