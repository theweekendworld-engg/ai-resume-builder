import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { get, put } from '@vercel/blob';
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

const globalForPdfStorage = globalThis as typeof globalThis & {
  pdfMemoryStore?: Map<string, Buffer>;
};

type BlobAccess = 'public' | 'private';

function getMemoryStore(): Map<string, Buffer> {
  if (!globalForPdfStorage.pdfMemoryStore) {
    globalForPdfStorage.pdfMemoryStore = new Map<string, Buffer>();
  }
  return globalForPdfStorage.pdfMemoryStore;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getLocalStorageRoot(): string {
  const configured = config.pdfStorage.localDir.trim();
  if (path.isAbsolute(configured)) return configured;
  return path.join(process.cwd(), configured);
}

function getBlobAccessCandidates(): BlobAccess[] {
  return config.pdfStorage.access === 'private'
    ? ['private', 'public']
    : ['public', 'private'];
}

function isBlobAccessMismatchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('private store') || message.includes('public store');
}

async function storeMemoryPdf(input: StorePdfInput): Promise<StoredPdfArtifact> {
  const safeUser = sanitizeSegment(input.userId);
  const safeResume = sanitizeSegment(input.resumeId);
  const safeSession = sanitizeSegment(input.sessionId || 'session');
  const filename = `${Date.now()}-${randomUUID()}.pdf`;
  const blobKey = `pdfs/${safeUser}/${safeResume}/${safeSession}/${filename}`;

  getMemoryStore().set(blobKey, Buffer.from(input.pdfBuffer));

  return {
    blobKey,
    blobUrl: `memory://${blobKey}`,
    fileSizeBytes: input.pdfBuffer.byteLength,
  };
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

  let lastError: unknown = null;
  let blob: Awaited<ReturnType<typeof put>> | null = null;

  for (const access of getBlobAccessCandidates()) {
    try {
      blob = await put(pathname, input.pdfBuffer, {
        access,
        contentType: 'application/pdf',
        addRandomSuffix: false,
        token,
      });
      break;
    } catch (error: unknown) {
      lastError = error;
      if (!isBlobAccessMismatchError(error)) break;
    }
  }

  if (!blob) {
    throw (lastError instanceof Error ? lastError : new Error('Failed to store PDF in Vercel Blob'));
  }

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

  if (config.pdfStorage.mode === 'memory') {
    return storeMemoryPdf(input);
  }

  return storeLocalPdf(input);
}

export async function readStoredPdf(blobKey: string): Promise<Buffer | null> {
  if (config.pdfStorage.mode === 'memory') {
    return getMemoryStore().get(blobKey) ?? null;
  }

  if (config.pdfStorage.mode === 'blob') {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return null;

    let lastError: unknown = null;
    for (const access of getBlobAccessCandidates()) {
      try {
        const result = await get(blobKey, {
          access,
          token,
          ...(access === 'private' ? { useCache: false } : {}),
        });
        if (!result || !result.stream) return null;
        return Buffer.from(await new Response(result.stream).arrayBuffer());
      } catch (error: unknown) {
        lastError = error;
        if (!isBlobAccessMismatchError(error)) break;
      }
    }

    if (lastError) {
      console.error('Failed to read stored PDF from Blob:', lastError);
    }
    return null;
  }

  const root = getLocalStorageRoot();
  const absolutePath = path.join(root, blobKey);
  try {
    return await readFile(absolutePath);
  } catch {
    return null;
  }
}
