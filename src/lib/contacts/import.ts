/**
 * Import the user's LinkedIn connections into `Contact`.
 *
 * Keyed on `(userId, profileUrl)`: re-importing next month's export updates
 * people who changed jobs and adds new connections, and never duplicates.
 * A row with no profile URL is skipped — without a stable key a re-import
 * would duplicate it every time, and without a URL the user cannot reach them.
 *
 * Written as one read plus two bulk paths rather than N upserts: an export is
 * routinely several thousand rows, and per-row round trips to a remote
 * Postgres would put a server action past its timeout. New rows go through
 * `createMany`; existing rows are updated only when a field actually changed,
 * which on a monthly re-import is a small fraction.
 */

import { ContactSource } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { parseLinkedInConnections, type ParsedConnection } from '@/lib/contacts/linkedinExport';

export type ContactImportSummary = { imported: number; updated: number; skipped: number; total: number };

const MAX_CONNECTIONS = 30_000;
const UPDATE_BATCH = 100;

function changed(existing: {
    fullName: string;
    email: string | null;
    company: string | null;
    position: string | null;
    connectedOn: Date | null;
}, next: ParsedConnection): boolean {
    return existing.fullName !== next.fullName
        || existing.email !== next.email
        || existing.company !== next.company
        || existing.position !== next.position
        || (existing.connectedOn?.getTime() ?? null) !== (next.connectedOn?.getTime() ?? null);
}

export async function importConnectionsCsv(userId: string, csv: string): Promise<Result<ContactImportSummary>> {
    const parsed = parseLinkedInConnections(csv);
    if (!parsed.recognised) {
        return err(
            'That does not look like LinkedIn\'s Connections.csv. In LinkedIn: Settings → Data privacy → Get a copy of your data → Connections.',
            'unrecognised_file',
        );
    }
    if (parsed.connections.length > MAX_CONNECTIONS) {
        return err(`That file has more than ${MAX_CONNECTIONS.toLocaleString('en')} connections`, 'too_large');
    }

    // Last row wins when an export lists the same person twice.
    const byUrl = new Map<string, ParsedConnection>();
    let skipped = parsed.skipped;
    for (const connection of parsed.connections) {
        if (!connection.profileUrl) {
            skipped += 1;
            continue;
        }
        byUrl.set(connection.profileUrl, connection);
    }

    const urls = [...byUrl.keys()];
    const existing = urls.length
        ? await prisma.contact.findMany({
            where: { userId, profileUrl: { in: urls } },
            select: { id: true, profileUrl: true, fullName: true, email: true, company: true, position: true, connectedOn: true },
        })
        : [];
    const existingByUrl = new Map(existing.map((row) => [row.profileUrl as string, row]));

    const toCreate: ParsedConnection[] = [];
    const toUpdate: { id: string; next: ParsedConnection }[] = [];
    for (const [url, next] of byUrl) {
        const current = existingByUrl.get(url);
        if (!current) toCreate.push(next);
        else if (changed(current, next)) toUpdate.push({ id: current.id, next });
    }

    let imported = 0;
    if (toCreate.length) {
        const created = await prisma.contact.createMany({
            data: toCreate.map((connection) => ({
                userId,
                fullName: connection.fullName,
                profileUrl: connection.profileUrl,
                email: connection.email,
                company: connection.company,
                normalizedCompany: connection.normalizedCompany,
                position: connection.position,
                connectedOn: connection.connectedOn,
                source: ContactSource.linkedin_export,
            })),
            // A concurrent import of the same file must not throw on the unique key.
            skipDuplicates: true,
        });
        imported = created.count;
    }

    for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
        const batch = toUpdate.slice(i, i + UPDATE_BATCH);
        await prisma.$transaction(batch.map(({ id, next }) => prisma.contact.update({
            where: { id },
            data: {
                fullName: next.fullName,
                email: next.email,
                company: next.company,
                normalizedCompany: next.normalizedCompany,
                position: next.position,
                connectedOn: next.connectedOn,
            },
        })));
    }

    return ok({
        imported,
        updated: toUpdate.length,
        skipped,
        total: await prisma.contact.count({ where: { userId } }),
    });
}

export async function contactStats(userId: string): Promise<{ total: number; lastImportedAt: string | null }> {
    const [total, latest] = await Promise.all([
        prisma.contact.count({ where: { userId } }),
        prisma.contact.findFirst({
            where: { userId, source: ContactSource.linkedin_export },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true },
        }),
    ]);
    return { total, lastImportedAt: latest?.updatedAt.toISOString() ?? null };
}
