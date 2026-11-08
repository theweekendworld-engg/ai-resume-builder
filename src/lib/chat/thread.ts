/**
 * The web thread on the client: pure helpers the chat screen uses.
 */

import type { ChatMessageView } from './types';

/**
 * Merge a fresh read of the thread into what is shown: messages appended by
 * work that finished later (the apply chain's resume and draft) slot in by
 * time. Messages already shown keep their state; their cards hold their own.
 * Returns `current` itself when nothing is new, so React skips the render.
 */
export function mergeMessages(current: readonly ChatMessageView[], fresh: readonly ChatMessageView[]): ChatMessageView[] {
    const known = new Set(current.map((message) => message.id));
    const added = fresh.filter((message) => !known.has(message.id));
    if (added.length === 0) return current as ChatMessageView[];
    return [...current, ...added].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
