/**
 * Month in Review — PRD 01 §6.4 / §8.2, design/02 §E, PRD 09 §3 and §4.
 *
 * Why this small file matters more than its size: the product's first large
 * payoff is the review packet at roughly month six. This is the ONLY scheduled
 * payoff before then, so it carries the entire first quarter of the user
 * relationship on its own (PRD 09 §3, decision D-C). Its copy quality is a
 * launch blocker, not polish.
 *
 * ── Division of labour between code and model ─────────────────────────────
 * The model writes ONE thing: the paragraph. Everything else — the headline,
 * the category-mix sentence, the honest observation, the receipt — is computed
 * here from real counts and rendered from hand-written copy.
 *
 * That split is deliberate and it is the safety property of this file:
 *
 *   - The headline and the mix sentence are arithmetic ("Four of eight wins
 *     were `improved`"). A model asked to do arithmetic it was handed will
 *     eventually get it wrong, and the numeric guard cannot catch a wrong
 *     spelled-out count that happens to appear elsewhere in the source.
 *   - The observation must be specific or absent (PRD 09 §4; the ticket is
 *     explicit: "If you can only produce a generic line, produce nothing").
 *     A rule set over real counts can guarantee that. A prompt cannot.
 *   - The paragraph is the artefact people screenshot. It is the one part that
 *     genuinely needs prose, so it is the one part that goes to a model — and
 *     it goes through `generateStructured` with the numeric guard, an entity
 *     check, and a digit check, all three of which fail closed.
 *
 * Fail-closed: a paragraph that references anything outside the supplied Wins,
 * or any digit absent from them, is DROPPED. A review with no paragraph is a
 * weaker artefact; a review with an invented one is a broken promise.
 */

import { z } from 'zod';
import { GroundState, WinCategory, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { generateStructured, type StructuredUsage } from '@/lib/ai/structured';
import { normalizeText } from '@/lib/ai/guard';
import { track } from '@/lib/track';
import { WIN_CLAIM_TYPE } from '@/services/winGraph';
import { safeTimeZone, zonedParts } from '@/lib/time';

// ═══════════════════════════════════════════════════════════════ constants

/** PRD 01 §6.4 — below this there is no month worth reviewing. */
export const MIN_WINS_FOR_REVIEW = 3;

/** PRD 09 §4 M1 — the receipt clause the reader actually feels. */
export const RECEIPT_AGE_DAYS = 90;

/** Category order used wherever the mix is rendered. Matches PRD 01 §7. */
export const REVIEW_CATEGORIES = Object.values(WinCategory) as WinCategory[];

/**
 * Categories a senior case is read for. A zero here is worth naming; a zero in
 * `learned` is not, which is why the mix sentence does not list every empty row.
 */
const SENIOR_SIGNAL_CATEGORIES: WinCategory[] = [
    // Ordered by how much an absence costs a level case: growing people cannot
    // be backfilled from anything, influence is nearly as hard, and leading is
    // the one a project history can still evidence.
    WinCategory.grew,
    WinCategory.influenced,
    WinCategory.led,
];

/**
 * Words that make a claim a *business* claim rather than a craft claim. Used
 * only to decide whether the "no business impact" observation is true — never
 * shown to a model, and never used to generate a number.
 */
const BUSINESS_IMPACT_TERMS = [
    'revenue', 'arr', 'mrr', 'gmv', 'bookings', 'sales', 'churn', 'retention',
    'conversion', 'signup', 'signups', 'sign-ups', 'activation', 'cost', 'costs',
    'spend', 'savings', 'saved', 'budget', 'margin', 'headcount', 'customer',
    'customers', 'user', 'users', 'mau', 'dau', 'subscriber', 'subscribers',
    'ticket', 'tickets', 'support volume', 'nps', 'sla',
];

// ═══════════════════════════════════════════════════════════════ periods

/** A calendar month. `month` is 1-12, never a JS 0-based month. */
export type Period = { year: number; month: number };

const PERIOD_KEY = /^(\d{4})-(\d{2})$/;

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/** `'2026-07'` -> `{ year: 2026, month: 7 }`. Null for anything else. */
export function parsePeriodKey(raw: string | null | undefined): Period | null {
    const match = PERIOD_KEY.exec(String(raw ?? '').trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    if (year < 1970 || year > 2999) return null;
    return { year, month };
}

export function formatPeriodKey(period: Period): string {
    return `${String(period.year).padStart(4, '0')}-${String(period.month).padStart(2, '0')}`;
}

/** `'July'` — the headline and the subject line both use the bare month. */
export function monthName(period: Period): string {
    return MONTH_NAMES[period.month - 1];
}

/** `'July 2026'` — the document's eyebrow. */
export function periodLabel(period: Period): string {
    return `${monthName(period)} ${period.year}`;
}

/** Half-open `[start, end)` in UTC. Wins carry a date, not a wall-clock time. */
export function periodRange(period: Period): { start: Date; end: Date } {
    return {
        start: new Date(Date.UTC(period.year, period.month - 1, 1)),
        end: new Date(Date.UTC(period.year, period.month, 1)),
    };
}

export function shiftPeriod(period: Period, months: number): Period {
    const zeroBased = period.year * 12 + (period.month - 1) + months;
    return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/** The month that just ended, in the user's own timezone. */
export function previousPeriodFor(tz: string, now: Date = new Date()): Period {
    const parts = zonedParts(now, safeTimeZone(tz));
    return shiftPeriod({ year: parts.year, month: parts.month }, -1);
}

/**
 * PRD 01 §6.4 — "sent on the 1st". The hour comes from the user's digest slot
 * so the only scheduled payoff of the first quarter does not land at 3am.
 */
export function isMonthInReviewDue(
    prefs: { timezone: string; digestHour: number },
    now: Date = new Date(),
): boolean {
    // Day-level for the daily tick (see isDigestDue): due in the first week
    // of the month, local time. The MonthlyReview unique keeps it to one per
    // month; the week lets a missed tick recover instead of losing the month.
    const parts = zonedParts(now, prefs.timezone);
    return parts.day <= 7;
}

// ═══════════════════════════════════════════════════════════════ loading

export type ReviewImpact = {
    metric: string;
    baseline: string | null;
    result: string | null;
    delta: string | null;
    scope: string | null;
    timeframe: string | null;
};

/** The only shape the composer ever sees. Nothing else may reach the model. */
export type ReviewWin = {
    id: string;
    title: string;
    narrative: string;
    category: WinCategory;
    occurredAt: Date;
    skills: string[];
    collaborators: string[];
    impact: ReviewImpact | null;
    hasEvidence: boolean;
};

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string');
}

/** Confirmed Wins that occurred inside the period, oldest first. */
export async function loadMonthWins(userId: string, period: Period): Promise<ReviewWin[]> {
    const { start, end } = periodRange(period);

    const wins = await prisma.win.findMany({
        where: {
            userId,
            status: WinStatus.confirmed,
            occurredAt: { gte: start, lt: end },
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        select: {
            id: true,
            title: true,
            narrative: true,
            category: true,
            occurredAt: true,
            skills: true,
            collaborators: true,
            impactMetricId: true,
        },
    });
    if (wins.length === 0) return [];

    const winIds = wins.map((win) => win.id);
    const metricIds = wins
        .map((win) => win.impactMetricId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

    const [metrics, groundedLinks] = await Promise.all([
        metricIds.length > 0
            ? prisma.impactMetric.findMany({
                where: { userId, id: { in: metricIds } },
                select: {
                    id: true, metric: true, baseline: true, result: true,
                    delta: true, scope: true, timeframe: true,
                },
            })
            : Promise.resolve([]),
        prisma.claimLink.findMany({
            where: {
                userId,
                claimType: WIN_CLAIM_TYPE,
                claimRefId: { in: winIds },
                groundState: GroundState.grounded,
            },
            select: { claimRefId: true },
            distinct: ['claimRefId'],
        }),
    ]);

    const metricById = new Map(metrics.map((metric) => [metric.id, metric]));
    const grounded = new Set(groundedLinks.map((link) => link.claimRefId));

    return wins.map((win) => {
        const metric = win.impactMetricId ? metricById.get(win.impactMetricId) : undefined;
        return {
            id: win.id,
            title: win.title,
            narrative: win.narrative,
            category: win.category,
            occurredAt: win.occurredAt,
            skills: asStringArray(win.skills),
            collaborators: asStringArray(win.collaborators),
            impact: metric
                ? {
                    metric: metric.metric,
                    baseline: metric.baseline,
                    result: metric.result,
                    delta: metric.delta,
                    scope: metric.scope,
                    timeframe: metric.timeframe,
                }
                : null,
            hasEvidence: grounded.has(win.id),
        };
    });
}

/** Whole-record counts for the receipt line (PRD 09 §4 M1). */
export type RecordTotals = { totalConfirmed: number; olderThan90Days: number };

export async function loadRecordTotals(
    userId: string,
    now: Date = new Date(),
): Promise<RecordTotals> {
    const cutoff = new Date(now.getTime() - RECEIPT_AGE_DAYS * 86_400_000);
    const [totalConfirmed, olderThan90Days] = await Promise.all([
        prisma.win.count({ where: { userId, status: WinStatus.confirmed } }),
        prisma.win.count({
            where: { userId, status: WinStatus.confirmed, occurredAt: { lt: cutoff } },
        }),
    ]);
    return { totalConfirmed, olderThan90Days };
}

// ═══════════════════════════════════════════════════════════════ counting

const METRIC_DIGIT = /\d/;

/**
 * "with hard numbers", as the headline claims it.
 *
 * A structured `ImpactMetric` counts. So does a digit sitting in the Win's own
 * words — someone who wrote "cut it from 800ms to 180ms" in the narrative has a
 * hard number whether or not the quantify prompt was ever answered. A bare year
 * does not count, which is why the check runs on the metric fields rather than
 * on `occurredAt`.
 */
export function hasHardNumbers(win: ReviewWin): boolean {
    if (win.impact) {
        const fields = [
            win.impact.metric, win.impact.baseline, win.impact.result,
            win.impact.delta, win.impact.scope, win.impact.timeframe,
        ];
        if (fields.some((field) => field && METRIC_DIGIT.test(field))) return true;
    }
    return METRIC_DIGIT.test(win.title) || METRIC_DIGIT.test(win.narrative);
}

export type CategoryCount = { category: WinCategory; count: number };

export function countByCategory(wins: ReviewWin[]): CategoryCount[] {
    const counts = new Map<WinCategory, number>();
    for (const win of wins) counts.set(win.category, (counts.get(win.category) ?? 0) + 1);
    return REVIEW_CATEGORIES.map((category) => ({ category, count: counts.get(category) ?? 0 }));
}

function countOf(mix: CategoryCount[], category: WinCategory): number {
    return mix.find((entry) => entry.category === category)?.count ?? 0;
}

/**
 * The rows the mix actually shows: everything with a count, plus exactly ONE
 * absent senior signal — the same one `buildMixSentence` names, so the bars and
 * the sentence never disagree.
 *
 * One empty row is a diagnosis. Six are a dashboard, and two are already an
 * argument the reader has to arbitrate.
 */
export function visibleMixRows<T extends { category: string; count: number }>(mix: T[]): T[] {
    const absent = SENIOR_SIGNAL_CATEGORIES.map(String).find((category) =>
        mix.some((row) => row.category === category && row.count === 0),
    );
    return mix.filter((row) => row.count > 0 || row.category === absent);
}

// ═══════════════════════════════════════════════════════════════ copy: numbers

const SPELLED = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen', 'twenty',
];

/** Prose spells small numbers; the headline and the receipt use digits. */
export function spellOut(value: number): string {
    if (!Number.isInteger(value) || value < 0 || value > 20) return String(value);
    return SPELLED[value];
}

function capitalize(text: string): string {
    return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return count === 1 ? singular : pluralForm;
}

// ═══════════════════════════════════════════════════════════════ copy: blocks

/**
 * Block 1 — "8 wins, 5 with hard numbers" (design/02 §E).
 * Arithmetic, therefore never a model's job.
 */
export function buildHeadline(winCount: number, quantifiedCount: number): string {
    return `${winCount} ${plural(winCount, 'win')}, ${quantifiedCount} with hard numbers`;
}

/** The email subject (design/02 §K2): "July: 8 wins, 5 with numbers". */
export function buildSubject(period: Period, winCount: number, quantifiedCount: number): string {
    return `${monthName(period)}: ${winCount} ${plural(winCount, 'win')}, ${quantifiedCount} with numbers`;
}

/**
 * Block 3 — the sentence under the mix bars.
 *
 * "Four of eight wins were `improved`. Only one was `influenced`, and none were
 * `grew`." Only the leader, the singletons, and an absent senior signal are
 * named: listing all eight rows is a dashboard, and the bars already do it.
 */
export function buildMixSentence(mix: CategoryCount[], winCount: number): string {
    if (winCount === 0) return '';

    const ranked = [...mix]
        .filter((entry) => entry.count > 0)
        .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
    if (ranked.length === 0) return '';

    const top = ranked[0];
    const lead =
        top.count === 1
            ? `${capitalize(spellOut(top.count))} of ${spellOut(winCount)} ${plural(winCount, 'win')} was \`${top.category}\`.`
            : `${capitalize(spellOut(top.count))} of ${spellOut(winCount)} ${plural(winCount, 'win')} were \`${top.category}\`.`;

    const clauses: string[] = [];
    for (const entry of ranked.slice(1)) {
        if (entry.count !== 1 || clauses.length >= 2) continue;
        clauses.push(`only one was \`${entry.category}\``);
    }
    const absentSignal = SENIOR_SIGNAL_CATEGORIES.find((category) => countOf(mix, category) === 0);
    if (absentSignal && clauses.length < 3) clauses.push(`none were \`${absentSignal}\``);

    if (clauses.length === 0) return lead;

    const tail =
        clauses.length === 1
            ? clauses[0]
            : `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`;
    return `${lead} ${capitalize(tail)}.`;
}

/**
 * Block 4 — "WORTH KNOWING".
 *
 * A priority-ordered rule set over real counts. Every branch names a specific,
 * checkable fact about THIS month. There is no default branch and no
 * encouragement: when nothing here is true, the block does not render.
 */
export type ObservationKind =
    | 'mostly_unquantified'
    | 'no_business_impact'
    | 'no_influence'
    | 'no_growth'
    | 'single_category';

export type Observation = { kind: ObservationKind; text: string };

function mentionsBusinessImpact(win: ReviewWin): boolean {
    const haystack = normalizeText(
        [
            win.title,
            win.narrative,
            win.impact?.metric ?? '',
            win.impact?.scope ?? '',
            win.impact?.baseline ?? '',
            win.impact?.result ?? '',
            win.impact?.delta ?? '',
        ].join(' '),
    );
    return BUSINESS_IMPACT_TERMS.some((term) => {
        const index = haystack.indexOf(term);
        if (index === -1) return false;
        const before = haystack[index - 1];
        const after = haystack[index + term.length];
        const isBoundary = (char: string | undefined) => char === undefined || !/[a-z0-9]/.test(char);
        return isBoundary(before) && isBoundary(after);
    });
}

export function selectObservation(wins: ReviewWin[], mix: CategoryCount[]): Observation | null {
    const total = wins.length;
    if (total === 0) return null;

    const quantified = wins.filter(hasHardNumbers).length;

    // 1. Nothing is measured. That is the more basic problem than what it measures.
    if (quantified * 2 < total) {
        if (quantified === 0) {
            return {
                kind: 'mostly_unquantified',
                text:
                    `None of your ${total} ${plural(total, 'win')} this month carries a number. ` +
                    `Every one of them is a claim a reader has to take on your word.`,
            };
        }
        const remainder = total - quantified;
        return {
            kind: 'mostly_unquantified',
            text:
                `Only ${quantified} of ${total} wins ${quantified === 1 ? 'carries' : 'carry'} a number. ` +
                `The other ${remainder} ${remainder === 1 ? 'is a claim' : 'are claims'} a reader has to ` +
                `take on your word.`,
        };
    }

    // 2. Measured, but nothing the business would recognise as its own metric.
    if (!wins.some(mentionsBusinessImpact)) {
        return {
            kind: 'no_business_impact',
            text:
                `None of your wins this month mention business impact — revenue, cost, or user ` +
                `numbers. For a Staff-level case that's usually required.`,
        };
    }

    // 3. All craft, no leverage.
    if (countOf(mix, WinCategory.influenced) === 0 && countOf(mix, WinCategory.led) === 0) {
        return {
            kind: 'no_influence',
            text:
                `All ${total} ${plural(total, 'win')} this month are work you did yourself. None of them ` +
                `record changing what someone else did, and that is the half of a senior case nobody ` +
                `can reconstruct later.`,
        };
    }

    // 4. Growing people is the section that cannot be backfilled from a commit log.
    if (countOf(mix, WinCategory.grew) === 0 && total >= 5) {
        return {
            kind: 'no_growth',
            text:
                `Nothing this month sits under \`grew\`. Review committees read that section for ` +
                `evidence you made someone else better, and it is the one thing a commit history ` +
                `cannot show.`,
        };
    }

    // 5. One kind of work, all month.
    const top = [...mix].sort((a, b) => b.count - a.count)[0];
    if (total >= 4 && top && top.count * 10 >= total * 7) {
        return {
            kind: 'single_category',
            text:
                `${capitalize(spellOut(top.count))} of ${spellOut(total)} wins are \`${top.category}\`. ` +
                `A month that reads as one kind of work is hard to build a level case from.`,
        };
    }

    return null;
}

/**
 * The value receipt (PRD 09 §4 M1).
 *
 * States what the review drew on, and how much of the record is now old enough
 * that the reader knows they would have lost it. That last clause is the one
 * that lands, so it is not optional when it is true.
 */
export function buildReceipt(input: {
    period: Period;
    winCount: number;
    withEvidence: number;
    totals: RecordTotals;
}): string {
    const { period, winCount, withEvidence, totals } = input;
    const drew =
        `This review drew on ${winCount} ${plural(winCount, 'win')} from ${monthName(period)}, ` +
        `${withEvidence} with evidence.`;

    if (totals.totalConfirmed === 0) return drew;

    if (totals.olderThan90Days === 0) {
        return `${drew} Your record now holds ${totals.totalConfirmed} ${plural(totals.totalConfirmed, 'win')}, all from the last ${RECEIPT_AGE_DAYS} days.`;
    }

    return (
        `${drew} Your record now holds ${totals.totalConfirmed} ${plural(totals.totalConfirmed, 'win')} — ` +
        `${totals.olderThan90Days} of them from more than ${RECEIPT_AGE_DAYS} days ago.`
    );
}

// ═══════════════════════════════════════════════════════════ grounding checks

/**
 * Everything the model is allowed to draw on, as one blob.
 *
 * This is simultaneously the numeric guard's `sourceText`, the entity check's
 * vocabulary, and the digit check's whitelist — one definition, so the three
 * cannot disagree about what "the supplied Wins" means.
 */
export function buildSourceText(wins: ReviewWin[], facts: string[] = []): string {
    const lines: string[] = [];
    for (const win of wins) {
        lines.push(win.title);
        if (win.narrative) lines.push(win.narrative);
        lines.push(win.category);
        if (win.skills.length > 0) lines.push(win.skills.join(', '));
        if (win.collaborators.length > 0) lines.push(win.collaborators.join(', '));
        if (win.impact) {
            lines.push(
                [
                    win.impact.metric,
                    win.impact.baseline,
                    win.impact.result,
                    win.impact.delta,
                    win.impact.scope,
                    win.impact.timeframe,
                ]
                    .filter((value): value is string => Boolean(value))
                    .join(' '),
            );
        }
    }
    return [...lines, ...facts].join('\n');
}

/**
 * Capitalized words that carry no reference — they are grammar, not entities.
 * Kept tight: an over-broad list is a hole in the check.
 */
const NON_ENTITY_WORDS = new Set([
    'a', 'an', 'and', 'the', 'this', 'that', 'these', 'those', 'it', 'its',
    'you', 'your', 'yours', 'we', 'our', 'they', 'their', 'he', 'she', 'his',
    'her', 'i', 'my', 'but', 'for', 'nor', 'or', 'so', 'yet', 'if', 'then',
    'than', 'when', 'while', 'after', 'before', 'both', 'each', 'every',
    'none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'no', 'not', 'only', 'also', 'most', 'much', 'more', 'less',
    'in', 'on', 'at', 'by', 'to', 'of', 'with', 'from', 'as', 'into', 'over',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'q1', 'q2', 'q3', 'q4',
    ...REVIEW_CATEGORIES.map((category) => String(category)),
]);

/**
 * Words a sentence may legitimately open with. A capitalized token at the start
 * of a sentence is grammar if it is in here and a referring expression if it is
 * not — which is how "Priya reviewed it" is caught and "The work landed" is not.
 *
 * The list is generous on function words and deliberately thin on content words:
 * a false positive here costs one paragraph, a false negative ships a fabricated
 * name. It errs the same way the numeric guard does.
 */
const SENTENCE_OPENERS = new Set([
    'about', 'above', 'across', 'again', 'against', 'all', 'almost', 'along',
    'already', 'although', 'always', 'among', 'another', 'any', 'anything',
    'around', 'away', 'back', 'because', 'been', 'behind', 'being', 'below',
    'beneath', 'beside', 'besides', 'better', 'between', 'beyond', 'building',
    'built', 'came', 'can', 'changing', 'come', 'coming', 'could', 'cutting',
    'despite', 'did', 'do', 'does', 'doing', 'done', 'down', 'due', 'during',
    'either', 'else', 'enough', 'even', 'ever', 'everything', 'except', 'far',
    'few', 'fewer', 'finally', 'first', 'fixing', 'following', 'further',
    'getting', 'given', 'going', 'gone', 'got', 'had', 'has', 'have', 'having',
    'here', 'how', 'however', 'instead', 'is', 'it', 'its', 'itself', 'just',
    'keeping', 'known', 'last', 'later', 'leading', 'least', 'left', 'letting',
    'like', 'likewise', 'little', 'long', 'looking', 'made', 'making', 'many',
    'may', 'meanwhile', 'might', 'moving', 'must', 'near', 'nearly', 'neither',
    'never', 'next', 'nothing', 'now', 'off', 'often', 'once', 'onto', 'other',
    'others', 'otherwise', 'out', 'outside', 'over', 'own', 'past', 'perhaps',
    'putting', 'rather', 'removing', 'replacing', 'right', 'running', 'said',
    'same', 'says', 'second', 'seen', 'several', 'shipping', 'should', 'similarly',
    'since', 'small', 'some', 'something', 'sometimes', 'soon', 'still', 'such',
    'taking', 'that', 'their', 'them', 'themselves', 'there', 'therefore',
    'they', 'though', 'through', 'throughout', 'thus', 'together', 'too', 'took',
    'toward', 'towards', 'turning', 'under', 'unless', 'until', 'up', 'upon',
    'used', 'using', 'very', 'was', 'were', 'what', 'whatever', 'whenever',
    'where', 'whether', 'which', 'who', 'whom', 'whose', 'why', 'will', 'with',
    'within', 'without', 'work', 'working', 'would', 'writing', 'yet', 'you',
    'your',
]);

/** Splits on whitespace, keeping the punctuation that makes an identifier. */
const TOKEN_SPLIT = /[\s"'“”‘’()[\]{}<>,;:!?]+/;

function stripEdgePunctuation(token: string): string {
    return token.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[.·—–-]+$/u, '');
}

/**
 * Referring expressions in a piece of generated prose.
 *
 * Three families, chosen because each one can only have come from somewhere:
 *   - compound identifiers: `patronus/api`, `checkout-service`, `PR#482`
 *   - internal capitals / digits+letters: `GraphQL`, `p95`, `v2`
 *   - mid-sentence capitalized words: `Stripe`, `Kafka`
 *
 * A capitalized word at the START of a sentence is grammar when it is an
 * ordinary opener and an entity otherwise — "The work landed" is not a
 * reference, "Priya reviewed it" is.
 */
export function extractEntities(text: string): string[] {
    const found: string[] = [];
    const sentences = String(text ?? '').split(/(?<=[.!?])\s+/);

    for (const sentence of sentences) {
        const tokens = sentence.split(TOKEN_SPLIT).filter(Boolean);
        tokens.forEach((rawToken, index) => {
            const token = stripEdgePunctuation(rawToken);
            if (token.length < 2) return;
            const lowered = token.toLowerCase();
            if (NON_ENTITY_WORDS.has(lowered)) return;

            const compound = /^[\p{L}\p{N}]+(?:[/_.#@-][\p{L}\p{N}]+)+$/u.test(token);
            const internalCaps = /\p{Ll}\p{Lu}/u.test(token);
            const alnumMix = /\p{L}/u.test(token) && /\p{N}/u.test(token);
            const capitalized =
                /^\p{Lu}/u.test(token) && (index > 0 || !SENTENCE_OPENERS.has(lowered));

            if (compound || internalCaps || alnumMix || capitalized) found.push(token);
        });
    }

    return [...new Set(found)];
}

export type GroundingCheck = { ok: boolean; unsupported: string[] };

/**
 * PRD 01 §13 R1.4 — "paragraph references only supplied Wins (automated entity
 * check)". Every referring expression in the output must appear in the source.
 */
export function checkEntityGrounding(output: string, sourceText: string): GroundingCheck {
    const haystack = normalizeText(sourceText);
    const unsupported = extractEntities(output).filter(
        (entity) => !haystack.includes(normalizeText(entity)),
    );
    return { ok: unsupported.length === 0, unsupported };
}

const DIGIT_RUN = /\d[\d,]*(?:\.\d+)?/g;

/**
 * No digit-bearing figure may appear in the output unless the same figure
 * appears in the source. Deliberately cruder than the numeric guard and run in
 * addition to it: the guard reasons about units and can be argued with, this
 * one cannot.
 */
export function checkDigitGrounding(output: string, sourceText: string): GroundingCheck {
    const haystack = normalizeText(sourceText).replace(/,/g, '');
    const unsupported: string[] = [];

    for (const match of normalizeText(output).matchAll(DIGIT_RUN)) {
        const literal = match[0].replace(/,/g, '');
        if (!haystack.includes(literal)) unsupported.push(match[0]);
    }

    return { ok: unsupported.length === 0, unsupported: [...new Set(unsupported)] };
}

// ═══════════════════════════════════════════════════════════════ the model

export const MonthReviewSchema = z.object({
    /**
     * PRD 01 §6.4 block 2. Length-capped per §8.2 — this is a paragraph someone
     * screenshots, not a summary of everything they did.
     */
    paragraph: z.string().min(1).max(700),
});

export type MonthReviewOutput = z.infer<typeof MonthReviewSchema>;

/**
 * `VoiceProfile.styleDescriptor` (PRD 01 §8.2) has no model in the schema today.
 * The parameter exists so the call site does not change when it lands; until
 * then the default is plain declarative prose, and never enthusiasm.
 */
export const DEFAULT_STYLE_DESCRIPTOR =
    'plain declarative prose: short sentences, concrete nouns, no enthusiasm';

export const COMPOSE_MONTH_IN_REVIEW_SYSTEM = [
    'You write one paragraph describing a month of a working professional\'s recorded',
    'accomplishments. It is read once, by them, and it is the thing they may screenshot.',
    '',
    'RULES. Each one is a hard constraint, not a preference.',
    '',
    '1. ONLY THE SUPPLIED WINS EXIST. Every project, system, team, person, tool, company and',
    '   metric you name must appear verbatim in the wins below. You may not add context you',
    '   "know" about the technology, the industry, or what work like this usually involves.',
    '2. NEVER INVENT A NUMBER. Every digit you write must appear in the wins. Do not compute,',
    '   round, total, average or derive figures — a percentage calculated from two supplied',
    '   numbers is still a fabricated number. If a claim needs a figure you do not have, make',
    '   the claim without one.',
    '3. DO NOT CONGRATULATE. No "great month", no "impressive", no "well done", no exclamation',
    '   marks. You may state that a piece of work mattered and why, in the same tone a competent',
    '   colleague would use. Praise the outcome if it deserves it; never praise the person, and',
    '   never praise them for having used a tool.',
    '4. FIND THE THROUGH-LINE. The paragraph is worth reading only if it says something the',
    '   list of wins does not. Name the shape of the month — what kind of work it was, what',
    '   changed because of it — and lead with the one or two wins that carry the most weight.',
    '   Do not enumerate every win.',
    '5. NO SUMMARY OF THE SUMMARY. Do not open with "In July you..." or "This month you...".',
    '   Start with the substance.',
    '',
    'FORM: 2 to 4 sentences, at most 700 characters, one paragraph, second person ("you"),',
    'past tense. No headings, no bullets, no markdown.',
].join('\n');

export function buildComposePrompt(input: {
    period: Period;
    wins: ReviewWin[];
    facts: string[];
    styleDescriptor?: string | null;
}): string {
    const lines: string[] = [
        `Month under review: ${periodLabel(input.period)}.`,
        `Voice: ${input.styleDescriptor?.trim() || DEFAULT_STYLE_DESCRIPTOR}.`,
        '',
        'THE WINS. This is the only source of facts. Nothing outside this block exists.',
        '"""',
    ];

    input.wins.forEach((win, index) => {
        lines.push(`${index + 1}. [${win.category}] ${win.title}`);
        if (win.narrative) lines.push(`   ${win.narrative}`);
        if (win.impact) {
            const parts = [
                `metric: ${win.impact.metric}`,
                win.impact.baseline ? `from ${win.impact.baseline}` : null,
                win.impact.result ? `to ${win.impact.result}` : null,
                win.impact.delta ? `delta ${win.impact.delta}` : null,
                win.impact.scope ? `scope ${win.impact.scope}` : null,
                win.impact.timeframe ? `over ${win.impact.timeframe}` : null,
            ].filter(Boolean);
            lines.push(`   impact — ${parts.join(', ')}`);
        }
        if (win.collaborators.length > 0) lines.push(`   with: ${win.collaborators.join(', ')}`);
    });

    lines.push('"""', '');

    if (input.facts.length > 0) {
        lines.push(
            'COUNTS already computed for you. Use them only if they help the prose; the headline',
            'and the category breakdown are rendered separately, so do not restate them.',
            ...input.facts.map((fact) => `- ${fact}`),
            '',
        );
    }

    lines.push('Write the paragraph.');
    return lines.join('\n');
}

/**
 * Praise the data cannot earn, plus the punctuation that always signals it.
 *
 * Mirrors `BANNED_TOKENS` in `reviewPacket.ts` and extends it with the
 * congratulation vocabulary specific to this surface. Product rule from
 * PRD 08 §8.3 and design/00 §2: congratulate outcomes, never usage. The
 * counter is the reward.
 */
const BANNED_TONE = [
    'exceptional', 'world-class', 'world class', 'rockstar', 'ninja',
    'unparalleled', 'best-in-class', 'best in class', 'incredible', 'amazing',
    'great job', 'great month', 'great work', 'well done', 'nice work',
    'nice going', 'congratulations', 'congrats', 'fantastic', 'awesome',
    'impressive', 'keep it up', 'keep up the', 'proud of', 'crushed it',
    'smashed it', 'killing it', 'stellar', 'phenomenal', 'outstanding',
];

/**
 * PRD 08 §8.3 — no exclamation marks, no congratulating usage.
 *
 * This existed only as prompt rule 3 until a journey test proved a compliant-
 * looking paragraph could carry it straight through: the entity and digit
 * checks look at facts, not at tone, so "You had a great month! ..." passed
 * both and would have been emailed verbatim. The packet path enforces its
 * equivalent in code; this is the missing counterpart.
 *
 * Fail-closed like the others: a paragraph that trips this is dropped, not
 * edited. Rewriting model output to sound acceptable is how a tone rule turns
 * into a tone illusion.
 */
export function checkTone(output: string): GroundingCheck {
    const haystack = output.toLowerCase();
    const unsupported: string[] = [];

    if (output.includes('!')) unsupported.push('!');
    for (const token of BANNED_TONE) {
        if (haystack.includes(token)) unsupported.push(token);
    }

    return { ok: unsupported.length === 0, unsupported };
}

/** Why a paragraph was withheld. Grouped by this in the drop-rate query. */
export type ParagraphDropReason =
    | 'entity'
    | 'digit'
    | 'entity_and_digit'
    | 'tone'
    | 'guard_stripped';

export function dropReason(input: {
    entityCheck: GroundingCheck;
    digitCheck: GroundingCheck;
    toneCheck?: GroundingCheck;
    paragraph: string;
}): ParagraphDropReason {
    if (!input.entityCheck.ok && !input.digitCheck.ok) return 'entity_and_digit';
    if (!input.entityCheck.ok) return 'entity';
    if (!input.digitCheck.ok) return 'digit';
    // After the factual checks: a paragraph can be entirely true and still
    // wrong in tone, and that is a different failure worth counting apart.
    if (input.toneCheck && !input.toneCheck.ok) return 'tone';
    // Both checks pass on an empty string: the numeric guard already blanked it.
    return 'guard_stripped';
}

export type ComposeResult = {
    paragraph: string | null;
    /** True when a check stripped the paragraph, or the guard stripped a figure. */
    degraded: boolean;
    /** Set only when the paragraph was withheld. Null on the happy path. */
    dropped: ParagraphDropReason | null;
    entityCheck: GroundingCheck;
    digitCheck: GroundingCheck;
    toneCheck: GroundingCheck;
    usage: StructuredUsage | null;
};

/**
 * PRD 01 §8.2. The only path to a model in this feature.
 *
 * Three independent checks, all fail-closed:
 *   - the numeric guard inside `generateStructured` (units-aware, retries once)
 *   - the entity check (nothing referenced that was not supplied)
 *   - the digit check (no figure whose digits are absent from the source)
 *
 * A paragraph that fails either of the latter two is discarded rather than
 * repaired. Everything else in the review is computed, so the document still
 * renders — one block lighter and entirely true.
 */
export async function composeMonthInReview(input: {
    userId: string;
    period: Period;
    wins: ReviewWin[];
    facts?: string[];
    styleDescriptor?: string | null;
}): Promise<ComposeResult> {
    const facts = input.facts ?? [];
    const sourceText = buildSourceText(input.wins, facts);

    const result = await generateStructured({
        task: 'monthReview',
        feature: 'month_in_review',
        userId: input.userId,
        schema: MonthReviewSchema,
        system: COMPOSE_MONTH_IN_REVIEW_SYSTEM,
        prompt: buildComposePrompt({
            period: input.period,
            wins: input.wins,
            facts,
            styleDescriptor: input.styleDescriptor,
        }),
        guard: { sourceText, fields: ['paragraph'] },
    });

    const paragraph = result.data.paragraph.trim();
    const entityCheck = checkEntityGrounding(paragraph, sourceText);
    const digitCheck = checkDigitGrounding(paragraph, sourceText);
    const toneCheck = checkTone(paragraph);
    const grounded =
        entityCheck.ok && digitCheck.ok && toneCheck.ok && paragraph.length > 0;

    if (!grounded) {
        // The one place this feature can quietly degrade: everything else still
        // renders, so a dropped paragraph looks like a thin month rather than a
        // failure. It has to be countable from day one, not inferred later.
        const reason = dropReason({ entityCheck, digitCheck, toneCheck, paragraph });
        console.warn('[monthInReview] paragraph dropped: ungrounded', {
            userId: input.userId,
            period: formatPeriodKey(input.period),
            reason,
            entities: entityCheck.unsupported,
            digits: digitCheck.unsupported,
            tone: toneCheck.unsupported,
        });
        await track(input.userId, 'ai_guard_violation', {
            feature: 'month_in_review',
            task: 'monthReview',
            surface: 'paragraph',
            period: formatPeriodKey(input.period),
            reason,
            // Bounded: these are model output, and this row is read by humans.
            unsupportedEntities: entityCheck.unsupported.slice(0, 10),
            unsupportedDigits: digitCheck.unsupported.slice(0, 10),
            unsupportedTone: toneCheck.unsupported.slice(0, 10),
        });
    }

    return {
        paragraph: grounded ? paragraph : null,
        degraded: !grounded || result.degraded,
        dropped: grounded ? null : dropReason({ entityCheck, digitCheck, toneCheck, paragraph }),
        entityCheck,
        digitCheck,
        toneCheck,
        usage: result.usage,
    };
}

// ═══════════════════════════════════════════════════════════════ assembly

export type MonthInReviewWin = {
    id: string;
    title: string;
    category: WinCategory;
    occurredAt: Date;
    hasHardNumbers: boolean;
};

/** The whole document, in the order design/02 §E renders it. */
export type MonthInReview = {
    periodKey: string;
    period: Period;
    /** "July 2026" */
    label: string;
    /** "8 wins, 5 with hard numbers" */
    headline: string;
    subject: string;
    winCount: number;
    quantifiedCount: number;
    withEvidence: number;
    mix: CategoryCount[];
    mixSentence: string;
    paragraph: string | null;
    observation: Observation | null;
    receipt: string;
    wins: MonthInReviewWin[];
    /** True when a block was withheld because it could not be grounded. */
    degraded: boolean;
    /** Why the paragraph is missing, when it is. Null when there was one. */
    dropped: ParagraphDropReason | 'compose_failed' | null;
    costUsd: number;
};

/** The counts handed to the model as context. Also part of the guard source. */
export function buildFacts(input: {
    winCount: number;
    quantifiedCount: number;
    mix: CategoryCount[];
}): string[] {
    const facts = [
        `${input.winCount} confirmed ${plural(input.winCount, 'win')} this month`,
        `${input.quantifiedCount} of them carry a hard number`,
    ];
    for (const entry of input.mix) {
        if (entry.count > 0) facts.push(`${entry.count} ${entry.category}`);
    }
    return facts;
}

/**
 * Build the document. Pure assembly over `loadMonthWins` + `composeMonthInReview`,
 * so the same function serves the job handler and the web view and the two can
 * never disagree about what July said.
 */
export async function buildMonthInReview(input: {
    userId: string;
    period: Period;
    now?: Date;
    /** Skip the model call — used by the web view when there is nothing to spend on. */
    compose?: boolean;
    styleDescriptor?: string | null;
}): Promise<MonthInReview | null> {
    const now = input.now ?? new Date();
    const wins = await loadMonthWins(input.userId, input.period);
    if (wins.length === 0) return null;

    const mix = countByCategory(wins);
    const quantifiedCount = wins.filter(hasHardNumbers).length;
    const withEvidence = wins.filter((win) => win.hasEvidence).length;
    const facts = buildFacts({ winCount: wins.length, quantifiedCount, mix });
    const totals = await loadRecordTotals(input.userId, now);

    let paragraph: string | null = null;
    let degraded = false;
    let dropped: MonthInReview['dropped'] = null;
    let costUsd = 0;

    if (input.compose !== false) {
        try {
            const composed = await composeMonthInReview({
                userId: input.userId,
                period: input.period,
                wins,
                facts,
                styleDescriptor: input.styleDescriptor,
            });
            paragraph = composed.paragraph;
            degraded = composed.degraded;
            dropped = composed.dropped;
            costUsd = composed.usage?.costUsd ?? 0;
        } catch (error: unknown) {
            // Fail down, never up: the computed blocks are still true and still
            // worth sending. A model outage must not cost the user their month.
            console.error('[monthInReview] compose failed', {
                userId: input.userId,
                period: formatPeriodKey(input.period),
                error: error instanceof Error ? error.message : String(error),
            });
            degraded = true;
            dropped = 'compose_failed';
        }
    }

    return {
        periodKey: formatPeriodKey(input.period),
        period: input.period,
        label: periodLabel(input.period),
        headline: buildHeadline(wins.length, quantifiedCount),
        subject: buildSubject(input.period, wins.length, quantifiedCount),
        winCount: wins.length,
        quantifiedCount,
        withEvidence,
        mix,
        mixSentence: buildMixSentence(mix, wins.length),
        paragraph,
        observation: selectObservation(wins, mix),
        receipt: buildReceipt({
            period: input.period,
            winCount: wins.length,
            withEvidence,
            totals,
        }),
        wins: wins.map((win) => ({
            id: win.id,
            title: win.title,
            category: win.category,
            occurredAt: win.occurredAt,
            hasHardNumbers: hasHardNumbers(win),
        })),
        degraded,
        dropped,
        costUsd,
    };
}

// ═══════════════════════════════════════════════════════════ persistence

/**
 * `MonthlyReview` is the durable record of what a month said.
 *
 * Two properties matter and both are load-bearing:
 *   - It is written when the review is COMPOSED, not when it is sent. A month
 *     that was composed but never emailed (opted out, no address, a provider
 *     outage) still renders its paragraph on the web.
 *   - `@@unique([userId, period])` makes the write itself idempotent. It is a
 *     third safety layer under the job dedupe key and the `EmailSend` lookup,
 *     not a replacement for either: neither of those two can be inferred from a
 *     row that exists, because composing is not sending.
 */
export type PersistedMonthInReview = {
    period: string;
    headline: string;
    paragraph: string | null;
    observation: string | null;
    mixSentence: string | null;
    receipt: string;
    winIds: string[];
    winCount: number;
    quantifiedCount: number;
    sentAt: Date | null;
    degraded: boolean;
};

/**
 * Upsert the composed review. `sentAt` is deliberately absent from the update
 * branch: a recompose must never un-send a review that already went out.
 */
export async function persistMonthInReview(
    userId: string,
    review: MonthInReview,
): Promise<void> {
    const fields = {
        headline: review.headline,
        paragraph: review.paragraph,
        observation: review.observation?.text ?? null,
        mixSentence: review.mixSentence || null,
        receipt: review.receipt,
        winIds: review.wins.map((win) => win.id),
        winCount: review.winCount,
        quantifiedCount: review.quantifiedCount,
        degraded: review.degraded,
    };

    await prisma.monthlyReview.upsert({
        where: { userId_period: { userId, period: review.periodKey } },
        create: { userId, period: review.periodKey, ...fields },
        update: fields,
    });
}

/** Stamps the send. Separate from the upsert because only a real send sets it. */
export async function markMonthInReviewSent(
    userId: string,
    periodKey: string,
    at: Date = new Date(),
): Promise<void> {
    await prisma.monthlyReview.updateMany({
        // Conditional on `sentAt` still being null, so a retry cannot rewrite
        // the timestamp of the send that actually reached the user.
        where: { userId, period: periodKey, sentAt: null },
        data: { sentAt: at },
    });
}

export async function loadPersistedReview(
    userId: string,
    periodKey: string,
): Promise<PersistedMonthInReview | null> {
    const row = await prisma.monthlyReview.findUnique({
        where: { userId_period: { userId, period: periodKey } },
        select: {
            period: true,
            headline: true,
            paragraph: true,
            observation: true,
            mixSentence: true,
            receipt: true,
            winIds: true,
            winCount: true,
            quantifiedCount: true,
            sentAt: true,
            degraded: true,
        },
    });
    if (!row) return null;
    return { ...row, winIds: asStringArray(row.winIds) };
}

/**
 * The per-category counts behind a persisted review.
 *
 * Derived from the stored `winIds` rather than from the month, so the bars keep
 * matching the sentence even after the user edits or archives something. A win
 * deleted since simply drops out — the alternative is a chart of rows that no
 * longer exist.
 */
export async function mixForWinIds(
    userId: string,
    winIds: string[],
): Promise<CategoryCount[]> {
    if (winIds.length === 0) return REVIEW_CATEGORIES.map((category) => ({ category, count: 0 }));

    const grouped = await prisma.win.groupBy({
        by: ['category'],
        where: { userId, id: { in: winIds } },
        _count: { _all: true },
    });
    const counts = new Map(grouped.map((row) => [row.category, row._count._all]));
    return REVIEW_CATEGORIES.map((category) => ({ category, count: counts.get(category) ?? 0 }));
}
