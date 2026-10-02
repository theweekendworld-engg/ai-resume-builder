/**
 * Delete everything Patronus holds about one user.
 *
 * The privacy page promised deletion and nothing implemented it; deleting the
 * Clerk account left every row behind (launch audit, 2026-10-02).
 *
 * The table list is read from Prisma's own schema metadata (every model with a
 * `userId` field), not written out by hand, so a table added next month cannot
 * be forgotten here. Child rows without their own `userId` (AgentStep,
 * MissionStep, …) go with their parents through `onDelete: Cascade`.
 *
 * Order: files first (they are only reachable through the rows), then rows in
 * passes, because a foreign key can make one delete wait on another. Plain
 * server code: identity comes from the caller, which takes it from the session
 * or a verified Clerk webhook.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type DeletionReport = {
    rows: Record<string, number>;
    files: number;
    leftovers: string[];
};

/** Prisma delegate names (camelCase) of every model keyed by `userId`. */
export function userOwnedModels(): string[] {
    return Prisma.dmmf.datamodel.models
        .filter((model) => model.fields.some((field) => field.name === 'userId'))
        .map((model) => model.name.charAt(0).toLowerCase() + model.name.slice(1));
}

type Deletable = { deleteMany: (args: { where: Record<string, unknown> }) => Promise<{ count: number }> };

async function deleteBlobs(userId: string): Promise<number> {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return 0;
    const [pdfs, imports] = await Promise.all([
        prisma.generatedPdf.findMany({ where: { userId }, select: { blobKey: true, blobUrl: true } }),
        prisma.resumeImportSession.findMany({ where: { userId }, select: { blobKey: true, blobUrl: true } }),
    ]);
    const targets = [...pdfs, ...imports].map((row) => row.blobUrl || row.blobKey).filter(Boolean);
    if (targets.length === 0) return 0;
    const { del } = await import('@vercel/blob');
    let deleted = 0;
    for (let i = 0; i < targets.length; i += 100) {
        const batch = targets.slice(i, i + 100);
        await del(batch, { token }).then(() => { deleted += batch.length; }).catch((error: unknown) => {
            console.error('[accountDeletion] blob delete failed', { userId, error: String(error) });
        });
    }
    return deleted;
}

export async function deleteUserData(userId: string): Promise<DeletionReport> {
    if (!userId.trim()) throw new Error('deleteUserData: empty userId');
    const files = await deleteBlobs(userId);

    const rows: Record<string, number> = {};
    let pending = userOwnedModels();
    for (let pass = 0; pass < 6 && pending.length > 0; pass += 1) {
        const next: string[] = [];
        for (const model of pending) {
            const delegate = (prisma as unknown as Record<string, Deletable>)[model];
            try {
                const { count } = await delegate.deleteMany({ where: { userId } });
                rows[model] = (rows[model] ?? 0) + count;
            } catch {
                // A foreign key still points at it; try again after the others go.
                next.push(model);
            }
        }
        pending = next;
    }

    // Rows that name the user under another column.
    const grants = await prisma.extensionConnectGrant.deleteMany({ where: { approvedUserId: userId } });
    rows.extensionConnectGrant = grants.count;
    const flags = await prisma.featureFlag.findMany({ select: { key: true, allowUserIds: true } });
    for (const flag of flags) {
        const ids = Array.isArray(flag.allowUserIds) ? (flag.allowUserIds as unknown[]) : [];
        if (ids.includes(userId)) {
            await prisma.featureFlag.update({
                where: { key: flag.key },
                data: { allowUserIds: ids.filter((id) => id !== userId) as Prisma.InputJsonValue },
            });
        }
    }

    if (pending.length > 0) console.error('[accountDeletion] rows left behind', { userId, models: pending });
    return { rows, files, leftovers: pending };
}
