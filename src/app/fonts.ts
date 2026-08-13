import { Inter, Sora } from 'next/font/google';

/**
 * Self-hosted fonts (design/00 §1 Problem 3).
 *
 * Replaces the two render-blocking Google Fonts `@import`s that used to sit at
 * the top of globals.css. next/font downloads the files at build time and
 * serves them from our own origin: no DNS round-trips, no blocking stylesheet.
 *
 * Weights are deliberately limited to the ones the design system actually uses
 * (design/00 §4.1): Inter 400/500/600, Sora 500/600. Inter 300/700 and
 * Sora 400 were dropped.
 *
 * Sora 700/800 are the exception, and only the marketing page uses them. The
 * landing page's display type is set at `.mk-display` (globals.css) — one
 * enormous statement per section, tracked in to -0.035em. At 600 that size
 * reads as a large paragraph rather than a headline; the weight is what makes
 * it land. The authenticated app never loads above 600, so this costs the
 * product surface nothing.
 */
export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600'],
  variable: '--font-inter',
});

export const sora = Sora({
  subsets: ['latin'],
  display: 'swap',
  weight: ['500', '600', '700', '800'],
  variable: '--font-sora',
});

/** Apply to <html> so `--font-inter` / `--font-sora` are readable everywhere. */
export const fontVariables = `${inter.variable} ${sora.variable}`;
