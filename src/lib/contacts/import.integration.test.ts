import { afterAll, describe, expect, test } from 'bun:test';
import { prisma } from '@/lib/prisma';
import { contactStats, importConnectionsCsv } from './import';
import { CONNECTIONS_FIXTURE } from './linkedinExport.fixture';

const USER = `itest-contacts-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

afterAll(async () => {
    await prisma.contact.deleteMany({ where: { userId: USER } });
});

describe('importConnectionsCsv', () => {
    test('imports rows with a profile url and skips the rest', async () => {
        const result = await importConnectionsCsv(USER, CONNECTIONS_FIXTURE);
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data).toEqual({ imported: 3, updated: 0, skipped: 2, total: 3 });
    });

    test('re-importing the same file changes nothing and duplicates nothing', async () => {
        const result = await importConnectionsCsv(USER, CONNECTIONS_FIXTURE);
        expect(result.success && result.data).toEqual({ imported: 0, updated: 0, skipped: 2, total: 3 });
    });

    test('a job change in next month\'s export updates the existing row', async () => {
        const moved = CONNECTIONS_FIXTURE.replace('Razorpay,"Senior Engineer ""Platform"""', 'Stripe,Staff Engineer');
        const result = await importConnectionsCsv(USER, moved);
        expect(result.success && result.data.updated).toBe(1);
        const neha = await prisma.contact.findFirst({ where: { userId: USER, fullName: 'Neha' } });
        expect(neha?.company).toBe('Stripe');
        expect(neha?.position).toBe('Staff Engineer');
    });

    test('the wrong file is refused with instructions', async () => {
        const result = await importConnectionsCsv(USER, 'name,phone\nA,1');
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('unrecognised_file');
    });

    test('contactStats', async () => {
        const stats = await contactStats(USER);
        expect(stats.total).toBe(3);
        expect(stats.lastImportedAt).not.toBeNull();
    });
});
