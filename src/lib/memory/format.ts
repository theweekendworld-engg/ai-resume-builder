/**
 * How memories read: the "used what you told me" note, the capture cleanup,
 * and the one-line-per-memory index a prompt sees. Pure.
 */

/** A memory that answered a question in place of asking it. */
export type RememberedAnswer = {
    /** The requirement it answered, as the posting named it. */
    gap: string;
    key: string;
    memoryId: string;
    text: string;
    /** When the user told us (ISO), shown as "Nov 8". */
    savedAt: string;
};

/** Longest line kept from an answer. Consolidation shortens it further. */
export const MEMORY_TEXT_MAX = 280;

/** "Nov 8". UTC, so the same memory never reads as two dates. */
export function shortDate(value: Date | string): string {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * An answer as a memory line: whitespace collapsed, a leading "yes," dropped
 * (the question is gone, so the yes means nothing), capped at a word boundary.
 * The user's words otherwise, untouched.
 */
export function memoryTextFromAnswer(answer: string): string {
    let text = String(answer ?? '').replace(/\s+/g, ' ').trim();
    text = text.replace(/^(?:yes|yeah|yep|yup|sure|definitely|of course)\b[\s,.!:;-]*/i, '');
    if (text.length > MEMORY_TEXT_MAX) {
        text = `${text.slice(0, MEMORY_TEXT_MAX - 1).replace(/\s+\S*$/, '')}…`;
    }
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function quoted(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > 160 ? `${clean.slice(0, 159).replace(/\s+\S*$/, '')}…` : clean;
}

/**
 * "Used what you told me on Nov 8: …" — said every time a memory answers a
 * question, so the user sees what went in and can change it.
 */
export function rememberedNote(remembered: readonly RememberedAnswer[] | undefined | null): string | null {
    if (!remembered || remembered.length === 0) return null;
    // One memory can answer two requirements; say it once.
    const byMemory = new Map<string, { gaps: string[]; text: string; savedAt: string }>();
    for (const entry of remembered) {
        const seen = byMemory.get(entry.memoryId);
        if (seen) seen.gaps.push(entry.gap);
        else byMemory.set(entry.memoryId, { gaps: [entry.gap], text: entry.text, savedAt: entry.savedAt });
    }
    const items = [...byMemory.values()];
    const footer = 'Wrong or out of date? Change it in Settings → Memory.';
    if (items.length === 1) {
        const [item] = items;
        return `Used what you told me on ${shortDate(item.savedAt)} (${item.gaps.join(', ')}): ${quoted(item.text)}\n${footer}`;
    }
    return [
        'Used what you told me before, instead of asking again:',
        ...items.map((item) => `• ${item.gaps.join(', ')} (${shortDate(item.savedAt)}): ${quoted(item.text)}`),
        footer,
    ].join('\n');
}

export type IndexEntry = { key: string; label: string; text: string };

/** The prompt index's size budget. Small models read short context best. */
export const MEMORY_INDEX_MAX_CHARS = 1_500;

/**
 * One line per memory, in the order given (the service sorts most-used
 * first), stopping before the budget. Empty string when there is nothing.
 */
export function renderMemoryIndex(entries: readonly IndexEntry[], maxChars = MEMORY_INDEX_MAX_CHARS): string {
    const lines: string[] = [];
    let used = 0;
    for (const entry of entries) {
        const topic = entry.label?.trim() || entry.key;
        const line = `- ${topic}: ${entry.text.replace(/\s+/g, ' ').trim()}`;
        // A long line is skipped, not a full stop: shorter ones after it still fit.
        if (used + line.length + 1 > maxChars) continue;
        lines.push(line);
        used += line.length + 1;
    }
    return lines.join('\n');
}
