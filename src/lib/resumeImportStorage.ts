import { del, put } from '@vercel/blob';
import { randomUUID } from 'crypto';
import { config } from '@/lib/config';

type StoredImportArtifact = {
  blobKey: string;
  blobUrl: string;
  fileSizeBytes: number;
};

const globalForImportStorage = globalThis as typeof globalThis & {
  resumeImportMemoryStore?: Map<string, Buffer>;
};

function getMemoryStore(): Map<string, Buffer> {
  if (!globalForImportStorage.resumeImportMemoryStore) {
    globalForImportStorage.resumeImportMemoryStore = new Map<string, Buffer>();
  }
  return globalForImportStorage.resumeImportMemoryStore;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function storeResumeImportArtifact(params: {
  userId: string;
  fileName: string;
  buffer: Buffer;
}): Promise<StoredImportArtifact> {
  const safeUser = sanitizeSegment(params.userId);
  const safeName = sanitizeSegment(params.fileName || 'resume.pdf');
  const pathname = `resume-imports/${safeUser}/${Date.now()}-${randomUUID()}-${safeName}`;

  if (config.resumeImportStorage.mode === 'memory') {
    getMemoryStore().set(pathname, Buffer.from(params.buffer));
    return {
      blobKey: pathname,
      blobUrl: `memory://${pathname}`,
      fileSizeBytes: params.buffer.byteLength,
    };
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      'RESUME_IMPORT_STORAGE_MODE=blob requires BLOB_READ_WRITE_TOKEN. Add a Vercel Blob store or set the token in env.'
    );
  }

  const blob = await put(pathname, params.buffer, {
    access: config.resumeImportStorage.access,
    contentType: 'application/pdf',
    addRandomSuffix: false,
    token,
  });

  return {
    blobKey: blob.pathname,
    blobUrl: blob.url,
    fileSizeBytes: params.buffer.byteLength,
  };
}

export async function readResumeImportArtifact(blobKey: string, blobUrl: string): Promise<Buffer | null> {
  if (config.resumeImportStorage.mode === 'memory') {
    return getMemoryStore().get(blobKey) ?? null;
  }

  try {
    const response = await fetch(blobUrl, { cache: 'no-store' });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

export async function deleteResumeImportArtifact(blobKey: string): Promise<void> {
  if (!blobKey) return;

  if (config.resumeImportStorage.mode === 'memory') {
    getMemoryStore().delete(blobKey);
    return;
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  await del(blobKey, { token }).catch(() => undefined);
}
