/**
 * The labelled GitHub corpus, and the helpers the eval harness reads it with.
 */

export { CORPUS_NOW, CORPUS_LOGIN, issue, pr, review } from './types';
export type { CorpusCase, CorpusLabel, CorpusVerdict, IssueSpec, PrSpec, ReviewSpec } from './types';
export { CORPUS_SECTIONS, GITHUB_CORPUS } from './corpus';

import { GITHUB_CORPUS } from './corpus';
import type { CorpusCase } from './types';
import type { RawSignal } from '@/lib/capture/types';

export function corpusById(id: string): CorpusCase {
    const found = GITHUB_CORPUS.find((entry) => entry.id === id);
    if (!found) throw new Error(`no corpus case "${id}"`);
    return found;
}

export function corpusSignals(): RawSignal[] {
    return GITHUB_CORPUS.map((entry) => entry.signal);
}

export function botCases(): CorpusCase[] {
    return GITHUB_CORPUS.filter((entry) => entry.label.bot);
}

export function expectedDraftCases(): CorpusCase[] {
    return GITHUB_CORPUS.filter((entry) => entry.label.verdict === 'draft');
}

export function expectedNoiseCases(): CorpusCase[] {
    return GITHUB_CORPUS.filter((entry) => entry.label.verdict === 'noise');
}

/** Cases that belong to the same multi-PR effort (§4.1). */
export function groupedCases(key: string): CorpusCase[] {
    return GITHUB_CORPUS.filter((entry) => entry.groupWith === key);
}

/** Index from `RawSignal.externalId` back to the labelled case. */
export function caseByExternalId(): Map<string, CorpusCase> {
    return new Map(GITHUB_CORPUS.map((entry) => [entry.signal.externalId, entry]));
}
