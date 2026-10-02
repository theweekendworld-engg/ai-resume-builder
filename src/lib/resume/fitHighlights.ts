/**
 * Make parsed highlights fit the experience schema (each ≤ 300 chars, ≤ 100),
 * without dropping the role or the words.
 *
 * Until 2026-10-02 one long bullet from a PDF failed the whole role's insert,
 * and import moved on silently: the base resume showed the role, the history
 * did not, and every tailored copy lost it (launch audit). Long lines are split
 * at sentence or clause boundaries; a single unbroken sentence is cut at a word
 * boundary as a last resort.
 */

export const HIGHLIGHT_MAX = 300;
export const HIGHLIGHTS_MAX = 100;

function splitLong(line: string): string[] {
    const out: string[] = [];
    let rest = line.trim();
    while (rest.length > HIGHLIGHT_MAX) {
        const window = rest.slice(0, HIGHLIGHT_MAX);
        const boundary = Math.max(window.lastIndexOf('. '), window.lastIndexOf('; '), window.lastIndexOf(', '));
        const cut = boundary > HIGHLIGHT_MAX * 0.4 ? boundary + 1 : window.lastIndexOf(' ');
        const at = cut > 0 ? cut : HIGHLIGHT_MAX;
        out.push(rest.slice(0, at).trim().replace(/[,;]$/, ''));
        rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
    return out;
}

export function fitHighlights(highlights: readonly string[] | undefined): string[] {
    return (highlights ?? [])
        .flatMap((line) => (typeof line === 'string' ? splitLong(line) : []))
        .filter((line) => line.length > 0)
        .slice(0, HIGHLIGHTS_MAX);
}
