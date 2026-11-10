const MAX_PAGES = 50;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export type ExtractedPdfLink = {
  pageNumber: number;
  text: string;
  url: string;
};

type PdfJsModule = {
  getDocument: (options: Record<string, unknown>) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[]; hasEOL?: boolean }> }>;
        getAnnotations: () => Promise<Array<Record<string, unknown>>>;
      }>;
      destroy: () => Promise<void>;
    }>;
    destroy: () => Promise<void>;
  };
};

const INLINE_URL_REGEX = /((?:https?:\/\/|www\.)[^\s<>"')\]]+)/gi;

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/[),.;]+$/g, '');
  if (/^(mailto:|tel:)/i.test(trimmed)) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return '';
}

function extractInlineUrls(text: string): string[] {
  const matches = text.match(INLINE_URL_REGEX) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const normalized = normalizeUrl(raw);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function extractAnnotationUrl(annotation: Record<string, unknown>): string | null {
  const candidates = [annotation.url, annotation.unsafeUrl, annotation.uri, annotation.action];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = normalizeUrl(candidate);
    if (normalized && /^https?:\/\//i.test(normalized)) {
      return normalized;
    }
  }
  return null;
}

/**
 * A page's text, one visual line per line.
 *
 * This used to trim every item and join them all with spaces, so a whole page
 * came out as one line. Import reads bullets, headings and skills rows off
 * line structure (`src/lib/resume/sourceText.ts`), and a page with no line
 * breaks has none to read. pdfjs marks the end of each line with `hasEOL`;
 * a change of baseline is the fallback for producers that do not.
 */
export function joinTextItems(items: Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>): string {
  let text = '';
  let lastY: number | null = null;
  for (const item of items) {
    const str = typeof item.str === 'string' ? item.str : '';
    const y = Array.isArray(item.transform) ? item.transform[5] : null;
    if (str && lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !text.endsWith('\n')) text += '\n';
    text += str;
    if (item.hasEOL) text += '\n';
    if (str && y !== null) lastY = y;
  }
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Pages, and how many printed lines sit past the first `budget` pages.
 * The line count lets the page-fit loop trim enough in one pass.
 */
export async function measurePdf(
  buffer: Buffer | Uint8Array,
  budget = 1,
): Promise<{ pages: number | null; overflowLines: number | null }> {
  try {
    const pdfjs = await loadPdfJs();
    const task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false,
    });
    try {
      const pdf = await task.promise;
      const pages = pdf.numPages;
      let overflowLines = 0;
      for (let pageNumber = budget + 1; pageNumber <= Math.min(pages, MAX_PAGES); pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const baselines = new Set<number>();
        for (const item of content.items) {
          if (typeof item.str === 'string' && item.str.trim() && Array.isArray(item.transform)) {
            baselines.add(Math.round(item.transform[5]));
          }
        }
        overflowLines += baselines.size;
      }
      await pdf.destroy();
      return { pages, overflowLines };
    } finally {
      await task.destroy();
    }
  } catch {
    return { pages: null, overflowLines: null };
  }
}

/** How many pages a PDF has. Null when it cannot be read. */
export async function countPdfPages(buffer: Buffer | Uint8Array): Promise<number | null> {
  try {
    const pdfjs = await loadPdfJs();
    const task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false,
    });
    try {
      const pdf = await task.promise;
      const pages = pdf.numPages;
      await pdf.destroy();
      return pages;
    } finally {
      await task.destroy();
    }
  } catch {
    return null;
  }
}

/*
 * pdf.js 5 needs DOMMatrix while it loads. Node has none; pdf.js borrows it
 * from the native @napi-rs/canvas, which Vercel does not bundle, so every PDF
 * read failed in production (2026-11-10). A pure-JS DOMMatrix is installed
 * first. Text extraction never renders, so the polyfill's maths is enough.
 */
async function ensureDomMatrix(): Promise<void> {
  const g = globalThis as { DOMMatrix?: unknown };
  if (g.DOMMatrix) return;
  const mod = await import('@thednp/dommatrix');
  g.DOMMatrix = (mod as { default?: unknown }).default ?? mod;
}

/*
 * pdf.js runs its worker in-process on the server and finds it at
 * `globalThis.pdfjsWorker`. Otherwise it imports pdf.worker.mjs by a computed
 * path, which Vercel's file tracing misses ("Setting up fake worker failed").
 * A literal import keeps the file in the bundle.
 */
async function ensurePdfWorker(): Promise<void> {
  const g = globalThis as { pdfjsWorker?: unknown };
  if (g.pdfjsWorker) return;
  g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
}

async function loadPdfJs(): Promise<PdfJsModule> {
  await ensureDomMatrix();
  await ensurePdfWorker();
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return mod as unknown as PdfJsModule;
}

function getDocumentData(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer);
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  if (buffer.length > MAX_SIZE_BYTES) {
    throw new Error(`PDF exceeds ${MAX_SIZE_BYTES / 1024 / 1024}MB limit`);
  }

  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: getDocumentData(buffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  try {
    const pdf = await task.promise;
    const pageLimit = Math.min(pdf.numPages, MAX_PAGES);
    const chunks: string[] = [];

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = joinTextItems(textContent.items);
      if (pageText) chunks.push(pageText);
    }

    await pdf.destroy();
    return chunks.join('\n').trim();
  } finally {
    await task.destroy();
  }
}

export async function extractHyperlinksFromPdf(buffer: Buffer): Promise<ExtractedPdfLink[]> {
  if (buffer.length > MAX_SIZE_BYTES) {
    throw new Error(`PDF exceeds ${MAX_SIZE_BYTES / 1024 / 1024}MB limit`);
  }

  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: getDocumentData(buffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  try {
    const links: ExtractedPdfLink[] = [];
    const pdf = await task.promise;
    const pageLimit = Math.min(pdf.numPages, MAX_PAGES);

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = joinTextItems(textContent.items);
      const annotations = await page.getAnnotations();

      for (const annotation of annotations) {
        const url = extractAnnotationUrl(annotation);
        if (!url) continue;
        const text =
          typeof annotation.title === 'string'
            ? annotation.title.trim()
            : typeof annotation.contents === 'string'
              ? annotation.contents.trim()
              : '';

        links.push({
          pageNumber,
          text,
          url,
        });
      }

      for (const inlineUrl of extractInlineUrls(pageText)) {
        links.push({ pageNumber, text: '', url: inlineUrl });
      }
    }

    await pdf.destroy();
    const deduped: ExtractedPdfLink[] = [];
    const seen = new Set<string>();
    for (const link of links) {
      const key = `${link.pageNumber}|${link.text.toLowerCase()}|${link.url.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(link);
    }
    return deduped;
  } finally {
    await task.destroy();
  }
}
