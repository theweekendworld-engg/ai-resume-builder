import { prisma } from '@/lib/prisma';
import { createExtensionAccessToken } from '@/lib/extension/sessionToken';

export const EXTENSION_CLIENT = 'chrome_extension';

export type ExtensionSessionPayload = {
  success: true;
  sessionId: string;
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
};

type ExtensionSessionRecord = {
  id: string;
  expiresAt: Date;
};

export function formatExtensionSessionPayload(
  record: ExtensionSessionRecord,
  accessToken: string
): ExtensionSessionPayload {
  return {
    success: true,
    sessionId: record.id,
    accessToken,
    tokenType: 'Bearer',
    expiresAt: record.expiresAt.toISOString(),
  };
}

export async function createExtensionSession(userId: string): Promise<ExtensionSessionPayload> {
  const now = new Date();
  const token = createExtensionAccessToken(now);

  await prisma.extensionAccessToken.updateMany({
    where: {
      userId,
      client: EXTENSION_CLIENT,
      revokedAt: null,
    },
    data: {
      revokedAt: now,
    },
  });

  const record = await prisma.extensionAccessToken.create({
    data: {
      userId,
      client: EXTENSION_CLIENT,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      lastUsedAt: now,
    },
    select: {
      id: true,
      expiresAt: true,
    },
  });

  return formatExtensionSessionPayload(record, token.rawToken);
}
