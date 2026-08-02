/**
 * The quality gate — PRD 02 §12, run over the labelled corpus.
 *
 * Runs the real pipeline (noise layers → grouping → §4.3 confidence → the
 * drafting call → the numeric guard → sanitizers) against
 * `src/__fixtures__/github`, substituting only the model. Everything that makes
 * a product decision is production code; the stub decides only what the model
 * would have said.
 *
 * Three numbers come out, and two of them are binary:
 *   - `botDrafts`      MUST be empty
 *   - `fabrications`   MUST be empty
 *   - `acceptRate`     target ≥0.60
 */

import { __testing as structuredTesting } from '@/lib/ai/structured';
import { GITHUB_CORPUS, caseByExternalId, type CorpusCase } from '@/__fixtures__/github';
import { createGithubAdapter } from '../github/adapter';
import { buildCandidateContext, draftCandidate, groundingSource, auditDraftQuantities, scoreCandidate } from '../drafting';
import { shouldDraftAtConfidence } from '../confidence';
import { EMPTY_SOURCE_CONFIG, type RawSignal, type SignalGroup } from '../types';
import { createStubDrafter, type StubMode } from './stubDrafter';

export type CorpusOutcome =
    | { kind: 'filtered'; ids: string[]; rule: string; layer: number }
    | { kind: 'below_threshold'; ids: string[]; confidence: number }
    | { kind: 'declined'; ids: string[]; reason: string; confidence: number }
    | {
          kind: 'drafted';
          ids: string[];
          confidence: number;
          title: string;
          narrative: string;
          quantified: boolean;
          degraded: boolean;
          acceptable: boolean;
          fabricated: Array<{ path: string; raw: string }>;
      };

export type CorpusReport = {
    cases: number;
    groups: number;
    outcomes: CorpusOutcome[];
    /** Corpus ids of bot-authored cases that reached a draft. Must be empty. */
    botDrafts: string[];
    /** Unsupported quantities that survived into a draft. Must be empty. */
    fabrications: Array<{ id: string; path: string; raw: string }>;
    drafted: number;
    filtered: number;
    declined: number;
    belowThreshold: number;
    /** Drafts whose primary case is labelled `acceptable`, over all drafts. */
    acceptRate: number;
    /** Labelled-draft cases that actually produced one. */
    recall: number;
    /** Drafts where the guard had to strip something. */
    degradedDrafts: number;
    costUsd: number;
};

/** The adapter with its network half removed — we only need the pure methods. */
const adapter = createGithubAdapter({
    createApi: () => {
        throw new Error('the corpus run never pulls');
    },
});

function idsFor(group: SignalGroup, index: Map<string, CorpusCase>): string[] {
    return group.signals.map((signal) => index.get(signal.externalId)?.id ?? signal.externalId);
}

function primaryCase(group: SignalGroup, index: Map<string, CorpusCase>): CorpusCase | undefined {
    return index.get(group.primary.externalId);
}

export type CorpusRunOptions = {
    mode?: StubMode;
    /** Fabrications survive the corrective retry, forcing the strip path. */
    stubborn?: boolean;
    userId?: string;
};

export async function runCorpus(options: CorpusRunOptions = {}): Promise<CorpusReport> {
    const index = caseByExternalId();
    const userId = options.userId ?? 'corpus-user';

    structuredTesting.setObjectRunner(createStubDrafter({ mode: options.mode, stubborn: options.stubborn }));
    // Never touch the database from an eval run.
    structuredTesting.setUsageLogger(async () => {});

    try {
        const outcomes: CorpusOutcome[] = [];
        const kept: RawSignal[] = [];

        // ── layers 1–3
        for (const entry of GITHUB_CORPUS) {
            const verdict = adapter.isNoise(entry.signal, EMPTY_SOURCE_CONFIG);
            if (verdict.noise) {
                outcomes.push({ kind: 'filtered', ids: [entry.id], rule: verdict.rule, layer: verdict.layer });
                continue;
            }
            kept.push(entry.signal);
        }

        // ── grouping (§4.1)
        const groups = adapter.group(kept);

        let costUsd = 0;
        for (const group of groups) {
            const context = buildCandidateContext(group, 'Senior Backend Engineer at Acme');
            const confidence = scoreCandidate(context).score;
            const ids = idsFor(group, index);

            if (!shouldDraftAtConfidence(confidence)) {
                outcomes.push({ kind: 'below_threshold', ids, confidence });
                continue;
            }

            const outcome = await draftCandidate({ userId, context, confidence });
            costUsd += outcome.usage?.costUsd ?? 0;

            if (!outcome.drafted) {
                outcomes.push({ kind: 'declined', ids, reason: outcome.reason, confidence });
                continue;
            }

            const sourceText = groundingSource(context);
            const violations = auditDraftQuantities(outcome.draft, sourceText);

            outcomes.push({
                kind: 'drafted',
                ids,
                confidence,
                title: outcome.draft.title,
                narrative: outcome.draft.narrative,
                quantified: outcome.draft.quantified,
                degraded: outcome.degraded,
                acceptable: primaryCase(group, index)?.label.acceptable ?? false,
                fabricated: violations.map((violation) => ({ path: violation.path, raw: violation.quantity.raw })),
            });
        }

        return summarize(outcomes, GITHUB_CORPUS, groups.length, costUsd);
    } finally {
        structuredTesting.reset();
    }
}

function summarize(
    outcomes: CorpusOutcome[],
    corpus: readonly CorpusCase[],
    groupCount: number,
    costUsd: number,
): CorpusReport {
    const byId = new Map(corpus.map((entry) => [entry.id, entry]));
    const drafts = outcomes.filter((outcome): outcome is Extract<CorpusOutcome, { kind: 'drafted' }> =>
        outcome.kind === 'drafted',
    );

    const botDrafts: string[] = [];
    const fabrications: Array<{ id: string; path: string; raw: string }> = [];
    let accepted = 0;

    for (const draft of drafts) {
        if (draft.acceptable) accepted += 1;
        for (const id of draft.ids) {
            if (byId.get(id)?.label.bot) botDrafts.push(id);
        }
        for (const violation of draft.fabricated) {
            fabrications.push({ id: draft.ids[0], path: violation.path, raw: violation.raw });
        }
    }

    const draftedIds = new Set(drafts.flatMap((draft) => draft.ids));
    const expectedDrafts = corpus.filter((entry) => entry.label.verdict === 'draft');
    const recalled = expectedDrafts.filter((entry) => draftedIds.has(entry.id)).length;

    return {
        cases: corpus.length,
        groups: groupCount,
        outcomes,
        botDrafts,
        fabrications,
        drafted: drafts.length,
        filtered: outcomes.filter((outcome) => outcome.kind === 'filtered').length,
        declined: outcomes.filter((outcome) => outcome.kind === 'declined').length,
        belowThreshold: outcomes.filter((outcome) => outcome.kind === 'below_threshold').length,
        acceptRate: drafts.length === 0 ? 0 : accepted / drafts.length,
        recall: expectedDrafts.length === 0 ? 1 : recalled / expectedDrafts.length,
        degradedDrafts: drafts.filter((draft) => draft.degraded).length,
        costUsd,
    };
}

/** Human-readable summary, printed by the corpus test so the numbers are visible in CI. */
export function formatCorpusReport(report: CorpusReport): string {
    const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
    return [
        `corpus: ${report.cases} cases -> ${report.groups} candidates`,
        `  filtered (noise rules): ${report.filtered}`,
        `  below confidence floor: ${report.belowThreshold}`,
        `  declined by the model:  ${report.declined}`,
        `  drafted:                ${report.drafted}  (${report.degradedDrafts} degraded by the guard)`,
        `  accept-rate proxy:      ${pct(report.acceptRate)}  (target 60%)`,
        `  recall on labelled wins:${pct(report.recall)}`,
        `  bot drafts:             ${report.botDrafts.length}  (must be 0)`,
        `  fabricated quantities:  ${report.fabrications.length}  (must be 0)`,
    ].join('\n');
}
