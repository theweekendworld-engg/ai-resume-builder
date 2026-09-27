import type { WinCategoryValue } from '@/components/patterns';

/**
 * What an undo in the review queue must write back.
 *
 * The queue's undo used to change only the screen: a confirmed Win stayed
 * confirmed, a dismissed one stayed dismissed, edited titles stayed edited.
 * Pure so the mapping is testable without a DOM.
 */
export type QueueUndoEntry = {
    winId: string;
    action: 'confirm' | 'dismiss' | 'recategorize' | 'edit';
    previousCategory?: WinCategoryValue;
    previousTitle?: string;
};

export type QueueUndoWrite =
    | { kind: 'unconfirm'; winId: string }
    | { kind: 'restore'; winId: string }
    | { kind: 'update'; winId: string; patch: { category?: WinCategoryValue; title?: string } }
    /** Nothing to restore (an undo entry without its previous value). */
    | { kind: 'none' };

export function planQueueUndo(entry: QueueUndoEntry): QueueUndoWrite {
    switch (entry.action) {
        case 'confirm':
            return { kind: 'unconfirm', winId: entry.winId };
        case 'dismiss':
            return { kind: 'restore', winId: entry.winId };
        case 'recategorize':
            return entry.previousCategory
                ? { kind: 'update', winId: entry.winId, patch: { category: entry.previousCategory } }
                : { kind: 'none' };
        case 'edit':
            return entry.previousTitle
                ? { kind: 'update', winId: entry.winId, patch: { title: entry.previousTitle } }
                : { kind: 'none' };
    }
}
