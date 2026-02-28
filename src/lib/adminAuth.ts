import { auth } from '@clerk/nextjs/server';

function parseAdminUserIds(): Set<string> {
  const raw = process.env.ADMIN_USER_IDS ?? '';
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return parseAdminUserIds().has(userId);
}

export async function requireAuthenticatedUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Not authenticated');
  }
  return userId;
}

export async function requireAdminUserId(): Promise<string> {
  const userId = await requireAuthenticatedUserId();
  if (!isAdminUserId(userId)) {
    throw new Error('Admin access required');
  }
  return userId;
}
