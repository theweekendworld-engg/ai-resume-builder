/**
 * Ambient declaration for plain (non-module) CSS side-effect imports.
 *
 * Next declares `*.module.css` in `next/types/global.d.ts` but not plain
 * `*.css`, so `import './globals.css'` in the root layout has no declaration to
 * resolve. `tsc` does not care — TS only reports that as an error (TS2882) when
 * `noUncheckedSideEffectImports` is on, and it is not — which is why the CLI
 * type-check passes while an editor whose TS server enables the check flags
 * layout.tsx.
 *
 * Declaring it here makes both agree, rather than leaving a red squiggle that
 * every contributor has to be told to ignore.
 */
declare module '*.css';
