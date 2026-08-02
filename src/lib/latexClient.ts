/**
 * The LaTeX build transport, and its test seam.
 *
 * `compileLatex` in `src/actions/ai.ts` POSTs to a hardcoded third-party
 * service. It lives in a `'use server'` file, which may only export async
 * functions — so the seam cannot live beside it, and this module holds it
 * instead. (The same constraint bit `anonScore`'s outcome vocabulary and
 * Missions' result enum; it is worth remembering before adding any `const` to
 * an actions file.)
 *
 * Why a seam at all: the resume pipeline was the one end-to-end path in the
 * product with no journey test, and this call was why. Any such test would
 * have made a real network request to latex.ytotech.com — slow, flaky, and
 * resume text leaving the machine during CI.
 *
 * Production behaviour is unchanged; the default delegates to global `fetch`.
 */

export const LATEX_BUILD_URL = 'https://latex.ytotech.com/builds/sync';

export type LatexFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const realLatexFetch: LatexFetch = (input, init) => globalThis.fetch(input, init);
let latexFetch: LatexFetch = realLatexFetch;

/** The transport `compileLatex` should use. Production: global fetch. */
export function getLatexFetch(): LatexFetch {
    return latexFetch;
}

export const __testing = {
    setFetch(impl: LatexFetch | null) {
        latexFetch = impl ?? realLatexFetch;
    },
    reset() {
        latexFetch = realLatexFetch;
    },
};
