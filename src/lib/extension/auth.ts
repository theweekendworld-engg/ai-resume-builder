import { auth } from '@clerk/nextjs/server';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashExtensionAccessToken } from '@/lib/extension/sessionToken';

export type ExtensionAuthResult = {
  userId: string;
  authType: 'extension_token' | 'web_session';
};

export class ExtensionAuthError extends Error {
  constructor(message = 'Not authenticated') {
    super(message);
    this.name = 'ExtensionAuthError';
  }
}

function readBearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function authenticateWithExtensionToken(req: NextRequest): Promise<ExtensionAuthResult | null> {
  const bearerToken = readBearerToken(req);
  if (!bearerToken) return null;

  const now = new Date();
  const tokenHash = hashExtensionAccessToken(bearerToken);
  const record = await prisma.extensionAccessToken.findUnique({
    where: {
      tokenHash,
    },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  if (!record || record.revokedAt || record.expiresAt <= now) {
    return null;
  }

  await prisma.extensionAccessToken.update({
    where: {
      id: record.id,
    },
    data: {
      lastUsedAt: now,
    },
  });

  return {
    userId: record.userId,
    authType: 'extension_token',
  };
}

async function authenticateWithWebSession(): Promise<ExtensionAuthResult | null> {
  const { userId } = await auth();
  if (!userId) return null;

  return {
    userId,
    authType: 'web_session',
  };
}

export async function requireExtensionAuth(req: NextRequest): Promise<ExtensionAuthResult> {
  const tokenAuth = await authenticateWithExtensionToken(req);
  if (tokenAuth) return tokenAuth;

  const sessionAuth = await authenticateWithWebSession();
  if (sessionAuth) return sessionAuth;

  throw new ExtensionAuthError();
}

export function isExtensionAuthError(error: unknown): error is ExtensionAuthError {
  return error instanceof ExtensionAuthError
    || (error instanceof Error && error.name === 'ExtensionAuthError')
    || (error instanceof Error && error.message === 'Not authenticated');
}
