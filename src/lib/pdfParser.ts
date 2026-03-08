import { PDFParse } from 'pdf-parse';

const MAX_PAGES = 50;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export type ExtractedPdfLink = {
  pageNumber: number;
  text: string;
  url: string;
};

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  if (buffer.length > MAX_SIZE_BYTES) {
    throw new Error(`PDF exceeds ${MAX_SIZE_BYTES / 1024 / 1024}MB limit`);
  }

  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText({ first: MAX_PAGES, parseHyperlinks: true });
    return (result.text ?? '').trim();
  } finally {
    await parser.destroy();
  }
}

export async function extractHyperlinksFromPdf(buffer: Buffer): Promise<ExtractedPdfLink[]> {
  if (buffer.length > MAX_SIZE_BYTES) {
    throw new Error(`PDF exceeds ${MAX_SIZE_BYTES / 1024 / 1024}MB limit`);
  }

  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo({
      first: MAX_PAGES,
      parsePageInfo: true,
      parseHyperlinks: true,
    });

    const links: ExtractedPdfLink[] = [];
    const pages = Array.isArray(info.pages) ? info.pages : [];
    for (const page of pages) {
      if (!Array.isArray(page.links)) continue;
      for (const link of page.links) {
        const text = typeof link.text === 'string' ? link.text.trim() : '';
        const url = typeof link.url === 'string' ? link.url.trim() : '';
        if (!url) continue;
        links.push({
          pageNumber: typeof page.pageNumber === 'number' ? page.pageNumber : 0,
          text,
          url,
        });
      }
    }

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
    await parser.destroy();
  }
}
