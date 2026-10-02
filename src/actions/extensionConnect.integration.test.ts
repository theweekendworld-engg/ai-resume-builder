/**
 * Extension connect: viewing the page changes nothing; only the tap approves,
 * and only for the signed-in user (launch audit 2026-10-02: the page used to
 * approve on render, so a sent link handed the sender a token for the viewer).
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { installClerkMock } from '@/__mocks__/clerk';
import { prisma } from '@/lib/prisma';
import { createExtensionConnectGrant, readExtensionConnectGrant } from '@/lib/extension/connect';

const clerk = installClerkMock();
const { approveExtensionConnect } = await import('./extensionConnect');

const VICTIM = `itest-extconnect-${Date.now()}`;
const grants: string[] = [];

afterAll(async () => {
    await prisma.extensionConnectGrant.deleteMany({ where: { id: { in: grants } } });
    clerk.signOut();
});

async function tap(grantId: string): Promise<string> {
    const form = new FormData();
    form.set('grantId', grantId);
    try {
        await approveExtensionConnect(form);
        return 'no redirect';
    } catch (error) {
        // next/navigation redirect() throws; its digest carries the target.
        return String((error as { digest?: string }).digest ?? error);
    }
}

describe('extension connect', () => {
    test('reading the grant (what the page does) never approves it', async () => {
        const grant = await createExtensionConnectGrant();
        grants.push(grant.grantId);
        expect(await readExtensionConnectGrant(grant.grantId, VICTIM)).toBe('pending');
        expect(await readExtensionConnectGrant(grant.grantId, VICTIM)).toBe('pending');
        const row = await prisma.extensionConnectGrant.findUniqueOrThrow({ where: { id: grant.grantId } });
        expect(row.approvedUserId).toBeNull();
    });

    test('the tap approves it for the signed-in user', async () => {
        const grant = await createExtensionConnectGrant();
        grants.push(grant.grantId);
        clerk.signIn(VICTIM);
        const where = await tap(grant.grantId);
        expect(where).toContain('result=approved');
        const row = await prisma.extensionConnectGrant.findUniqueOrThrow({ where: { id: grant.grantId } });
        expect(row.approvedUserId).toBe(VICTIM);
    });

    test('signed out, the tap approves nothing and sends you to sign in', async () => {
        const grant = await createExtensionConnectGrant();
        grants.push(grant.grantId);
        clerk.signOut();
        expect(await tap(grant.grantId)).toContain('/sign-in');
        const row = await prisma.extensionConnectGrant.findUniqueOrThrow({ where: { id: grant.grantId } });
        expect(row.approvedUserId).toBeNull();
    });
});
