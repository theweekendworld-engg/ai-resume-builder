/**
 * Lightweight word-level diff for before/after previews in the editor.
 *
 * Produces a list of tokens tagged as unchanged / removed / added so the UI can
 * render strikethrough-red for old text and highlighted-green for new text.
 * This is a simple LCS-based diff — good enough for short resume snippets, and
 * deliberately dependency-free.
 */

export type DiffOp = 'equal' | 'remove' | 'add';

export interface DiffToken {
    op: DiffOp;
    value: string;
}

function tokenize(text: string): string[] {
    // Split on whitespace but keep the whitespace so we can re-join faithfully.
    return text.split(/(\s+)/).filter((token) => token.length > 0);
}

/**
 * Word-level diff between two strings. Returns tokens in output order.
 */
export function diffWords(before: string, after: string): DiffToken[] {
    const a = tokenize(before);
    const b = tokenize(after);

    // LCS table.
    const m = a.length;
    const n = b.length;
    const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            if (a[i] === b[j]) {
                lcs[i][j] = lcs[i + 1][j + 1] + 1;
            } else {
                lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
            }
        }
    }

    const tokens: DiffToken[] = [];
    let i = 0;
    let j = 0;

    const push = (op: DiffOp, value: string) => {
        const last = tokens[tokens.length - 1];
        if (last && last.op === op) {
            last.value += value;
        } else {
            tokens.push({ op, value });
        }
    };

    while (i < m && j < n) {
        if (a[i] === b[j]) {
            push('equal', a[i]);
            i++;
            j++;
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            push('remove', a[i]);
            i++;
        } else {
            push('add', b[j]);
            j++;
        }
    }
    while (i < m) {
        push('remove', a[i]);
        i++;
    }
    while (j < n) {
        push('add', b[j]);
        j++;
    }

    return tokens;
}
