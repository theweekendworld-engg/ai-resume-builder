/**
 * The backfill interview agent (PRD 07).
 *
 * Auto-capture only sees forward. Someone arriving with eight years of history
 * has eight years of work no connector will ever see, and the resume they
 * generate on day one is only as good as that gap. This agent reconstructs the
 * record that existed before Patronus — one subject, one conversation, and it
 * is why the first review packet can happen in week one instead of month six
 * (PRD 09 §3, lever 1).
 *
 * ── The split that matters ────────────────────────────────────────────────
 * **Code owns strategy; the model owns language.** The next topic is chosen
 * here, deterministically, from the state of the graph — which is what makes
 * "8-12 questions, one at a time, wind down before twenty" a property of the
 * system rather than a hope about a prompt. The model is asked for exactly two
 * strings: an acknowledgement and one question on the topic it was handed.
 *
 * Both are then run through {@link checkQuestion}, and a question that leads a
 * number, asks two things, or flatters never reaches the user — it is
 * regenerated once and then replaced by a scripted fallback. That is what makes
 * the launch gate in §8 real rather than aspirational: the eval asserts a
 * property the code enforces.
 *
 * Every model call goes through `generateStructured` (ADR-6). There is no
 * provider import in this file and no model id anywhere in it.
 */

import { z } from 'zod';
import { InterviewStatus, WinCategory, WinSensitivity } from '@prisma/client';
import { generateStructured } from '@/lib/ai/structured';
import { extractQuantities, flattenQuantities, isQuantitySupported } from '@/lib/ai/guard';
import { err, ok, type Result } from '@/lib/result';
import {
    endSessionTool,
    getGraphGapsTool,
    getSubjectContextTool,
    getSessionTool,
    linkEvidenceTool,
    persistTurnTool,
    recordCapturesTool,
    startSessionTool,
    writeImpactMetricTool,
    writeWinDraftTool,
    type CapturedWin,
    type GraphGaps,
    type SessionSnapshot,
    type SessionSummary,
    type SubjectContext,
    type TranscriptTurn,
} from '@/agents/tools/backfill';

// ═══════════════════════════════════════════════════════════════════ shape of a session

/** PRD 07 §3.1. The target is a conversation; the cap is a guardrail. */
export const MIN_QUESTIONS = 8;
export const TARGET_QUESTIONS = 12;
export const HARD_CAP_QUESTIONS = 20;

/** Observed pace, used only for the honest "about N minutes left" line. */
const SECONDS_PER_QUESTION = 42;

export const BACKFILL_TOPICS = [
    'anchor',
    'quantify',
    'scope',
    'rarity',
    'evidence',
    'sweep',
] as const;

export type BackfillTopic = (typeof BACKFILL_TOPICS)[number];

/**
 * PRD 07 §2. Six entry points, every one of them *after* the user has seen
 * value. There is deliberately no `onboarding` member: a twenty-question
 * interview in front of someone's first resume is a tax at the worst possible
 * moment, and removing it is the entire reason the feature was retargeted from
 * v2's onboarding wedge (§1).
 *
 * Lives here rather than beside the server action because a `'use server'`
 * module may only export async functions.
 */
export const BACKFILL_ENTRY_POINTS = [
    'post_import',
    'thin_log_period',
    'packet_shortfall',
    'mission_return',
    'gap_report',
    'log_menu',
] as const;

export type BackfillEntryPoint = (typeof BACKFILL_ENTRY_POINTS)[number];

/**
 * A planned question: the rung of the ladder plus the thing it is about.
 * `key` is what lands in `askedTopics`, so it must be stable across a resume —
 * that is the mechanism by which a resumed session never repeats itself.
 */
export type TopicPlan = {
    topic: BackfillTopic;
    key: string;
    /** Win the question refers to, when it refers to one. */
    targetWinId?: string;
    targetTitle?: string;
    /** Category being probed, for `rarity`. */
    targetCategory?: WinCategory;
    /** Refers to what the user just said rather than to a stored Win. */
    refersToLastAnswer?: boolean;
};

export type BackfillProgress = {
    /** 1-based, for "Question 4". */
    questionNumber: number;
    minutesLeft: number;
    cap: number;
};

export type BackfillNotice = {
    kind: 'sensitivity' | 'metric_conflict' | 'duplicate';
    message: string;
};

export type BackfillTurn = {
    sessionId: string;
    /** Empty on the opening question — there is nothing to acknowledge yet. */
    acknowledgement: string;
    /** Null once the interview has wound down. */
    question: string | null;
    topic: BackfillTopic | null;
    progress: BackfillProgress;
    /** Cards to add to the rail. Already persisted as drafts. */
    captured: CapturedWin[];
    /** Inline messages the user must see, e.g. the confidentiality notice. */
    notices: BackfillNotice[];
    /** True when the agent has wound down; the client shows the closing screen. */
    done: boolean;
};

// ═══════════════════════════════════════════════════════ the conversation gate
//
// PRD 07 §3.3 rules 4 and 5, and §8's launch gate. These are checked on every
// generated string before it is shown, not sampled in QA.

export type QuestionViolationRule =
    | 'leading_number'
    | 'banned_phrase'
    | 'multi_part'
    | 'flattery'
    | 'not_a_question'
    | 'too_long';

export type QuestionViolation = { rule: QuestionViolationRule; detail: string };

/**
 * Phrases that lead a number by construction. Banned unconditionally, digits or
 * not: "would you say" solicits agreement with a figure the agent supplied, and
 * a figure the user merely agreed to is a figure they will not be able to
 * defend in the interview the resume gets them.
 */
export const BANNED_PATTERNS: { pattern: RegExp; label: string }[] = [
    { pattern: /\bwould you say\b/i, label: 'would you say' },
    { pattern: /\baround\s+[~$]?\d/i, label: 'around <number>' },
    { pattern: /\broughly\s+[~$]?\d/i, label: 'roughly <number>' },
    { pattern: /\babout\s+[~$]?\d+\s*%/i, label: 'about <number>%' },
    { pattern: /\bsomething like\s+[~$]?\d/i, label: 'something like <number>' },
    { pattern: /\b(?:maybe|perhaps|say)\s+[~$]?\d+\s*%/i, label: 'maybe <number>%' },
    { pattern: /\bballpark\b/i, label: 'ballpark' },
    { pattern: /\border of magnitude\b/i, label: 'order of magnitude' },
    { pattern: /\b\d+\s*(?:ish|-ish)\b/i, label: '<number>ish' },
    { pattern: /~\s*\d/, label: '~<number>' },
];

/** PRD 07 §3.3 rule 5, plus foundations §10: no exclamation marks, ever. */
export const FLATTERY_PATTERNS: RegExp[] = [
    /\b(?:impressive|amazing|awesome|fantastic|incredible|brilliant|outstanding|remarkable|stellar)\b/i,
    /\b(?:great|nice|good|excellent|solid|strong)\s+(?:job|work|one|stuff|call|result|answer)\b/i,
    /\bwell done\b/i,
    /\bthat'?s\s+(?:great|huge|big|excellent|wonderful|fantastic)\b/i,
    /\blove (?:it|that|this)\b/i,
    /\bwow\b/i,
    /!/,
];

/** A second interrogative clause bolted on with "and"/"or" loses the first answer. */
const MULTI_PART_PATTERN =
    /\b(?:and|or)\s+(?:also\s+)?(?:what|how|who|whom|when|where|why|which|did|do|does|was|were|is|are|has|have|had|could|would|can|will)\b/i;

/**
 * Quantities the agent is allowed to use: everything the user has already said,
 * plus the subject label and the titles already on the record. Anything else is
 * a number the agent introduced.
 */
export function allowedQuantitySource(params: {
    transcript: TranscriptTurn[];
    subjectLabel: string;
    answerText?: string;
    contextTitles?: string[];
}): string {
    return [
        params.subjectLabel,
        ...(params.contextTitles ?? []),
        ...params.transcript.map((turn) => turn.content),
        params.answerText ?? '',
    ].join('\n');
}

/**
 * The gate. Returns every reason the string must not be shown to the user.
 *
 * `sourceText` is the conversation so far: a numeral is fine when the user
 * supplied it ("You said 800ms to 180ms — was that every region?") and a
 * violation when the agent did. Years and dates are exempt, matching the
 * numeric guard's default, because a date is not a claim about impact.
 */
export function checkQuestion(
    text: string,
    options: { sourceText?: string; requireQuestionMark?: boolean; maxLength?: number } = {},
): QuestionViolation[] {
    const violations: QuestionViolation[] = [];
    const trimmed = text.trim();

    for (const { pattern, label } of BANNED_PATTERNS) {
        if (pattern.test(trimmed)) violations.push({ rule: 'banned_phrase', detail: label });
    }

    for (const pattern of FLATTERY_PATTERNS) {
        const match = pattern.exec(trimmed);
        if (match) violations.push({ rule: 'flattery', detail: match[0] });
    }

    const supported = flattenQuantities(extractQuantities(options.sourceText ?? '', 'lenient'));
    for (const quantity of extractQuantities(trimmed, 'strict')) {
        if (quantity.kind === 'year' || quantity.kind === 'date') continue;
        if (isQuantitySupported(quantity, supported)) continue;
        violations.push({ rule: 'leading_number', detail: quantity.raw.trim() });
    }

    if (options.requireQuestionMark !== false) {
        const marks = (trimmed.match(/\?/g) ?? []).length;
        if (marks === 0) violations.push({ rule: 'not_a_question', detail: 'no question mark' });
        if (marks > 1) violations.push({ rule: 'multi_part', detail: 'more than one question' });
        if (MULTI_PART_PATTERN.test(trimmed)) {
            violations.push({ rule: 'multi_part', detail: 'two interrogative clauses' });
        }
    }

    const maxLength = options.maxLength ?? 220;
    if (trimmed.length > maxLength) {
        violations.push({ rule: 'too_long', detail: `${trimmed.length} chars` });
    }

    return violations;
}

// ═══════════════════════════════════════════════════════════ scripted fallbacks
//
// What the user sees when the model cannot produce a clean question twice in a
// row. Every one is deliberately plain, single-clause, and numeral-free — a
// slightly generic question the user can answer beats a polished one that puts
// a figure in their mouth.

export function fallbackQuestion(plan: TopicPlan, subjectLabel: string): string {
    switch (plan.topic) {
        case 'anchor':
            // PRD 07 §3.2 phrases this as "the two or three things". The gate
            // counts written cardinals as quantities, and it is right to: a
            // question that pre-decides how many things there were is still the
            // agent putting a number in the user's mouth. Open plural instead.
            return `What are you most known for from your time at ${subjectLabel}?`;
        case 'quantify':
            return 'Any sense of the size of that one?';
        case 'scope':
            return 'Was that just your own team, or wider?';
        case 'rarity':
            switch (plan.targetCategory) {
                case WinCategory.grew:
                    return 'Did you help anyone on the team get better at something?';
                case WinCategory.saved:
                    return 'Did any of that work take cost or time out of the business?';
                case WinCategory.influenced:
                default:
                    return "Whose work changed because of something you did there?";
            }
        case 'evidence':
            return 'Is there a doc, dashboard or ticket you could point at for any of this?';
        case 'sweep':
        default:
            return "Anything from that period you'd be annoyed to leave off your resume?";
    }
}

/** The acknowledgement used when the model's own is unusable. Reflects nothing rather than flattering. */
const NEUTRAL_ACKNOWLEDGEMENTS: Record<BackfillTopic, string> = {
    anchor: 'Noted.',
    quantify: 'Got it.',
    scope: 'Understood.',
    rarity: 'Noted.',
    evidence: 'Understood.',
    sweep: 'Got it.',
};

// ═══════════════════════════════════════════════════════════════ the planner

export type PlannerState = {
    questionCount: number;
    askedTopics: string[];
    /** Cards captured so far this session. */
    captured: CapturedWin[];
    gaps: GraphGaps;
    context: SubjectContext;
    /** The answer to the question just asked, if any. */
    lastAnswer?: string;
    lastTopic?: BackfillTopic;
    /** Two vague answers in a row means the thread is dry (PRD 07 §8). */
    consecutiveVague: number;
    /** Topics the user's own answer already covered — skip ahead, don't re-ask. */
    coveredTopics?: BackfillTopic[];
};

/**
 * The highest-value question available, from the state of the graph.
 *
 * Returns `null` to wind down. The order is PRD 07 §3.2's, with two additions
 * the spec implies rather than states: a thread that has produced two vague
 * answers is abandoned rather than pressed, and the sweep is always the last
 * question so the interview ends on the user's own framing.
 */
export function planNextTopic(state: PlannerState): TopicPlan | null {
    const asked = new Set(state.askedTopics);
    const covered = new Set(state.coveredTopics ?? []);
    const has = (key: string) => asked.has(key);

    if (state.questionCount >= HARD_CAP_QUESTIONS) return null;

    // 1. Anchor — always first, and only once. It opens the space and gets the
    //    user's own framing before the agent has imposed any of its own.
    if (!has('anchor')) return { topic: 'anchor', key: 'anchor' };

    const nearingEnd = state.questionCount >= TARGET_QUESTIONS - 1;
    const dryThread = state.consecutiveVague >= 2;

    // The sweep closes; nothing follows it.
    if (has('sweep')) return null;
    if (nearingEnd) return { topic: 'sweep', key: 'sweep' };

    // 2. Quantify. The answer just given is the freshest target and needs no
    //    round trip through extraction, which is what keeps the two model calls
    //    genuinely parallel.
    if (!dryThread && !covered.has('quantify')) {
        if (
            state.lastAnswer &&
            state.lastTopic !== 'quantify' &&
            !statesAQuantity(state.lastAnswer) &&
            !isVagueAnswer(state.lastAnswer) &&
            !has(`quantify:last:${state.questionCount}`)
        ) {
            return {
                topic: 'quantify',
                key: `quantify:last:${state.questionCount}`,
                refersToLastAnswer: true,
            };
        }

        const unquantified = [
            ...state.captured.filter((win) => !win.quantified).map((win) => ({ id: win.winId, title: win.title })),
            ...state.gaps.unquantifiedWins,
        ].find((win) => !has(`quantify:${win.id}`));

        if (unquantified) {
            return {
                topic: 'quantify',
                key: `quantify:${unquantified.id}`,
                targetWinId: unquantified.id,
                targetTitle: unquantified.title,
            };
        }
    }

    // 3. Scope — what separates Senior evidence from Staff evidence, and the
    //    one thing nobody volunteers.
    if (!dryThread && !covered.has('scope')) {
        const unscoped = [
            ...state.captured.map((win) => ({ id: win.winId, title: win.title })),
            ...state.gaps.unscopedWins,
        ].find((win) => !has(`scope:${win.id}`));
        if (unscoped && !has('scope:done')) {
            return {
                topic: 'scope',
                key: `scope:${unscoped.id}`,
                targetWinId: unscoped.id,
                targetTitle: unscoped.title,
            };
        }
    }

    // 4. Rarity — probe the categories the log lacks, rarest first.
    const capturedCategories = new Set(state.captured.map((win) => win.category));
    const missing = state.gaps.missingCategories.find(
        (category) => !capturedCategories.has(category) && !has(`rarity:${category}`),
    );
    if (missing) {
        return { topic: 'rarity', key: `rarity:${missing}`, targetCategory: missing };
    }

    // 5. Evidence — optional, once, and only after there is something to point at.
    if (!has('evidence') && state.captured.length > 0 && state.questionCount >= MIN_QUESTIONS - 3) {
        return { topic: 'evidence', key: 'evidence' };
    }

    // 6. Sweep.
    return { topic: 'sweep', key: 'sweep' };
}

/**
 * Does this impact actually carry a figure?
 *
 * After the numeric guard strips an unsupported quantity the leaf is blank, so
 * a "quantified" impact can arrive with a metric name and nothing else. That is
 * not a metric — writing it would put a `⚡ quantified` chip on a Win with no
 * number behind it, which is the exact lie this feature exists to prevent.
 */
export function carriesFigure(impact: {
    baseline?: string | null;
    result?: string | null;
    delta?: string | null;
}): boolean {
    return [impact.baseline, impact.result, impact.delta].some((field) => Boolean(field?.trim()));
}

/** Cheap, synchronous, and good enough to route on before extraction lands. */
export function statesAQuantity(text: string): boolean {
    return extractQuantities(text, 'lenient').some(
        (quantity) => quantity.kind !== 'year' && quantity.kind !== 'date',
    );
}

const DONT_REMEMBER_PATTERNS = [
    /\bi don'?t (?:remember|recall|know)\b/i,
    /\bno idea\b/i,
    /\bcan'?t remember\b/i,
    /\bnot sure\b/i,
];

export function saysDontRemember(text: string): boolean {
    return DONT_REMEMBER_PATTERNS.some((pattern) => pattern.test(text));
}

/** Outright non-answers. Recognised whole, so "no" is vague and "no one else" is not. */
const NON_ANSWER_PATTERNS = [
    /^(?:no|nope|nah|none|nothing|not really|nothing much|nothing comes to mind|dunno|idk|hmm+|maybe)\b[.!]?$/i,
];

/**
 * A non-answer: nothing to build on. Two of these in a row and the agent
 * changes the subject rather than pressing (PRD 07 §8).
 *
 * Deliberately conservative. Treating a real but terse answer as vague would
 * abandon a live thread, which costs more than one wasted follow-up — "I led
 * the payments migration end to end" is short and is not a non-answer.
 */
export function isVagueAnswer(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) return true;
    if (saysDontRemember(trimmed)) return true;
    if (NON_ANSWER_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
    if (trimmed.length >= 90) return false;
    if (statesAQuantity(trimmed)) return false;
    return trimmed.split(/\s+/).length <= 4;
}

function countTrailingVague(transcript: TranscriptTurn[]): number {
    let count = 0;
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
        const turn = transcript[i];
        if (turn.role !== 'user') continue;
        if (!isVagueAnswer(turn.content)) break;
        count += 1;
    }
    return count;
}

// ═══════════════════════════════════════════════════════ confidential detection
//
// PRD 07 §8. Detecting it is half the job; *saying so inline* is the other half.
// Naming the protection out loud is what makes people willing to keep talking
// about the work they cannot put on a resume — which is most of the interesting
// work.

const CONFIDENTIAL_MARKERS: { pattern: RegExp; label: string }[] = [
    { pattern: /\b(?:unreleased|unlaunched|pre-?launch|unannounced)\b/i, label: 'unreleased work' },
    { pattern: /\b(?:acquisition|merger|m&a|due diligence)\b/i, label: 'a corporate transaction' },
    { pattern: /\b(?:layoff|layoffs|redundanc|termination|fired|pip|performance improvement plan)\w*\b/i, label: 'a personnel matter' },
    { pattern: /\b(?:lawsuit|litigation|subpoena|legal action)\b/i, label: 'a legal matter' },
    { pattern: /\b(?:security incident|breach|vulnerability|cve-\d|zero-?day|exploit)\b/i, label: 'a security matter' },
    { pattern: /\b(?:nda|non-?disclosure|under embargo|embargoed)\b/i, label: 'work under NDA' },
    { pattern: /\b(?:salary|salaries|compensation band|comp band|equity grant)\b/i, label: 'compensation detail' },
    { pattern: /\bconfidential\b/i, label: 'something you called confidential' },
];

const INTERNAL_MARKERS: { pattern: RegExp; label: string }[] = [
    { pattern: /\b(?:arr|mrr|revenue|churn rate|gross margin|burn rate|runway)\b/i, label: 'internal financials' },
    { pattern: /\b(?:headcount|hiring plan|org chart|reorg|re-?organisation|re-?organization)\b/i, label: 'internal org detail' },
    { pattern: /\b(?:roadmap|okrs?|board deck|internal metric|internal dashboard)\b/i, label: 'internal planning detail' },
    { pattern: /\binternal(?:\s|-)only\b/i, label: 'internal-only material' },
];

export type SensitivityFinding = {
    sensitivity: WinSensitivity;
    reason: string;
    /** Said inline, in the chat, at the moment of capture. */
    message: string;
};

export function detectSensitivity(text: string): SensitivityFinding | null {
    for (const { pattern, label } of CONFIDENTIAL_MARKERS) {
        if (pattern.test(text)) {
            return {
                sensitivity: WinSensitivity.confidential,
                reason: label,
                message: `I've marked this confidential — it stays in your record and never leaves it.`,
            };
        }
    }
    for (const { pattern, label } of INTERNAL_MARKERS) {
        if (pattern.test(text)) {
            return {
                sensitivity: WinSensitivity.internal_only,
                reason: label,
                message: `I've marked this internal-only — it'll help your review but won't go on a resume.`,
            };
        }
    }
    return null;
}

const SENSITIVITY_RANK: Record<WinSensitivity, number> = {
    [WinSensitivity.shareable]: 0,
    [WinSensitivity.internal_only]: 1,
    [WinSensitivity.confidential]: 2,
};

/** The stricter of what the model proposed and what the keywords found. */
export function strictestSensitivity(
    ...values: (WinSensitivity | undefined | null)[]
): WinSensitivity {
    return values
        .filter((value): value is WinSensitivity => Boolean(value))
        .reduce(
            (strictest, value) =>
                SENSITIVITY_RANK[value] > SENSITIVITY_RANK[strictest] ? value : strictest,
            WinSensitivity.shareable,
        );
}

// ═══════════════════════════════════════════════════════════════ progress

export function estimateProgress(questionCount: number): BackfillProgress {
    const remaining = Math.max(1, TARGET_QUESTIONS - questionCount);
    return {
        questionNumber: questionCount + 1,
        minutesLeft: Math.max(1, Math.round((remaining * SECONDS_PER_QUESTION) / 60)),
        cap: HARD_CAP_QUESTIONS,
    };
}

// ═══════════════════════════════════════════════════════════════ the prompts

export const BACKFILL_TURN_SYSTEM = [
    'You are helping a working professional reconstruct accomplishments from a period of their',
    'career that predates any automatic tracking. You are a thoughtful colleague taking notes,',
    'not an interviewer and not a chatbot.',
    '',
    'You produce exactly two things: a short acknowledgement of what they just said, and ONE',
    'question. The topic of that question has already been chosen for you — write it well, do not',
    'choose a different one.',
    '',
    'THE RULES. Each one is checked mechanically after you answer; a violation is discarded and',
    'replaced with a scripted question, so breaking one costs the user a good question.',
    '',
    '1. ONE QUESTION. One sentence, one question mark, one thing being asked. A question with two',
    '   parts gets a partial answer and silently loses the rest.',
    '2. NEVER LEAD A NUMBER. Never propose, estimate, suggest or bracket a figure. Banned outright:',
    '   "would you say around 30%", "roughly 40%", "was it about a hundred", "ballpark". Required',
    '   instead: "any sense of the size?", "how much did it move?", "do you know the number?".',
    '   A figure you supply is a figure they will agree to and later put on a resume, and they will',
    '   not be able to defend it. You may repeat a number THEY already said; never introduce one.',
    '3. NEVER FLATTER. No "impressive", no "great work", no exclamation marks. It is transparently',
    '   synthetic and it costs the trust the whole product runs on.',
    '4. ACKNOWLEDGE SPECIFICALLY. Reflect the actual thing they said in a few words, then ask.',
    '   "Noted." is better than "Great, thanks for sharing that!" — but reflecting the specific',
    '   detail is better than either. Never "Great! Next question."',
    '5. NEVER INVENT CONTEXT. If you were given nothing about this subject, do not imply you',
    '   remember anything about it.',
    '6. ACCEPT NOT KNOWING. If they said they do not remember, do not re-ask and do not coax.',
    '   Move to the next topic without comment.',
    '7. PLAIN LANGUAGE. No "leverage", no "spearhead", no "journey", no "dive deeper".',
    '',
    'THE TOPICS, and what each is for:',
    '  anchor    — open the space; get their own framing of what they are known for',
    '  quantify  — ask whether a size is known for something they described. Never name one.',
    '  scope     — was this their own work, their team, or wider? This is the thing that separates',
    '              senior evidence from staff evidence, and nobody volunteers it.',
    '  rarity    — probe a kind of work missing from the record: who else changed what they did,',
    '              who they developed, what they saved.',
    '  evidence  — is there a doc, dashboard or ticket to point at? "No" is a fine answer.',
    '  sweep     — anything from the period they would be annoyed to leave off their resume?',
].join('\n');

const TurnSchema = z.object({
    /** Reflects the specific thing they said. Empty string on the opening turn. */
    acknowledgement: z.string().max(280),
    /** Exactly one question, ending in a question mark. */
    question: z.string().min(4).max(200),
});

export function buildTurnPrompt(params: {
    context: SubjectContext;
    plan: TopicPlan;
    transcript: TranscriptTurn[];
    answerText: string | null;
    reanchor: string | null;
    questionNumber: number;
}): string {
    const { context, plan } = params;
    const recent = params.transcript.slice(-6);

    const lines: string[] = [
        `SUBJECT: ${context.subjectLabel}${context.role ? ` — ${context.role}` : ''}`,
    ];

    if (!context.hasPriorContext) {
        lines.push(
            'PRIOR CONTEXT: none. You know nothing about this subject beyond its name. Do not imply otherwise.',
        );
    } else {
        if (context.highlights.length > 0) {
            lines.push('ON THE RECORD ALREADY (their resume wording):');
            lines.push(...context.highlights.slice(0, 6).map((line) => `  - ${line}`));
        }
        if (context.existingWins.length > 0) {
            lines.push('WINS ALREADY LOGGED FOR THIS SUBJECT:');
            lines.push(
                ...context.existingWins.slice(0, 8).map((win) => `  - ${win.title}`),
            );
        }
    }

    lines.push('', `QUESTION NUMBER: ${params.questionNumber} of about ${TARGET_QUESTIONS}.`);

    if (recent.length > 0) {
        lines.push('', 'CONVERSATION SO FAR:');
        lines.push(
            ...recent.map((turn) => `  ${turn.role === 'agent' ? 'You' : 'Them'}: ${turn.content}`),
        );
    }

    if (params.answerText) {
        lines.push('', 'THEIR LATEST ANSWER — acknowledge something specific from it:', '"""', params.answerText.trim(), '"""');
    }

    if (params.reanchor) {
        lines.push(
            '',
            `RESUMED SESSION. Open by re-anchoring in one short clause, then ask: ${params.reanchor}`,
        );
    }

    lines.push('', `TOPIC FOR YOUR QUESTION: ${plan.topic}`);
    if (plan.refersToLastAnswer) {
        lines.push('Ask about the thing they just described. Do not name a size — ask whether they know one.');
    }
    if (plan.targetTitle) {
        lines.push(`It is about this specific win: "${plan.targetTitle}"`);
    }
    if (plan.targetCategory) {
        lines.push(`Probe for work of this kind, which the record is missing: ${plan.targetCategory}`);
    }
    if (plan.topic === 'sweep') {
        lines.push('This is the last question. Wind the conversation down with it.');
    }

    return lines.join('\n');
}

export const BACKFILL_EXTRACT_SYSTEM = [
    'You read one answer from a conversation about someone\'s past work and pull out the distinct',
    'accomplishments it contains. Nothing else.',
    '',
    'THE RULE THAT OUTRANKS EVERYTHING: never invent a number. Every digit, percentage, currency',
    'amount, multiplier and duration you write must appear verbatim in their answer. Do not',
    'estimate, do not round, do not infer a typical value, and do not compute one figure from two',
    'others — a percentage derived from a stated baseline and a stated result is still fabricated.',
    'If the answer contains no figure, `quantified` is false and `impact` is null. That is a',
    'correct and complete result, not a failure.',
    '',
    'ALSO NEVER INVENT SCOPE OR OUTCOME. No "for millions of users", no "which unblocked the',
    'release", unless they said it.',
    '',
    'SPLITTING: one answer often contains several distinct wins. Split them. A single win that',
    'happens to have several sentences about it stays one win. Cap at four.',
    '',
    'TITLES are factual statements, at most a line. Never "successfully", "spearheaded",',
    '"leveraged", "utilized", "world-class".',
    '',
    'CATEGORY — pick exactly one per win:',
    '  shipped · improved · fixed · led · influenced · grew · learned · saved',
    'Resolve ties toward the rarer category: `influenced` beats `shipped`.',
    '',
    'SENSITIVITY — propose only. `internal_only` for internal metrics or org detail,',
    '`confidential` for unreleased product, security incidents, personnel matters, legal matters',
    'or named clients, `shareable` otherwise.',
    '',
    'EXCERPT: for each win, the span of THEIR OWN WORDS that supports it, copied verbatim. Their',
    'words are the evidence, so a paraphrase here is worthless.',
    '',
    'If the answer is a non-answer ("I don\'t remember", "not really", "nothing comes to mind"),',
    'return no wins and set `saidDontRemember` or `vague`.',
].join('\n');

const CATEGORY_VALUES = Object.values(WinCategory) as [WinCategory, ...WinCategory[]];
const SENSITIVITY_VALUES = Object.values(WinSensitivity) as [WinSensitivity, ...WinSensitivity[]];

const ImpactShape = z.object({
    metric: z.string().max(120),
    baseline: z.string().max(80).nullable(),
    result: z.string().max(80).nullable(),
    delta: z.string().max(80).nullable(),
    scope: z.string().max(120).nullable(),
    timeframe: z.string().max(80).nullable(),
});

export const BackfillExtractionSchema = z.object({
    wins: z
        .array(
            z.object({
                title: z.string().max(120),
                narrative: z.string().max(600),
                category: z.enum(CATEGORY_VALUES),
                skills: z.array(z.string().max(80)).max(8),
                collaborators: z.array(z.string().max(120)).max(6),
                suggestedSensitivity: z.enum(SENSITIVITY_VALUES),
                quantified: z.boolean(),
                impact: ImpactShape.nullable(),
                excerpt: z.string().max(600),
            }),
        )
        .max(4),
    /** A figure for the win the previous question was about, rather than a new win. */
    metricForPreviousWin: ImpactShape.nullable(),
    saidDontRemember: z.boolean(),
    vague: z.boolean(),
    /** Topics this answer already covered, so the agent skips ahead instead of re-asking. */
    coveredTopics: z.array(z.enum(BACKFILL_TOPICS)).max(6),
});

export type BackfillExtraction = z.infer<typeof BackfillExtractionSchema>;

export function buildExtractPrompt(params: {
    answerText: string;
    question: string;
    subjectLabel: string;
    previousWinTitle?: string;
}): string {
    return [
        `They are talking about: ${params.subjectLabel}.`,
        `They were asked: ${params.question}`,
        ...(params.previousWinTitle
            ? [`That question was about this win, already on the record: "${params.previousWinTitle}"`]
            : []),
        '',
        'Their answer — the ONLY source of facts; every number you output must appear here verbatim:',
        '"""',
        params.answerText.trim(),
        '"""',
    ].join('\n');
}

// ═══════════════════════════════════════════════════════════════ turn assembly

type ComposedTurn = { acknowledgement: string; question: string; costUsd: number };

/**
 * Ask for the turn, check it, ask once more with the violations named, then fall
 * back to a scripted question. The user never sees a violation, which is what
 * lets the eval assert zero rather than "few".
 */
async function composeTurn(params: {
    userId: string;
    sessionId: string;
    plan: TopicPlan;
    context: SubjectContext;
    transcript: TranscriptTurn[];
    answerText: string | null;
    reanchor: string | null;
    questionNumber: number;
}): Promise<ComposedTurn> {
    const sourceText = allowedQuantitySource({
        transcript: params.transcript,
        subjectLabel: params.context.subjectLabel,
        answerText: params.answerText ?? '',
        contextTitles: [
            ...params.context.highlights,
            ...params.context.existingWins.map((win) => win.title),
        ],
    });

    const basePrompt = buildTurnPrompt({
        context: params.context,
        plan: params.plan,
        transcript: params.transcript,
        answerText: params.answerText,
        reanchor: params.reanchor,
        questionNumber: params.questionNumber,
    });

    let costUsd = 0;
    let prompt = basePrompt;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        let result;
        try {
            result = await generateStructured({
                task: 'interviewTurn',
                feature: 'backfill',
                userId: params.userId,
                sessionId: params.sessionId,
                schema: TurnSchema,
                system: BACKFILL_TURN_SYSTEM,
                prompt,
                maxRetries: 0,
            });
        } catch (error) {
            console.warn('[backfillAgent] turn generation failed', {
                attempt,
                error: error instanceof Error ? error.message : String(error),
            });
            break;
        }

        costUsd += result.usage.costUsd;

        const questionViolations = checkQuestion(result.data.question, { sourceText });
        const ackViolations = checkQuestion(result.data.acknowledgement, {
            sourceText,
            requireQuestionMark: false,
            maxLength: 280,
        });

        if (questionViolations.length === 0 && ackViolations.length === 0) {
            return {
                acknowledgement: result.data.acknowledgement.trim(),
                question: result.data.question.trim(),
                costUsd,
            };
        }

        console.warn('[backfillAgent] backfill_turn_rejected', {
            sessionId: params.sessionId,
            attempt,
            question: questionViolations,
            acknowledgement: ackViolations,
        });

        prompt = [
            basePrompt,
            '',
            'Your previous attempt broke these rules and was discarded:',
            ...[...questionViolations, ...ackViolations].map(
                (violation) => `- ${violation.rule}: ${violation.detail}`,
            ),
            '',
            'Rewrite it. Ask exactly one question, introduce no figure of any kind, and pay no',
            'compliments.',
        ].join('\n');
    }

    return {
        acknowledgement: NEUTRAL_ACKNOWLEDGEMENTS[params.plan.topic],
        question: fallbackQuestion(params.plan, params.context.subjectLabel),
        costUsd,
    };
}

/**
 * The captured half of a turn. Runs as its own promise so the Wins land in the
 * database — and therefore in the rail, via the SSE stream — without waiting on
 * question generation (PRD 07 §9: cards within 2s of each answer).
 */
async function captureFromAnswer(params: {
    userId: string;
    sessionId: string;
    context: SubjectContext;
    answerText: string;
    question: string;
    questionIndex: number;
    previousPlan: TopicPlan | null;
    /** The rail as it stood before this answer — the target for a bare figure. */
    recentWins: CapturedWin[];
    occurredAt: Date;
}): Promise<{
    captured: CapturedWin[];
    notices: BackfillNotice[];
    coveredTopics: BackfillTopic[];
    vague: boolean;
    saidDontRemember: boolean;
    costUsd: number;
    askTopics: string[];
}> {
    const empty = {
        captured: [] as CapturedWin[],
        notices: [] as BackfillNotice[],
        coveredTopics: [] as BackfillTopic[],
        vague: true,
        saidDontRemember: saysDontRemember(params.answerText),
        costUsd: 0,
        askTopics: [] as string[],
    };

    if (saysDontRemember(params.answerText) || params.answerText.trim().length < 3) {
        return empty;
    }

    let extraction: BackfillExtraction;
    let costUsd = 0;
    let guardStripped = false;
    try {
        const result = await generateStructured({
            task: 'interviewExtract',
            feature: 'backfill',
            userId: params.userId,
            sessionId: params.sessionId,
            schema: BackfillExtractionSchema,
            system: BACKFILL_EXTRACT_SYSTEM,
            prompt: buildExtractPrompt({
                answerText: params.answerText,
                question: params.question,
                subjectLabel: params.context.subjectLabel,
                previousWinTitle: params.previousPlan?.targetTitle,
            }),
            // The no-fabrication contract. The answer is the only admissible source.
            guard: { sourceText: params.answerText, fields: ['wins', 'metricForPreviousWin'] },
        });
        extraction = result.data;
        costUsd = result.usage.costUsd;
        guardStripped = result.degraded;
    } catch (error) {
        console.error('[backfillAgent] extraction failed', {
            sessionId: params.sessionId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { ...empty, vague: false };
    }

    const notices: BackfillNotice[] = [];
    const captured: CapturedWin[] = [];
    const askTopics: string[] = [];
    const detected = detectSensitivity(params.answerText);
    let sensitivityAnnounced = false;

    for (const win of extraction.wins) {
        // The guard strips an offending array element or blanks a string. Either
        // way the honest end state is a Win with no figure, never a half one:
        // an "impact" whose figures were all blanked is not a metric, it is a
        // metric-shaped hole, and writing it would make `quantified` a lie.
        if (!win.title.trim()) continue;
        const impact =
            win.quantified && win.impact && win.impact.metric.trim() && carriesFigure(win.impact)
                ? win.impact
                : null;

        const sensitivity = strictestSensitivity(win.suggestedSensitivity, detected?.sensitivity);

        const written = await writeWinDraftTool({
            userId: params.userId,
            sessionId: params.sessionId,
            questionIndex: params.questionIndex,
            answerText: params.answerText,
            draft: {
                title: win.title.trim(),
                narrative: win.narrative,
                category: win.category,
                skills: win.skills,
                collaborators: win.collaborators,
                sensitivity,
                impact,
                confidence: 0.6,
            },
            occurredAt: params.occurredAt,
            ...(params.context.subjectType === 'employer' && params.context.subjectId
                ? { employerId: params.context.subjectId }
                : {}),
        });

        if (!written.success) {
            console.warn('[backfillAgent] capture write failed', {
                sessionId: params.sessionId,
                error: written.error,
                code: written.code,
            });
            continue;
        }

        captured.push(written.data.win);
        askTopics.push(`captured:${written.data.win.winId}`);

        if (written.data.deduplicated) {
            notices.push({
                kind: 'duplicate',
                message: `That one was already on your record — I've kept the existing entry.`,
            });
        } else {
            // Their own words are the evidence (PRD 07 §4).
            const excerpt = win.excerpt.trim() || params.answerText.trim();
            await linkEvidenceTool({
                userId: params.userId,
                sessionId: params.sessionId,
                winId: written.data.win.winId,
                excerpt,
            });
        }

        if (
            !sensitivityAnnounced &&
            detected &&
            written.data.win.sensitivity !== WinSensitivity.shareable
        ) {
            notices.push({ kind: 'sensitivity', message: detected.message });
            sensitivityAnnounced = true;
        }
    }

    // A figure that answers the previous question rather than describing a new
    // win. The quantify rung often refers to "the thing you just described"
    // rather than to a stored id, so fall back to the freshest card still
    // missing a number — otherwise the one answer the whole rung exists to
    // collect gets dropped on the floor.
    const metricTargetId =
        params.previousPlan?.targetWinId ??
        (params.previousPlan?.topic === 'quantify'
            ? ([...params.recentWins].reverse().find((win) => !win.quantified)?.winId ??
                params.recentWins.at(-1)?.winId)
            : undefined);

    if (extraction.metricForPreviousWin && metricTargetId && extraction.metricForPreviousWin.metric.trim()) {
        const attached = await writeImpactMetricTool({
            userId: params.userId,
            winId: metricTargetId,
            answerText: params.answerText,
            impact: extraction.metricForPreviousWin,
        });
        if (attached.success) {
            const card = params.recentWins.find((win) => win.winId === metricTargetId);
            captured.push({
                winId: metricTargetId,
                title: card?.title ?? params.previousPlan?.targetTitle ?? '',
                category: card?.category ?? WinCategory.improved,
                sensitivity: card?.sensitivity ?? WinSensitivity.shareable,
                quantified: true,
                metricLabel: attached.data.metricLabel,
                questionIndex: params.questionIndex,
                capturedAt: new Date().toISOString(),
            });
        }
    }

    if (captured.length > 0) {
        await recordCapturesTool({
            userId: params.userId,
            sessionId: params.sessionId,
            wins: captured,
        });
    }

    if (guardStripped) {
        console.warn('[backfillAgent] extraction degraded by the numeric guard', {
            sessionId: params.sessionId,
        });
    }

    return {
        captured,
        notices,
        coveredTopics: extraction.coveredTopics,
        vague: extraction.vague,
        saidDontRemember: extraction.saidDontRemember,
        costUsd,
        askTopics,
    };
}

// ═══════════════════════════════════════════════════════════════ public API

/**
 * The occurredAt for a Win recovered from an interview.
 *
 * The middle of the subject's period, not today. A backfilled Win dated today
 * would sort above this week's real work and quietly corrupt the log's whole
 * premise, which is that `occurredAt` is when the work happened.
 */
export function backfillOccurredAt(context: SubjectContext, now: Date = new Date()): Date {
    const { periodStart, periodEnd } = context;
    if (periodStart && periodEnd) {
        return new Date((periodStart.getTime() + periodEnd.getTime()) / 2);
    }
    if (periodEnd) return periodEnd;
    if (periodStart) {
        const midpoint = new Date((periodStart.getTime() + now.getTime()) / 2);
        return midpoint > now ? now : midpoint;
    }
    return now;
}

/** Re-anchor a session picked up after a gap, rather than restarting it (PRD 07 §8). */
export function buildReanchor(snapshot: SessionSnapshot, now: Date = new Date()): string | null {
    const daysSince = (now.getTime() - snapshot.lastActiveAt.getTime()) / 86_400_000;
    if (daysSince < 3 || snapshot.transcript.length === 0) return null;

    const lastUserTurn = [...snapshot.transcript].reverse().find((turn) => turn.role === 'user');
    const mention = lastUserTurn ? lastUserTurn.content.trim().slice(0, 80) : null;
    return mention
        ? `we were talking about your time at ${snapshot.subjectLabel} — you'd mentioned "${mention}"`
        : `we were talking about your time at ${snapshot.subjectLabel}`;
}

export type StartBackfillParams = {
    userId: string;
    subjectType: 'employer' | 'project' | 'competency' | 'period';
    subjectId?: string | null;
    subjectLabel: string;
    now?: Date;
};

/**
 * Open (or resume) a session and produce the first question.
 *
 * Idempotent per subject: re-entering an employer that already has a live
 * session resumes it, so `askedTopics` survives and question one does not
 * repeat.
 */
export async function startBackfill(params: StartBackfillParams): Promise<Result<BackfillTurn>> {
    const started = await startSessionTool({
        userId: params.userId,
        subjectType: params.subjectType,
        subjectId: params.subjectId ?? null,
        subjectLabel: params.subjectLabel,
    });
    if (!started.success) return err(started.error, started.code);

    const snapshot = started.data;

    // Resuming mid-conversation: hand back where they were, do not re-ask.
    const lastAgentTurn = [...snapshot.transcript].reverse().find((turn) => turn.role === 'agent');
    const lastIsUnanswered =
        lastAgentTurn !== undefined &&
        snapshot.transcript[snapshot.transcript.length - 1]?.role === 'agent';

    if (lastIsUnanswered && lastAgentTurn) {
        return ok({
            sessionId: snapshot.id,
            acknowledgement: buildReanchor(snapshot, params.now) ?? '',
            question: lastAgentTurn.content,
            topic: (lastAgentTurn.topic?.split(':')[0] as BackfillTopic | undefined) ?? null,
            progress: estimateProgress(Math.max(0, snapshot.questionCount - 1)),
            captured: snapshot.captured,
            notices: [],
            done: false,
        });
    }

    const context = await getSubjectContextTool({
        userId: params.userId,
        subjectType: snapshot.subjectType,
        subjectId: snapshot.subjectId,
        subjectLabel: snapshot.subjectLabel,
    });
    if (!context.success) return err(context.error, context.code);

    const gaps = await getGraphGapsTool({
        userId: params.userId,
        winIds: [
            ...context.data.existingWins.map((win) => win.id),
            ...snapshot.captured.map((win) => win.winId),
        ],
    });
    if (!gaps.success) return err(gaps.error, gaps.code);

    const plan = planNextTopic({
        questionCount: snapshot.questionCount,
        askedTopics: snapshot.askedTopics,
        captured: snapshot.captured,
        gaps: gaps.data,
        context: context.data,
        consecutiveVague: countTrailingVague(snapshot.transcript),
    });

    if (!plan) {
        return ok({
            sessionId: snapshot.id,
            acknowledgement: '',
            question: null,
            topic: null,
            progress: estimateProgress(snapshot.questionCount),
            captured: snapshot.captured,
            notices: [],
            done: true,
        });
    }

    const composed = await composeTurn({
        userId: params.userId,
        sessionId: snapshot.id,
        plan,
        context: context.data,
        transcript: snapshot.transcript,
        answerText: null,
        reanchor: buildReanchor(snapshot, params.now),
        questionNumber: snapshot.questionCount + 1,
    });

    await persistTurnTool({
        userId: params.userId,
        sessionId: snapshot.id,
        appendTurns: [{ role: 'agent', content: composed.question, topic: plan.key }],
        askTopics: [plan.key],
        questionCountDelta: 1,
        costUsdDelta: composed.costUsd,
    });

    return ok({
        sessionId: snapshot.id,
        acknowledgement: composed.acknowledgement,
        question: composed.question,
        topic: plan.topic,
        progress: estimateProgress(snapshot.questionCount),
        captured: snapshot.captured,
        notices: [],
        done: false,
    });
}

export type BackfillTurnParams = {
    userId: string;
    sessionId: string;
    /** The typed answer. Ignored when `dontRemember` is set. */
    answer?: string;
    /** The "I don't remember" button — a first-class answer, not an empty one. */
    dontRemember?: boolean;
    now?: Date;
};

/**
 * One turn: record the answer, capture what it contains, ask the next question.
 *
 * Capture and question generation run concurrently on purpose. The capture
 * promise writes drafts as soon as extraction returns, so the rail fills from
 * the SSE stream without waiting on the (slower, stronger) conversational
 * model — the 2s rail requirement in §9 is met by the ordering, not by luck.
 */
export async function runBackfillTurn(params: BackfillTurnParams): Promise<Result<BackfillTurn>> {
    const session = await getSessionTool({ userId: params.userId, sessionId: params.sessionId });
    if (!session.success) return err(session.error, session.code);
    const snapshot = session.data;

    if (snapshot.status === InterviewStatus.completed) {
        return err('That session is already finished', 'session_closed');
    }

    const answerText = params.dontRemember ? "I don't remember" : (params.answer ?? '').trim();
    if (!answerText) return err('Say something, or use "I don\'t remember"', 'invalid_input');

    const context = await getSubjectContextTool({
        userId: params.userId,
        subjectType: snapshot.subjectType,
        subjectId: snapshot.subjectId,
        subjectLabel: snapshot.subjectLabel,
    });
    if (!context.success) return err(context.error, context.code);

    const lastAgentTurn = [...snapshot.transcript].reverse().find((turn) => turn.role === 'agent');
    const previousPlan = decodeTopicKey(lastAgentTurn?.topic, snapshot);
    const questionAsked = lastAgentTurn?.content ?? '';

    const gaps = await getGraphGapsTool({
        userId: params.userId,
        winIds: [
            ...context.data.existingWins.map((win) => win.id),
            ...snapshot.captured.map((win) => win.winId),
        ],
    });
    if (!gaps.success) return err(gaps.error, gaps.code);

    // ── the two halves, concurrently
    const capturePromise = params.dontRemember
        ? Promise.resolve(null)
        : captureFromAnswer({
            userId: params.userId,
            sessionId: snapshot.id,
            context: context.data,
            answerText,
            question: questionAsked,
            questionIndex: snapshot.questionCount,
            previousPlan,
            recentWins: snapshot.captured,
            occurredAt: backfillOccurredAt(context.data, params.now),
        });

    const consecutiveVague =
        countTrailingVague(snapshot.transcript) + (isVagueAnswer(answerText) ? 1 : 0);

    const plan = planNextTopic({
        questionCount: snapshot.questionCount,
        askedTopics: snapshot.askedTopics,
        captured: snapshot.captured,
        gaps: gaps.data,
        context: context.data,
        lastAnswer: answerText,
        lastTopic: previousPlan?.topic,
        consecutiveVague,
    });

    const composePromise = plan
        ? composeTurn({
            userId: params.userId,
            sessionId: snapshot.id,
            plan,
            context: context.data,
            transcript: [
                ...snapshot.transcript,
                { role: 'user', content: answerText, at: new Date().toISOString() },
            ],
            answerText,
            reanchor: buildReanchor(snapshot, params.now),
            questionNumber: snapshot.questionCount + 1,
        })
        : Promise.resolve(null);

    const [captureResult, composed] = await Promise.all([capturePromise, composePromise]);

    const captured = captureResult?.captured ?? [];
    const notices = captureResult?.notices ?? [];
    const costUsd = (captureResult?.costUsd ?? 0) + (composed?.costUsd ?? 0);

    // Topics the answer already covered are marked asked, so a paragraph dump
    // skips the questions it just answered instead of re-asking them.
    const coveredKeys = (captureResult?.coveredTopics ?? [])
        .filter((topic) => topic !== 'anchor' && topic !== plan?.topic)
        .map((topic) => (topic === 'evidence' || topic === 'sweep' ? topic : `${topic}:done`));

    const persisted = await persistTurnTool({
        userId: params.userId,
        sessionId: snapshot.id,
        appendTurns: [
            {
                role: 'user',
                content: answerText,
                ...(params.dontRemember ? { dontRemember: true } : {}),
            },
            ...(composed && plan
                ? [{ role: 'agent' as const, content: composed.question, topic: plan.key }]
                : []),
        ],
        askTopics: [
            ...(plan ? [plan.key] : []),
            ...coveredKeys,
            ...(captureResult?.askTopics ?? []),
        ],
        questionCountDelta: composed ? 1 : 0,
        costUsdDelta: costUsd,
        ...(composed ? {} : { status: InterviewStatus.active }),
    });

    const questionCount = persisted.success ? persisted.data.questionCount : snapshot.questionCount;
    const railCaptured = persisted.success ? persisted.data.captured : captured;

    return ok({
        sessionId: snapshot.id,
        acknowledgement: composed?.acknowledgement ?? '',
        question: composed?.question ?? null,
        topic: plan?.topic ?? null,
        progress: estimateProgress(Math.max(0, questionCount - 1)),
        captured: railCaptured,
        notices,
        done: composed === null,
    });
}

/** Decode an `askedTopics` key back into the plan that produced it. */
function decodeTopicKey(key: string | undefined, snapshot: SessionSnapshot): TopicPlan | null {
    if (!key) return null;
    const [rawTopic, ...rest] = key.split(':');
    if (!(BACKFILL_TOPICS as readonly string[]).includes(rawTopic)) return null;
    const topic = rawTopic as BackfillTopic;

    if (topic === 'quantify' && rest[0] && rest[0] !== 'last' && rest[0] !== 'done') {
        const target = snapshot.captured.find((win) => win.winId === rest[0]);
        return { topic, key, targetWinId: rest[0], targetTitle: target?.title };
    }
    if (topic === 'quantify' && rest[0] === 'last') {
        return { topic, key, refersToLastAnswer: true };
    }
    if (topic === 'scope' && rest[0] && rest[0] !== 'done') {
        const target = snapshot.captured.find((win) => win.winId === rest[0]);
        return { topic, key, targetWinId: rest[0], targetTitle: target?.title };
    }
    if (topic === 'rarity' && rest[0] && rest[0] in WinCategory) {
        return { topic, key, targetCategory: rest[0] as WinCategory };
    }
    return { topic, key };
}

/**
 * Wind down and produce the closing screen's numbers.
 *
 * Every figure on that screen is counted from rows, never estimated. It is the
 * payoff for ten minutes of work and the moment the user decides whether to do
 * the next employer, so a rounded-up count would be the worst possible place to
 * be sloppy.
 */
export async function finishBackfill(params: {
    userId: string;
    sessionId: string;
    status?: 'completed' | 'paused' | 'abandoned';
}): Promise<Result<SessionSummary>> {
    return endSessionTool({
        userId: params.userId,
        sessionId: params.sessionId,
        status:
            params.status === 'paused'
                ? InterviewStatus.paused
                : params.status === 'abandoned'
                    ? InterviewStatus.abandoned
                    : InterviewStatus.completed,
    });
}

/** The closing screen's copy, from counted rows (PRD 07 §4). */
export function closingLines(summary: SessionSummary): string[] {
    const lines = [
        `You just recovered ${summary.winsCaptured} ${summary.winsCaptured === 1 ? 'win' : 'wins'} from ${summary.subjectLabel}.`,
    ];

    const detail: string[] = [];
    if (summary.quantifiedCount > 0) detail.push(`${summary.quantifiedCount} have hard numbers`);
    if (summary.crossTeamCount > 0) detail.push(`${summary.crossTeamCount} are cross-team`);
    if (detail.length > 0) lines.push(`${detail.join('. ')}.`);

    if (summary.priorHighlightCount > 0) {
        lines.push(
            `Before this, your ${summary.subjectLabel} record was ${summary.priorHighlightCount} resume ${summary.priorHighlightCount === 1 ? 'bullet' : 'bullets'}.`,
        );
    } else if (summary.priorWinCount === 0) {
        lines.push(`Before this, your ${summary.subjectLabel} record was empty.`);
    }

    return lines;
}
