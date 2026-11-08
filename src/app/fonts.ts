import localFont from 'next/font/local';

/**
 * Fonts are served from the repo, not fetched from Google at build time.
 * Two production builds failed on "Can't resolve
 * '@vercel/turbopack-next/internal/font/google/font'" when the build machine
 * could not reach Google Fonts, and the dev server cached the same failure.
 * Every file here is a Google Fonts latin-subset variable font (SIL Open Font
 * License 1.1), downloaded once from the CSS API and committed.
 *
 * Dossier (docs/design/03-dossier.md, 2026-11-08): two families.
 *
 * - Inter carries the interface: body, labels, buttons, tables.
 * - Source Serif 4 (Adobe, OFL 1.1) is the display face: page titles, section
 *   headings and the large numbers in a stat strip. A text serif rather than a
 *   fashion one (Playfair, Fraunces) because the record should read like a
 *   well-set document, not a magazine cover. Its lining figures are tabular
 *   with `font-variant-numeric: tabular-nums`, so a column of counts lines up.
 *   The file is the weight axis only (400-700, opsz pinned): 51KB against
 *   122KB for the optical-size build, and titles never go above 40px here.
 *
 * Sora stays for the landing page and sign-in (owner decision 2026-11-08: the
 * old homepage is kept as it was). Inside the app headings are Source Serif.
 */
export const inter = localFont({
  src: './fonts/inter-latin-var.woff2',
  display: 'swap',
  weight: '400 600',
  variable: '--font-inter',
});

export const sourceSerif = localFont({
  src: './fonts/source-serif-4-latin-var.woff2',
  display: 'swap',
  weight: '400 700',
  variable: '--font-serif',
  // next/font sizes the system serif fallback to these metrics, so the swap
  // from fallback to Source Serif does not shift a title.
  adjustFontFallback: 'Times New Roman',
});

export const sora = localFont({
  src: './fonts/sora-latin-var.woff2',
  display: 'swap',
  weight: '500 800',
  variable: '--font-sora',
});

export const fontVariables = `${inter.variable} ${sourceSerif.variable} ${sora.variable}`;
