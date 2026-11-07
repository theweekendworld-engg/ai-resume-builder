/**
 * Test helper: what is structurally wrong with a generated LaTeX document.
 *
 * Not a parser. It reads the source the way TeX's tokenizer would for the
 * cases that matter here, and reports anything a raw user string could cause:
 * a brace that does not balance (a `}` that closes a template argument), an
 * environment that does not close, a special character in the body outside
 * math mode (`&`, `#`, `_`, `^`, `~`, `%`), an odd `$`, and any primitive that
 * reads or writes files. A template whose every user string is escaped
 * produces none of these, whatever the strings contain.
 */

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
    if (envs.length > 0) problems.push(`unclosed environments: ${envs.join(', ')}`);
    if (inMath) problems.push('odd number of $');
    return problems;
}

function context(text: string, at: number): string {
    return JSON.stringify(text.slice(Math.max(0, at - 30), at + 30));
}
