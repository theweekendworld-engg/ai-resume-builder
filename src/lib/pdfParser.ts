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
        getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[] }> }>;
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

function joinTextItems(items: Array<{ str?: string }>): string {
  return items
    .map((item) => (typeof item.str === 'string' ? item.str.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
}

async function loadPdfJs(): Promise<PdfJsModule> {
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
