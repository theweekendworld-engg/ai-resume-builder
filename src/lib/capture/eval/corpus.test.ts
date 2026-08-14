/**
 * THE QUALITY GATE — PRD 02 §12.
 *
 * This file is the acceptance test for the whole connector. If it goes red the
 * feature does not ship, regardless of what the unit tests say: two of its
 * assertions are binary launch gates and the third is the metric the v3 thesis
 * rests on.
 *
 * The report is printed rather than merely asserted, because "60% accept rate"
 * is a number a human has to look at each time the prompt or the formula moves.
 */

import { describe, expect, test } from 'bun:test';
import { formatCorpusReport, runCorpus } from './corpusRun';
import { GITHUB_CORPUS, botCases, expectedDraftCases } from '@/__fixtures__/github';

describe('the labelled corpus', () => {
    test('is at least 100 cases and covers every shape the gate cares about', () => {
        expect(GITHUB_CORPUS.length).toBeGreaterThanOrEqual(100);
        expect(botCases().length).toBeGreaterThanOrEqual(10);
        expect(expectedDraftCases().length).toBeGreaterThanOrEqual(40);

        // Ids must be unique — the report indexes by them.
        const ids = new Set(GITHUB_CORPUS.map((entry) => entry.id));
        expect(ids.size).toBe(GITHUB_CORPUS.length);

        // External ids must be unique — they are the idempotency key.
        const externalIds = new Set(GITHUB_CORPUS.map((entry) => entry.signal.externalId));
        expect(externalIds.size).toBe(GITHUB_CORPUS.length);
    });
});

describe('§12 — the launch gates', () => {
    test('zero bot PRs produce a draft, and the accept-rate proxy clears 60%', async () => {
        const report = await runCorpus({ mode: 'honest' });
        console.log(`\n[honest model]\n${formatCorpusReport(report)}\n`);

        // ── gate 1, binary
        expect(report.botDrafts).toEqual([]);

        // ── gate 2, binary
        expect(report.fabrications).toEqual([]);

        // ── gate 3, the metric
        expect(report.acceptRate).toBeGreaterThanOrEqual(0.6);

        // Recall matters too: precision is trivial to buy by drafting nothing.
        expect(report.recall).toBeGreaterThanOrEqual(0.75);
        expect(report.drafted).toBeGreaterThan(30);
    });

    test('a model that fabricates cannot get a number past the guard', async () => {
        // The corrective retry is allowed to fix it — this is the common path.
        const retried = await runCorpus({ mode: 'adversarial', stubborn: false });
        console.log(`\n[adversarial model, corrective retry works]\n${formatCorpusReport(retried)}\n`);
        expect(retried.fabrications).toEqual([]);
        expect(retried.botDrafts).toEqual([]);

        // And when it does not: the guard strips, and the draft ships degraded
        // rather than false. This is the path that actually protects a resume.
        const stubborn = await runCorpus({ mode: 'adversarial', stubborn: true });
        console.log(`\n[adversarial model, refuses to correct]\n${formatCorpusReport(stubborn)}\n`);
        expect(stubborn.fabrications).toEqual([]);
        expect(stubborn.botDrafts).toEqual([]);
        // Proof the strip path actually ran, rather than the fabrication never
        // having been produced.
        expect(stubborn.degradedDrafts).toBeGreaterThan(0);
    });

    test('a review that only says LGTM produces no draft', async () => {
        const report = await runCorpus({ mode: 'honest' });
        const lgtm = report.outcomes.find((outcome) => outcome.ids.includes('rev-lgtm'));
        expect(lgtm?.kind).toBe('filtered');
        expect(lgtm && 'rule' in lgtm ? lgtm.rule : null).toBe('review_not_substantive');
    });

    test('six PRs to the same directory within 5 days produce one candidate', async () => {
        const report = await runCorpus({ mode: 'honest' });
        const grouped = report.outcomes.find((outcome) => outcome.ids.includes('group-payments-1'));
        expect(grouped).toBeDefined();
        expect(grouped?.ids.length).toBe(6);
        expect(grouped?.kind).toBe('drafted');
    });

    test('every filtered case matches the noise rule its label predicted', async () => {
        const report = await runCorpus({ mode: 'honest' });
        const byId = new Map(GITHUB_CORPUS.map((entry) => [entry.id, entry]));
        const mismatches: string[] = [];

        for (const outcome of report.outcomes) {
            if (outcome.kind !== 'filtered') continue;
            const expected = byId.get(outcome.ids[0])?.label.rule;
            if (expected && expected !== outcome.rule) {
                mismatches.push(`${outcome.ids[0]}: expected ${expected}, got ${outcome.rule}`);
            }
        }

        expect(mismatches).toEqual([]);
    });

    test('nothing labelled noise reaches the model', async () => {
        const report = await runCorpus({ mode: 'honest' });
        const byId = new Map(GITHUB_CORPUS.map((entry) => [entry.id, entry]));
        const leaked = report.outcomes
            .filter((outcome) => outcome.kind === 'drafted')
            .flatMap((outcome) => outcome.ids)
            .filter((id) => byId.get(id)?.label.verdict === 'noise');

        expect(leaked).toEqual([]);
    });
});
