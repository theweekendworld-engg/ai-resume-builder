import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
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

async function storeBlobPdf(): Promise<StoredPdfArtifact> {
  throw new Error('PDF blob mode is enabled but no blob provider integration is configured yet.');
}

export async function storePdfArtifact(input: StorePdfInput): Promise<StoredPdfArtifact> {
  if (config.pdfStorage.mode === 'blob') {
    return storeBlobPdf();
  }

  return storeLocalPdf(input);
}
