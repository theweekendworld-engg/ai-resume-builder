/**
 * Test helper: what is structurally wrong with a generated LaTeX document.
 *
 * Not a parser. It reads the source the way TeX's tokenizer would for the
 * cases that matter here, and reports anything a raw user string could cause:
 * a brace that does not balance (a `}` that closes a template argument), an
 * environment that does not close, a special character in the body outside
 * math mode (`&`, `#`, `_`, `^`, `~`, `%`), an odd `$`, any primitive that
 * reads or writes files, and a template macro called with the wrong number of
 * arguments. A template whose every user string is escaped produces none of
 * these, whatever the strings contain.
 */

/**
 * The templates' own macros, and how many brace groups each takes. A user
 * string holding a balanced `}{` keeps the braces balanced and still moves
 * every argument after it one slot along (the company into the date column,
 * say); counting the groups after each call catches that.
 */
const MACRO_ARITY: Record<string, number> = {
    // Compact.
    resumeSubheading: 4,
    resumeOneLineHeading: 2,
    resumeProjectHeading: 2,
    resumeItem: 1,
    // Compact and the designed templates.
    resumeShortRole: 2,
    // The designed templates.
    resumeEntry: 4,
    resumeLine: 2,
    resumeSkillRow: 2,
    resumeSkillLine: 1,
};

const FORBIDDEN = [/\\input\b/, /\\include\b/, /\\write\d*/, /\\openout/, /\\openin/, /\\read\b/, /\\catcode/, /\\immediate/, /\\directlua/, /\\csname/];

export function latexProblems(latex: string): string[] {
    const problems: string[] = [];
    for (const pattern of FORBIDDEN) {
        if (pattern.test(latex)) problems.push(`forbidden primitive ${pattern}`);
    }
    if ((latex.match(/\\documentclass/g) ?? []).length !== 1) problems.push('not exactly one \\documentclass');
    if (!latex.trimEnd().endsWith('\\end{document}')) problems.push('does not end with \\end{document}');

    let depth = 0;
    let inBody = false;
    let inMath = false;
    const envs: string[] = [];
    for (let i = 0; i < latex.length; i += 1) {
        const ch = latex[i];
        if (ch === '\\') {
            const rest = latex.slice(i + 1, i + 200);
            const env = rest.match(/^(begin|end)\{([^{}]*)\}/);
            if (env) {
                if (env[1] === 'begin') {
                    envs.push(env[2]);
                    if (env[2] === 'document') inBody = true;
                } else if (envs.pop() !== env[2]) {
                    problems.push(`\\end{${env[2]}} does not close the open environment`);
                }
                i += env[0].length;
                continue;
            }
            // \href's URL argument is read by hyperref, not typeset: skip it.
            const href = rest.match(/^href\{([^{}]*)\}/);
            if (href) {
                i += href[0].length;
                continue;
            }
            // A control symbol (\{, \%, \\ …) or the first letter of a word.
            i += 1;
            continue;
        }
        if (ch === '%') {
            if (inBody) problems.push(`comment character in the body at ${i}: ${context(latex, i)}`);
            const end = latex.indexOf('\n', i);
            i = end < 0 ? latex.length : end;
            continue;
        }
        if (ch === '{') depth += 1;
        if (ch === '}') {
            depth -= 1;
            if (depth < 0) {
                problems.push(`unbalanced } at ${i}: ${context(latex, i)}`);
                depth = 0;
            }
        }
        if (!inBody) continue;
        if (ch === '$') inMath = !inMath;
        else if (!inMath && '&#_^~'.includes(ch)) problems.push(`raw ${ch} in the body: ${context(latex, i)}`);
    }
    if (depth !== 0) problems.push(`${depth} unclosed {`);
    problems.push(...macroArityProblems(latex));
    if (envs.length > 0) problems.push(`unclosed environments: ${envs.join(', ')}`);
    if (inMath) problems.push('odd number of $');
    return problems;
}

/** Every call of a template macro in the body, with the brace groups that follow it counted. */
function macroArityProblems(latex: string): string[] {
    const problems: string[] = [];
    const bodyStart = latex.indexOf('\\begin{document}');
    if (bodyStart < 0) return problems;
    const call = new RegExp(`\\\\(${Object.keys(MACRO_ARITY).join('|')})(?![A-Za-z])`, 'g');
    call.lastIndex = bodyStart;
    for (let match = call.exec(latex); match; match = call.exec(latex)) {
        const expected = MACRO_ARITY[match[1]];
        let at = match.index + match[0].length;
        let groups = 0;
        for (;;) {
            while (at < latex.length && /\s/.test(latex[at])) at += 1;
            if (latex[at] !== '{') break;
            const end = groupEnd(latex, at);
            if (end < 0) break;
            groups += 1;
            at = end + 1;
        }
        if (groups !== expected) {
            problems.push(`\\${match[1]} takes ${expected} argument(s), called with ${groups}: ${context(latex, match.index)}`);
        }
    }
    return problems;
}

/** The index of the `}` closing the group opened at `start`, skipping escaped braces; -1 if it never closes. */
function groupEnd(text: string, start: number): number {
    let depth = 0;
    for (let i = start; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '\\') {
            i += 1;
            continue;
        }
        if (ch === '{') depth += 1;
        if (ch === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function context(text: string, at: number): string {
    return JSON.stringify(text.slice(Math.max(0, at - 30), at + 30));
}
