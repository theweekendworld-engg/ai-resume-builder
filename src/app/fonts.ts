import { Inter, Sora } from 'next/font/google';

/**
 * Self-hosted fonts (design/00 §1 Problem 3).
 *
 * Replaces the two render-blocking Google Fonts `@import`s that used to sit at
 * the top of globals.css. next/font downloads the files at build time and
 * serves them from our own origin: no DNS round-trips, no blocking stylesheet.
 *
 * Weights are deliberately limited to the five the design system actually uses
 * (design/00 §4.1): Inter 400/500/600, Sora 500/600. Inter 300/700 and
 * Sora 400/700 were dropped.
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
  weight: ['500', '600'],
  variable: '--font-sora',
});

/** Apply to <html> so `--font-inter` / `--font-sora` are readable everywhere. */
export const fontVariables = `${inter.variable} ${sora.variable}`;
