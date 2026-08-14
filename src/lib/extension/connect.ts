import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { createExtensionAccessToken } from '@/lib/extension/sessionToken';
import { EXTENSION_CLIENT, formatExtensionSessionPayload, type ExtensionSessionPayload } from '@/lib/extension/session';

const CONNECT_GRANT_TTL_MS = 10 * 60 * 1000;

function hashVerifier(verifier: string): string {
  return createHash('sha256')
    .update(String(verifier || ''), 'utf8')
    .digest('hex');
}

function getAppOrigin(requestOrigin?: string): string {
  const configured = config.app.url || requestOrigin || 'http://localhost:3000';
  return configured.replace(/\/+$/, '');
}

export type ExtensionConnectGrantPayload = {
  success: true;
  grantId: string;
  verifier: string;
  connectUrl: string;
  expiresAt: string;
};

export async function createExtensionConnectGrant(requestOrigin?: string): Promise<ExtensionConnectGrantPayload> {
  const verifier = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + CONNECT_GRANT_TTL_MS);

  const grant = await prisma.extensionConnectGrant.create({
    data: {
      client: EXTENSION_CLIENT,
      verifierHash: hashVerifier(verifier),
      expiresAt,
    },
    select: {
      id: true,
      expiresAt: true,
    },
  });

  const connectUrl = new URL('/extension/connect', getAppOrigin(requestOrigin));
  connectUrl.searchParams.set('grantId', grant.id);

  return {
    success: true,
    grantId: grant.id,
    verifier,
    connectUrl: connectUrl.toString(),
    expiresAt: grant.expiresAt.toISOString(),
  };
}

export type ExtensionConnectApprovalResult =
  | { status: 'approved'; expiresAt: string }
  | { status: 'already_approved'; expiresAt: string }
  | { status: 'approved_by_other_account' }
  | { status: 'already_connected' }
  | { status: 'expired' }
  | { status: 'not_found' };

export async function approveExtensionConnectGrant(
  grantId: string,
  userId: string
): Promise<ExtensionConnectApprovalResult> {
  const now = new Date();
  const grant = await prisma.extensionConnectGrant.findUnique({
    where: {
      id: grantId,
    },
    select: {
      approvedUserId: true,
      consumedAt: true,
      expiresAt: true,
    },
  });

  if (!grant) return { status: 'not_found' };
  if (grant.consumedAt) return { status: 'already_connected' };
  if (grant.expiresAt <= now) return { status: 'expired' };

  if (grant.approvedUserId === userId) {
    return {
      status: 'already_approved',
      expiresAt: grant.expiresAt.toISOString(),
    };
  }

  if (grant.approvedUserId) {
    return { status: 'approved_by_other_account' };
  }

  const updated = await prisma.extensionConnectGrant.updateMany({
    where: {
      id: grantId,
      approvedUserId: null,
      consumedAt: null,
      expiresAt: {
        gt: now,
      },
    },
    data: {
      approvedUserId: userId,
      approvedAt: now,
    },
  });

  if (updated.count === 0) return { status: 'expired' };

  return {
    status: 'approved',
    expiresAt: grant.expiresAt.toISOString(),
  };
}

export type ExtensionConnectPollResult =
  | { success: true; status: 'pending'; expiresAt: string }
  | { success: true; status: 'authorized'; session: ExtensionSessionPayload }
  | { success: false; status: 'expired' | 'consumed' | 'not_found' | 'invalid_verifier'; error: string };

export async function pollExtensionConnectGrant(
  grantId: string,
  verifier: string
): Promise<ExtensionConnectPollResult> {
  const now = new Date();
  const verifierHash = hashVerifier(verifier);
  const grant = await prisma.extensionConnectGrant.findUnique({
    where: {
      id: grantId,
    },
    select: {
      id: true,
      verifierHash: true,
      approvedUserId: true,
      consumedAt: true,
      expiresAt: true,
    },
  });

  if (!grant) {
    return { success: false, status: 'not_found', error: 'Extension connection request was not found' };
  }

  if (grant.verifierHash !== verifierHash) {
    return { success: false, status: 'invalid_verifier', error: 'Invalid extension connection verifier' };
  }

  if (grant.consumedAt) {
    return { success: false, status: 'consumed', error: 'Extension connection request was already used' };
  }

  if (grant.expiresAt <= now) {
    return { success: false, status: 'expired', error: 'Extension connection request expired' };
  }

  if (!grant.approvedUserId) {
    return {
      success: true,
      status: 'pending',
      expiresAt: grant.expiresAt.toISOString(),
    };
  }

  const token = createExtensionAccessToken(now);
  const record = await prisma.$transaction(async (tx) => {
    const consumed = await tx.extensionConnectGrant.updateMany({
      where: {
        id: grant.id,
        consumedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      data: {
        consumedAt: now,
      },
    });

    if (consumed.count === 0) return null;

    await tx.extensionAccessToken.updateMany({
      where: {
        userId: grant.approvedUserId!,
        client: EXTENSION_CLIENT,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    return tx.extensionAccessToken.create({
      data: {
        userId: grant.approvedUserId!,
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
  });

  if (!record) {
    return { success: false, status: 'consumed', error: 'Extension connection request was already used' };
  }

  return {
    success: true,
    status: 'authorized',
    session: formatExtensionSessionPayload(record, token.rawToken),
  };
}
