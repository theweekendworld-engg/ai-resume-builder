import { describe, expect, test } from 'bun:test';
import { draftChains, latestChain, revisionLabel } from './history';
import { REVISION_INSTRUCTIONS } from './revisions';
import type { DraftView } from './types';

let n = 0;
function draft(over: Partial<DraftView> = {}): DraftView {
    n += 1;
    return {
        id: `d${n}`, version: 1, runId: 'run', workspaceId: null, format: 'email', target: 'recruiter', toEmail: 'jobs@x.com',
        subject: 'Application', body: `body ${n}`, createdAt: `2026-11-07T10:0${n % 10}:00.000Z`, parentId: null, instruction: null, ...over,
    };
}

describe('draft chains', () => {
    test('each revision follows its parent; chains stay apart', () => {
        const v1 = draft({ createdAt: '2026-11-07T10:00:00.000Z' });
        const v2 = draft({ version: 2, parentId: v1.id, instruction: REVISION_INSTRUCTIONS.shorter, createdAt: '2026-11-07T10:01:00.000Z' });
        const v3 = draft({ version: 3, parentId: v2.id, instruction: 'add IIT Delhi', createdAt: '2026-11-07T10:02:00.000Z' });
        const note = draft({ format: 'linkedin_note', createdAt: '2026-11-07T10:03:00.000Z' });
        const chains = draftChains([v3, note, v1, v2]);
        expect(chains.map((chain) => chain.map((d) => d.version))).toEqual([[1, 2, 3], [1]]);
        expect(latestChain([v3, note, v1, v2], 'email').map((d) => d.id)).toEqual([v1.id, v2.id, v3.id]);
    });

    test('the most recently touched email chain is the one shown', () => {
        const old = draft({ createdAt: '2026-11-01T10:00:00.000Z' });
        const fresh = draft({ createdAt: '2026-11-06T10:00:00.000Z' });
        const oldRevised = draft({ version: 2, parentId: old.id, createdAt: '2026-11-07T09:00:00.000Z' });
        expect(latestChain([old, fresh, oldRevised], 'email').map((d) => d.id)).toEqual([old.id, oldRevised.id]);
        expect(latestChain([], 'email')).toEqual([]);
    });

    test('labels say how each version came to be', () => {
        expect(revisionLabel({ version: 1, instruction: null })).toBe('First draft');
        expect(revisionLabel({ version: 2, instruction: REVISION_INSTRUCTIONS.shorter })).toBe('Shorter');
        expect(revisionLabel({ version: 3, instruction: REVISION_INSTRUCTIONS.stronger })).toBe('Stronger');
        expect(revisionLabel({ version: 4, instruction: 'mention my MCP work' })).toBe('“mention my MCP work”');
    });
});
