/**
 * A deterministic stand-in for the drafting model.
 *
 * ── Why this exists rather than a recorded model transcript ───────────────
 * The §12 launch gate is "zero drafted Wins contain a number absent from the PR
 * title, body or linked issue". A gate that cannot fail proves nothing: if the
 * thing producing drafts never invents a figure, "zero fabrications" is a fact
 * about the fixture, not about the guard.
 *
 * So the stub has two modes. `honest` follows the prompt rules mechanically and
 * establishes the baseline (what the pipeline does when the model behaves).
 * `adversarial` invents exactly the figures a real model reaches for — a
 * percentage derived from two source numbers, a round dollar amount, "millions
 * of users", the file count from the metadata — and the corpus run asserts that
 * none of them survive into a Win.
 *
 * `stubborn` decides whether the fabrication survives the guard's corrective
 * retry, so both the retry path and the strip path are exercised.
 *
 * This file is test infrastructure. It is under `src/` rather than in a test
 * file because the corpus report is a build artefact the team reads, not just
 * an assertion.
 */

import { WinCategory, WinSensitivity } from '@prisma/client';
import type { ObjectRunner } from '@/lib/ai/structured';
import { extractQuantities } from '@/lib/ai/guard';
import type { CaptureDraft } from '../drafting';
import { parsePromptBlocks, type PromptBlock } from './promptParser';

export type StubMode = 'honest' | 'adversarial';

export type StubOptions = {
    mode?: StubMode;
    /** When true the fabrication survives the corrective retry and must be stripped. */
    stubborn?: boolean;
};

const CORRECTION_MARKER = 'Your previous response contained quantities';

// ───────────────────────────────────────────────────── small language bits

const SKILL_VOCABULARY: Array<[RegExp, string]> = [
    [/\bpostgres|\bsql\b|\bindex\b|\bdatabase\b/i, 'PostgreSQL'],
    [/\bredis\b/i, 'Redis'],
    [/\bgraphql\b/i, 'GraphQL'],
    [/\btypescript\b|\bstrict mode\b/i, 'TypeScript'],
    [/\bkubernetes\b|\bpods?\b|\bcluster\b/i, 'Kubernetes'],
    [/\bterraform\b/i, 'Terraform'],
    [/\bstripe\b|\bpayments?\b|\bbilling\b/i, 'Payments'],
    [/\bqueue\b|\bworker\b|\bbackground job\b/i, 'Distributed systems'],
    [/\bsecurity\b|\bssrf\b|\bcsrf\b|\btoken\b|\bcredential\b/i, 'Application security'],
    [/\baccessib|\ba11y\b|\bscreen reader\b/i, 'Accessibility'],
    [/\blatency\b|\bp95\b|\bp99\b|\bperformance\b/i, 'Performance engineering'],
    [/\bmigration\b|\bmigrate\b/i, 'Data migration'],
    [/\bslo\b|\balert\b|\bobservab|\bmonitoring\b/i, 'Observability'],
    [/\bsearch\b|\bbm25\b|\brelevance\b/i, 'Search'],
    [/\bapi\b|\brest\b|\bendpoint\b/i, 'API design'],
];

const CONFIDENTIAL_HINTS =
    /\b(incident|ssrf|csrf|vulnerab|disclosure|unannounced|unreleased|contractor|offboard|renewal|northwind|lighthouse)\b/i;

const FIXED_CATEGORY: Array<[RegExp, WinCategory]> = [
    [/\b(incident|outage|bug|regression|off-by-one|patch|vulnerab|ssrf|declin)\b/i, WinCategory.fixed],
    [/\b(cost|saving|spend|\$|expire|right-size)\b/i, WinCategory.saved],
    [/\b(latency|p95|p99|faster|throughput|reduce|reduced|optimi[sz]|speed)\b/i, WinCategory.improved],
    [/\b(migrat|refactor|replace|rewrite|consolidat|split|move)\b/i, WinCategory.improved],
    [/\b(document|guide|runbook|onboard|mentor)\b/i, WinCategory.influenced],
];

function firstSentences(text: string, count: number): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    const sentences = normalized.split(/(?<=[.!?])\s+/).slice(0, count);
    return sentences.join(' ').trim();
}

function pickCategory(blocks: PromptBlock[], haystack: string): WinCategory {
    if (blocks.some((block) => block.role === 'reviewer')) return WinCategory.influenced;
    for (const [pattern, category] of FIXED_CATEGORY) if (pattern.test(haystack)) return category;
    return WinCategory.shipped;
}

function pickSkills(haystack: string): string[] {
    const out: string[] = [];
    for (const [pattern, skill] of SKILL_VOCABULARY) {
        if (pattern.test(haystack) && !out.includes(skill)) out.push(skill);
        if (out.length >= 6) break;
    }
    return out;
}

function pickSensitivity(blocks: PromptBlock[], haystack: string): WinSensitivity {
    const anyPrivate = blocks.some((block) => block.repoPrivate);
    if (anyPrivate && CONFIDENTIAL_HINTS.test(haystack)) return WinSensitivity.confidential;
    if (anyPrivate) return WinSensitivity.internal_only;
    return WinSensitivity.shareable;
}

/** Strip a "(3/6)" or "(step 2)" suffix so a grouped effort gets one title. */
function normalizeGroupTitle(title: string): string {
    return title
        .replace(/\s*\((?:step\s*)?\d+\s*(?:\/\s*\d+)?\)\s*$/i, '')
        .replace(/\s*[—-]\s*part\s*\d+\s*$/i, '')
        .trim();
}

// ───────────────────────────────────────────────────── the honest drafter

/** The grounding source AS THE STUB SEES IT — titles, bodies, issues, reviews. */
function groundedText(blocks: PromptBlock[]): string {
    return blocks
        .flatMap((block) => [block.title, block.body, block.linkedIssueTitle, block.linkedIssueBody, block.reviewBody])
        .filter(Boolean)
        .join('\n');
}

function honestDraft(blocks: PromptBlock[]): CaptureDraft {
    const primary =
        [...blocks].sort((a, b) => b.body.length + (b.linkedIssueTitle ? 400 : 0) - (a.body.length + (a.linkedIssueTitle ? 400 : 0)))[0] ??
        blocks[0];
    const isReview = blocks.some((block) => block.role === 'reviewer');
    const source = groundedText(blocks);

    // Rule 1: no words, no Win.
    const bodyText = blocks.map((block) => block.body).join(' ').trim();
    const issueText = blocks.map((block) => `${block.linkedIssueTitle} ${block.linkedIssueBody}`).join(' ').trim();
    const reviewText = blocks.map((block) => block.reviewBody).join(' ').trim();
    const substance = isReview ? reviewText : `${bodyText} ${issueText}`.trim();

    if (substance.length < 40) {
        return {
            title: '',
            narrative: '',
            category: WinCategory.shipped,
            skills: [],
            collaborators: [],
            suggestedSensitivity: WinSensitivity.shareable,
            quantified: false,
            impact: null,
            quantifyPrompt: null,
            shouldDraft: false,
            dismissReason: 'no context',
        };
    }

    const title = isReview
        ? `Pushed back on the design of "${normalizeGroupTitle(primary.title)}"`
        : normalizeGroupTitle(primary.title);

    const narrative = isReview
        ? firstSentences(reviewText, 3)
        : [firstSentences(bodyText, 3), primary.linkedIssueTitle ? `Context: ${primary.linkedIssueTitle}.` : '']
              .filter(Boolean)
              .join(' ');

    // Rule 3: a figure only when the source states one, and only as written.
    const quantity = extractQuantities(substance, 'lenient').find(
        (candidate) => candidate.kind !== 'version' && candidate.kind !== 'date' && candidate.kind !== 'year',
    );

    return {
        title,
        narrative,
        category: pickCategory(blocks, source),
        skills: pickSkills(source),
        collaborators: [],
        suggestedSensitivity: pickSensitivity(blocks, source),
        quantified: Boolean(quantity),
        impact: quantity
            ? {
                  metric: normalizeGroupTitle(primary.title).toLowerCase().slice(0, 80),
                  baseline: null,
                  result: null,
                  delta: quantity.raw,
                  scope: null,
                  timeframe: null,
              }
            : null,
        quantifyPrompt: quantity ? null : 'What changed, in numbers?',
        shouldDraft: true,
        dismissReason: null,
    };
}

// ───────────────────────────────────────────────────── the adversarial one

/**
 * The four fabrications a real model actually commits, in rough order of how
 * often we have seen them:
 *   1. a percentage derived from two source numbers ("800ms -> 180ms" ⇒ "77%")
 *   2. the diff size quoted as an outcome ("across 47 files")
 *   3. an invented scope ("for millions of users")
 *   4. a round money figure nobody stated ("$12,000 a year")
 */
function fabricate(draft: CaptureDraft, blocks: PromptBlock[]): CaptureDraft {
    if (!draft.shouldDraft) return draft;
    const filesChanged = Math.max(...blocks.map((block) => block.filesChanged), 0);

    // Half the cases put the invented figure in the title as well as the body.
    // The two produce different — and both correct — end states, and a corpus
    // that only exercised one of them would leave the other unproven:
    //   title poisoned  -> the whole draft is rejected (a Win with no title is
    //                      not a degraded Win, it is not a Win)
    //   body poisoned   -> the draft ships with the figure stripped, degraded
    //                      but true, which is the path that protects a resume.
    const poisonTitle = (draft.title.length + filesChanged) % 2 === 0;

    return {
        ...draft,
        title: poisonTitle ? `${draft.title} — 77% faster` : draft.title,
        narrative: [
            draft.narrative,
            `The change touched ${filesChanged} files and cut response time by 77%, saving roughly $12,000 a year for millions of users.`,
        ]
            .filter(Boolean)
            .join(' '),
        quantified: true,
        impact: {
            metric: draft.impact?.metric ?? 'response time',
            baseline: '800ms',
            result: '180ms',
            delta: '77%',
            scope: 'millions of users',
            timeframe: null,
        },
    };
}

// ───────────────────────────────────────────────────── the runner

/**
 * An `ObjectRunner` for `__testing.setObjectRunner`. No network, no tokens, no
 * variance — the same corpus produces the same report on every machine, which
 * is the only way a "60% accept rate" number is worth quoting.
 */
export function createStubDrafter(options: StubOptions = {}): ObjectRunner {
    const mode = options.mode ?? 'honest';
    const stubborn = options.stubborn ?? false;

    return async ({ prompt }) => {
        const isCorrection = prompt.includes(CORRECTION_MARKER);
        const blocks = parsePromptBlocks(prompt);
        const honest = honestDraft(blocks);

        const shouldFabricate = mode === 'adversarial' && (!isCorrection || stubborn);
        const object = shouldFabricate ? fabricate(honest, blocks) : honest;

        return {
            object,
            // Realistic enough for the cost roll-up to be non-zero and comparable.
            inputTokens: Math.ceil(prompt.length / 4),
            outputTokens: 220,
        };
    };
}
