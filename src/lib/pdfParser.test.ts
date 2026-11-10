import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { countPdfPages, extractTextFromPdf } from './pdfParser';

/**
 * Production on 2026-11-10: every PDF uploaded to /score returned a 500.
 * pdf-parse v2 (and pdf.js's main build) expect the browser's DOMMatrix.
 * Vercel's Node runtime has none. Locally a native canvas package supplies
 * one, so nothing failed until the code was deployed. Server code reads PDFs
 * through this module, which loads pdf.js's legacy build. These tests run
 * where DOMMatrix does not exist, as on Vercel, and fail on any server import
 * that needs it.
 */

const FIXTURE = join(import.meta.dir, '..', '__fixtures__', 'resume', 'sample-resume.pdf');

describe('PDF reading works without browser globals', () => {
    test('the test runtime has no DOMMatrix, as on Vercel', () => {
        expect(typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix).toBe('undefined');
    });

    test('a resume PDF yields its text', async () => {
        const text = await extractTextFromPdf(readFileSync(FIXTURE));
        expect(text).toContain('Alex Rivera');
        expect(text).toContain('Senior Backend Engineer');
        expect(text).toContain('PostgreSQL');
    });

    test('its pages are counted', async () => {
        expect(await countPdfPages(readFileSync(FIXTURE))).toBe(1);
    });

    test('a file that is not a PDF is rejected, not crashed on', async () => {
        await expect(extractTextFromPdf(Buffer.from('not a pdf'))).rejects.toThrow();
    });
});

describe('server code loads PDFs only through src/lib/pdfParser', () => {
    const SRC = join(import.meta.dir, '..');
    // pdf-parse, or pdf.js's main build: both need DOMMatrix at load time.
    const NEEDS_DOM = /(?:from\s+|import\(\s*|require\(\s*)['"](pdf-parse(?:\/[^'"]*)?|pdfjs-dist(?!\/legacy\/)[^'"]*)['"]/;

    function walk(dir: string, out: string[] = []): string[] {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full, out);
            else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
        }
        return out;
    }

    test('no other module imports pdf-parse or pdf.js\'s main build', () => {
        const offenders = walk(SRC)
            .filter((file) => NEEDS_DOM.test(readFileSync(file, 'utf8')))
            .map((file) => file.slice(SRC.length + 1));
        expect(offenders).toEqual([]);
    });
});
