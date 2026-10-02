import { prisma } from '@/lib/prisma';

/** Arrange-only: set a flag's allow-list (callers snapshot and restore the table). */
export async function setFeatureFlagAllowListForTest(key: string, ids: string[]): Promise<void> {
    await prisma.featureFlag.upsert({
        where: { key },
        create: { key, enabled: false, rolloutPercent: 0, allowUserIds: ids },
        update: { allowUserIds: ids },
    });
}
