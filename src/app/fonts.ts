import localFont from 'next/font/local';

/**
 * Fonts are served from the repo, not fetched from Google at build time.
 * Two production builds failed on "Can't resolve
 * '@vercel/turbopack-next/internal/font/google/font'" when the build machine
 * could not reach Google Fonts, and the dev server cached the same failure.
 * Both files are the Google Fonts latin-subset variable fonts (SIL Open Font
 * License 1.1), so weights and shapes are unchanged.
 */
export const inter = localFont({
  src: './fonts/inter-latin-var.woff2',
  display: 'swap',
  weight: '400 600',
  variable: '--font-inter',
});

export const sora = localFont({
  src: './fonts/sora-latin-var.woff2',
  display: 'swap',
  weight: '500 800',
  variable: '--font-sora',
});

export const fontVariables = `${inter.variable} ${sora.variable}`;
