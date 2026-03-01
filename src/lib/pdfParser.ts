import { PDFParse } from 'pdf-parse';

const MAX_PAGES = 50;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  if (buffer.length > MAX_SIZE_BYTES) {
    throw new Error(`PDF exceeds ${MAX_SIZE_BYTES / 1024 / 1024}MB limit`);
  }

  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText({ first: MAX_PAGES });

  return (result.text ?? '').trim();
}
