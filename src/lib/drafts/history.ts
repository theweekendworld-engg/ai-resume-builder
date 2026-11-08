/**
 * A run's drafts as version chains: v1, then each revision of it. Pure.
 *
 * One run can hold more than one chain (an email started in Telegram, a
 * LinkedIn note from the web), and each revision points at the version it
 * edited (`parentId`). The web page shows one chain at a time, so this
 * groups the rows by their root and picks the chain to show.
 */

import type { DraftView } from '@/lib/drafts/types';
import { REVISION_INSTRUCTIONS } from '@/lib/drafts/revisions';

/** Chains keyed by root id, each oldest version first. Orphans start their own chain. */
export function draftChains(drafts: readonly DraftView[]): DraftView[][] {
    const byId = new Map(drafts.map((draft) => [draft.id, draft]));
    const rootOf = (draft: DraftView): string => {
        let current = draft;
        const seen = new Set<string>();
        while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
            seen.add(current.id);
            current = byId.get(current.parentId)!;
        }
        return current.id;
    };
    const chains = new Map<string, DraftView[]>();
    for (const draft of drafts) {
        const root = rootOf(draft);
        chains.set(root, [...(chains.get(root) ?? []), draft]);
    }
    return [...chains.values()].map((chain) =>
        [...chain].sort((a, b) => a.version - b.version || a.createdAt.localeCompare(b.createdAt)));
}

/**
 * The chain to show for one format (the apply email), most recently touched
 * first. Empty when there is none.
 */
export function latestChain(drafts: readonly DraftView[], format: DraftView['format']): DraftView[] {
    const chains = draftChains(drafts.filter((draft) => draft.format === format));
    const newest = (chain: DraftView[]) => chain.reduce((max, draft) => (draft.createdAt > max ? draft.createdAt : max), '');
    return chains.sort((a, b) => newest(b).localeCompare(newest(a)))[0] ?? [];
}

/** How a version came to be, in a word or a quote: "First draft", "Shorter", "“add IIT Delhi”". */
export function revisionLabel(draft: Pick<DraftView, 'instruction' | 'version'>): string {
    const instruction = draft.instruction?.trim();
    if (!instruction) return draft.version === 1 ? 'First draft' : 'Edited';
    if (instruction === REVISION_INSTRUCTIONS.shorter) return 'Shorter';
    if (instruction === REVISION_INSTRUCTIONS.stronger) return 'Stronger';
    const short = instruction.length > 60 ? `${instruction.slice(0, 59).trimEnd()}…` : instruction;
    return `“${short}”`;
}
