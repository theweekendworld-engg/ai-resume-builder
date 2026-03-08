import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { put } from '@vercel/blob';
import { config } from '@/lib/config';

export type StoredPdfArtifact = {
  blobKey: string;
  blobUrl: string;
  fileSizeBytes: number;
};

type StorePdfInput = {
  userId: string;
  resumeId: string;
  sessionId?: string;
  template: string;
  pdfBuffer: Buffer;
};

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getLocalStorageRoot(): string {
  const configured = config.pdfStorage.localDir.trim();
  if (path.isAbsolute(configured)) return configured;
  return path.join(process.cwd(), configured);
}

async function storeLocalPdf(input: StorePdfInput): Promise<StoredPdfArtifact> {
  const safeUser = sanitizeSegment(input.userId);
  const safeResume = sanitizeSegment(input.resumeId);
  const safeSession = sanitizeSegment(input.sessionId || 'session');
  const filename = `${Date.now()}-${randomUUID()}.pdf`;
  const relativeKey = path.join(safeUser, safeResume, safeSession, filename);

  const root = getLocalStorageRoot();
  const absolutePath = path.join(root, relativeKey);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, input.pdfBuffer);

  const normalizedKey = relativeKey.split(path.sep).join('/');
  const baseUrl = config.pdfStorage.publicBaseUrl.trim();
  const blobUrl = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/${normalizedKey}`
    : `local://${normalizedKey}`;

  return {
    blobKey: normalizedKey,
    blobUrl,
    fileSizeBytes: input.pdfBuffer.byteLength,
  };
}

async function storeBlobPdf(input: StorePdfInput): Promise<StoredPdfArtifact> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      'PDF_STORAGE_MODE=blob requires BLOB_READ_WRITE_TOKEN. Add a Vercel Blob store in the dashboard or set the token in env.'
    );
  }
  const safeUser = sanitizeSegment(input.userId);
  const safeResume = sanitizeSegment(input.resumeId);
  const safeSession = sanitizeSegment(input.sessionId || 'session');
  const filename = `${Date.now()}-${randomUUID()}.pdf`;
  const pathname = `pdfs/${safeUser}/${safeResume}/${safeSession}/${filename}`;

  const blob = await put(pathname, input.pdfBuffer, {
    access: 'public',
    contentType: 'application/pdf',
    addRandomSuffix: false,
    token,
  });

  return {
    blobKey: blob.pathname,
    blobUrl: blob.url,
    fileSizeBytes: input.pdfBuffer.byteLength,
  };
}

export async function storePdfArtifact(input: StorePdfInput): Promise<StoredPdfArtifact> {
  if (config.pdfStorage.mode === 'blob') {
    return storeBlobPdf(input);
  }

  return storeLocalPdf(input);
}

export async function readStoredPdf(blobKey: string): Promise<Buffer | null> {
  if (config.pdfStorage.mode !== 'local') return null;
  const root = getLocalStorageRoot();
  const absolutePath = path.join(root, blobKey);
  try {
    return await readFile(absolutePath);
  } catch {
    return null;
  }
}
