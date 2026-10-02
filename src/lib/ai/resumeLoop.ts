import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';

import { aiOpenAI } from '@/lib/aiProvider';
import { resolveTaskModel } from '@/lib/ai/tasks';
import { sourceWasSeen } from '@/lib/resume/fromDraft';
import { calculateOpenAiCostUsd, enforceUsageLimit, logUsageEvent } from '@/lib/usageTracker';
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
     * Ids of the posting requirements this line answers, from the list in the
     * prompt. Empty is normal — plenty of good lines answer nothing specific.
     *
     * This is the model's own selection reasoning, captured rather than
     * re-derived. It already decided this bullet was worth space BECAUSE it
     * addresses something the employer asked for; a text matcher run afterwards
     * would be guessing at a judgement we could simply have asked for.
     */
    answers: z.array(z.string()),
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

/**
 * The prompt states the outcome and the constraints. It does not state a
 * procedure.
 *
 * An earlier version ended with "Work in this order: list the roles, pull the
 * evidence, then submit" — which is a fixed pipeline again, written in English
 * and enforced by nothing. If the right sequence were knowable in advance there
 * would be no reason to run a loop at all.
 *
 * So: here is what a good resume is, here is what may never happen, here are
 * the tools. Which to call, in what order, and when there is enough — that is
 * the judgement being bought, and prescribing it throws the purchase away.
 */
const SYSTEM = `You write a candidate's resume for a specific job posting.

WHAT A GREAT RESUME IS
A hiring manager skims it in fifteen seconds and concludes "this person has
done the thing we need". Every line earns its space. The order tells a story
that lands — the most relevant, most recent, most credible evidence first, with
the strongest reason to believe visible immediately. Nothing on it is padding,
and nothing on it is a claim the candidate could not defend in an interview.

Length is a cost, not a budget to spend. Including a weak item does not add to
a resume, it subtracts from everything beside it: three sharp, relevant
projects read as focus, and the same three plus two minor ones read as noise.
A role with two strong lines gets two bullets. Cut anything that does not earn
its space, and prefer one page unless the record genuinely fills two.

THE ONE RULE THAT CANNOT BEND
Everything you write traces to something a tool returned. Every bullet carries
the exact sourceLine it came from; if you cannot name that line, do not write
the bullet. Never invent a number, percentage, scope, technology, employer or
date. And never add something because the posting asks for it — the posting
tells you what to SELECT and EMPHASISE from this record, never what this person
knows. A resume that claims what the employer wants to hear is the failure this
exists to prevent. Declining to claim something is always the right call.

PROJECTS ARE WRITTEN, NOT PASTED
A project's stored description is often an imported README. It may list
directory structure, file paths, "Tech stack:" lines and marketing prose. None
of that belongs on a resume. Rewrite each project as one or two sentences
saying what it does and what is impressive about it. And technologies means
what the project is built WITH — Dockerfile, Shell and CSS are file types
GitHub counted, not skills a person claims.

WHAT YOU HAVE
Tools that read the candidate's verified record. None of them can see the
posting; that is deliberate. Use as many or as few as the document needs.

You decide what to gather, in what order, and when you have enough. When the
document is right, call submit_resume once.`;

export type LoopResult = {
    draft: ResumeDraft;
    /** Every tool the model called, in order. The audit trail the pipeline lacked. */
    toolCalls: string[];
    /** Concatenated text of everything the tools returned — the guard's source. */
    evidenceSeen: string;
    steps: number;
};

export type Assembler = (params: {
    userId: string;
    jobDescription: string;
}) => Promise<LoopResult>;

let assembler: Assembler | null = null;

/**
 * Test seam, mirroring `structured.ts` → `setObjectRunner`.
 *
 * The loop drives the model through `generateText` with tools, which the
 * structured-call mock cannot intercept — it injects at `generateObject`. Every
 * suite that generates a resume would otherwise reach for a real API key and
 * hang. Injecting the whole assembly rather than the transport is deliberate:
 * what tests need to control is which document comes back, not how many
 * round trips produced it.
 */
export const __testing = {
    setAssembler(next: Assembler | null) {
        assembler = next;
    },
    reset() {
        assembler = null;
    },
};

const MAX_REJECTIONS = 2;

/** What the guard would drop, said in time for the model to fix it. Pure. */
export function submissionProblems(draft: ResumeDraft, evidenceSeen: string): string[] {
    const problems: string[] = [];
    for (const role of draft.experience) {
        if (role.bullets.length === 0) problems.push(`${role.role} at ${role.company} has no bullets; drop the role or add lines from its evidence.`);
        for (const bullet of role.bullets) {
            if (!sourceWasSeen(bullet.sourceLine, evidenceSeen)) {
                problems.push(`The sourceLine for "${bullet.text.slice(0, 60)}" is not in the evidence you were given.`);
            }
        }
    }
    if (draft.experience.length === 0) problems.push('There are no roles. Call list_roles and get_role_evidence, then include the relevant ones.');
    return problems.slice(0, 12);
}

/** Hard ceiling. Output tokens are ~93% of spend; an unbounded loop is an unbounded bill. */
const MAX_STEPS = 14;
/** The whole loop; the generation function's own limit is 300s. */
const LOOP_TIMEOUT_MS = 180_000;

export async function assembleResume(params: {
    userId: string;
    jobDescription: string;
    /**
     * The posting's requirements, already parsed, so bullets can be tagged with
     * what they answer. Passing them as data does not weaken the rule that
     * tools cannot see the posting: the model already has the posting as prose,
     * so this adds ids, not information.
     */
    requirements?: readonly { id: string; text: string }[];
}): Promise<LoopResult> {
    const { userId, jobDescription, requirements } = params;
    if (assembler) return assembler({ userId, jobDescription });
    // The most expensive call in the product, so it carries the monthly
    // backstop and its own usage row; it had neither (launch audit 2026-10-02).
    await enforceUsageLimit(userId);
    const model = resolveTaskModel('resumeAssemble');
    const startedAt = Date.now();

    const toolCalls: string[] = [];
    const evidence: string[] = [];
    let submitted: ResumeDraft | null = null;
    let rejections = 0;

    /** Record what the model was actually shown, so the guard can check against it. */
    const seen = <T>(label: string, value: T): T => {
        toolCalls.push(label);
        evidence.push(JSON.stringify(value));
        return value;
    };

    const tools = {
        list_roles: tool({
            description:
                'Every role in the record with dates and how many evidence lines each has. No bullet text — cheap enough to survey a whole career before pulling any of it.',
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
                toolCalls.push('submit_resume');
                // Say what is wrong, so the model can fix it inside its step
                // budget, instead of always answering "accepted" and leaving
                // the guard to throw the lines away afterwards (audit
                // 2026-10-02). Bounded: after two rejections it is accepted
                // and the guard does the rest.
                const problems = submissionProblems(draft as ResumeDraft, evidence.join('\n'));
                if (problems.length > 0 && rejections < MAX_REJECTIONS) {
                    rejections += 1;
                    return { accepted: false, problems, instruction: 'Fix these and call submit_resume again. Copy each sourceLine exactly from what get_role_evidence returned.' };
                }
                submitted = draft as ResumeDraft;
                return { accepted: true };
            },
        }),
    };

    const logLoop = async (status: 'success' | 'failed', usage: { inputTokens?: number; outputTokens?: number } | undefined, steps: number) => {
        const inputTokens = usage?.inputTokens ?? 0;
        const outputTokens = usage?.outputTokens ?? 0;
        await logUsageEvent({
            userId,
            operation: 'ai.resumeAssemble',
            provider: 'openai',
            model,
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            costUsd: calculateOpenAiCostUsd({ model, inputTokens, outputTokens }),
            latencyMs: Date.now() - startedAt,
            status,
            metadata: { feature: 'resume', steps, toolCalls: toolCalls.length },
        }).catch(() => undefined);
    };

    let outcome: { usage: { inputTokens?: number; outputTokens?: number } | undefined; steps: number };
    try {
        const result = await generateText({
        model: aiOpenAI(model),
        abortSignal: AbortSignal.timeout(LOOP_TIMEOUT_MS),
        system: SYSTEM,
        prompt: [
            "Assemble this candidate's resume for the following posting.",
            '',
            jobDescription,
            ...(requirements?.length
                ? [
                      '',
                      'REQUIREMENTS, with the ids to use in each bullet\'s `answers`:',
                      ...requirements.map((r) => `${r.id}: ${r.text}`),
                  ]
                : []),
        ].join('\n'),
        tools,
        // The loop terminates on submit_resume; this is the backstop for a model
        // that never gets there.
        stopWhen: stepCountIs(MAX_STEPS),
        });
        outcome = { usage: result.totalUsage, steps: result.steps.length };
    } catch (error) {
        await logLoop('failed', undefined, 0);
        throw error;
    }
    await logLoop(submitted ? 'success' : 'failed', outcome.usage, outcome.steps);

    if (!submitted) {
        // Distinct from a schema failure. The model ran out of steps, or decided
        // it could not produce a document — either way there is no draft, and
        // returning a half-empty one is how the pipeline shipped blank resumes.
        throw new Error(
            `Assembly finished without submitting a resume after ${outcome.steps} steps. Tools called: ${toolCalls.join(', ') || 'none'}`,
        );
    }

    return {
        draft: submitted,
        toolCalls,
        evidenceSeen: evidence.join('\n'),
        steps: outcome.steps,
    };
}
