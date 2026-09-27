/**
 * The Work Log's client-side decisions (audit 2026-09-27, §G/§H), as pure
 * functions: what an undo writes, how one bulk call reports per-row results,
 * which Win a duplicate points at, and what a source error tells the user.
 */

import { describe, expect, test } from 'bun:test';
import { settleBulkConfirm } from '@/components/patterns/review-queue';
import { describeSourceError } from '@/components/sources/sources-screen';
import { mergeTargetFromCode } from './adapt';
import { planQueueUndo } from './queueActions';

describe('planQueueUndo: every undo writes its inverse', () => {
    test('undoing a confirm un-confirms (rule 5 reversal), not just the screen', () => {
        expect(planQueueUndo({ winId: 'w1', action: 'confirm' })).toEqual({ kind: 'unconfirm', winId: 'w1' });
    });
    test('undoing a dismiss restores the draft', () => {
        expect(planQueueUndo({ winId: 'w1', action: 'dismiss' })).toEqual({ kind: 'restore', winId: 'w1' });
    });
    test('undoing a recategorise writes the previous category back', () => {
        expect(planQueueUndo({ winId: 'w1', action: 'recategorize', previousCategory: 'led' })).toEqual({
            kind: 'update',
            winId: 'w1',
            patch: { category: 'led' },
        });
    });
    test('undoing an edit writes the previous title back', () => {
        expect(planQueueUndo({ winId: 'w1', action: 'edit', previousTitle: 'Old title' })).toEqual({
            kind: 'update',
            winId: 'w1',
            patch: { title: 'Old title' },
        });
    });
    test('an undo without its previous value writes nothing rather than blanking the field', () => {
        expect(planQueueUndo({ winId: 'w1', action: 'edit' })).toEqual({ kind: 'none' });
        expect(planQueueUndo({ winId: 'w1', action: 'recategorize' })).toEqual({ kind: 'none' });
    });
});

describe('settleBulkConfirm: one "Confirm all" call, per-row results', () => {
    test('failed ids reject with their error; the rest fulfil; order is kept', () => {
        const results = settleBulkConfirm(['a', 'b', 'c'], [{ winId: 'b', error: 'Win not found' }]);
        expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
        const rejected = results[1] as PromiseRejectedResult;
        expect((rejected.reason as Error).message).toBe('Win not found');
    });
    test('no failures → all fulfilled', () => {
        expect(settleBulkConfirm(['a', 'b'], []).every((r) => r.status === 'fulfilled')).toBe(true);
    });
});

describe('mergeTargetFromCode', () => {
    test('reads the existing Win from the duplicate error code', () => {
        expect(mergeTargetFromCode('merge_proposal:win_123')).toBe('win_123');
    });
    test('anything else is not a duplicate', () => {
        expect(mergeTargetFromCode('ai_unavailable')).toBeNull();
        expect(mergeTargetFromCode(undefined)).toBeNull();
        expect(mergeTargetFromCode('merge_proposal:')).toBeNull();
    });
});

describe('describeSourceError: errors come with the way out', () => {
    test('GitHub not linked → steps plus a link to Account', () => {
        const described = describeSourceError('Connect your GitHub account in Account settings first', 'github_not_linked', 'x');
        expect(described.action).toEqual({ href: '/account', label: 'Open Account' });
        expect(described.message).toContain('Connected accounts');
    });
    test('rate limited → says sources sync daily, not that "the next one runs automatically"', () => {
        const described = describeSourceError('Already synced in the last hour — the next one runs automatically', 'rate_limited', 'x');
        expect(described.message).toContain('once a day');
        expect(described.message).not.toContain('runs automatically');
    });
    test('other errors pass through', () => {
        expect(describeSourceError('Boom', 'error', 'fallback')).toEqual({ message: 'Boom', action: null });
        expect(describeSourceError(undefined, undefined, 'fallback')).toEqual({ message: 'fallback', action: null });
    });
});
