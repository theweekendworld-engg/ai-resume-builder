/**
 * Account deletion removes everything for one user and nothing for anyone else.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { WinCategory, WinSource, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { restoreFlags, snapshotFlags, type FlagSnapshot } from '@/lib/flags.test-utils';
import { setFeatureFlagAllowListForTest } from './accountDeletion.test-utils';
import { deleteUserData, userOwnedModels } from './accountDeletion';

const RUN = `itest-del-${Date.now()}`;
const VICTIM = `${RUN}-me`;
const OTHER = `${RUN}-other`;
let flags: FlagSnapshot = [];

async function seed(userId: string) {
    await prisma.userProfile.create({ data: { userId, fullName: 'Del Test', email: `${userId}@example.com` } });
    const win = await prisma.win.create({
        data: { userId, title: 't', narrative: 'n', occurredAt: new Date(), category: WinCategory.shipped, source: WinSource.manual, status: WinStatus.confirmed },
    });
    const evidence = await prisma.evidence.create({ data: { userId, kind: 'metric_confirmed', sourceRef: RUN, excerpt: 'x', confirmedByUser: true } });
    await prisma.claimLink.create({ data: { userId, claimType: 'win', claimRefId: win.id, evidenceId: evidence.id, groundState: 'grounded' } });
    const convo = await prisma.chatConversation.create({ data: { userId } });
    await prisma.chatMessage.create({ data: { conversationId: convo.id, userId, role: 'user', text: 'hi' } });
    const run = await prisma.agentRun.create({ data: { userId, agent: 'scout', inputKey: `${userId}-k`, status: 'succeeded', channel: 'web', input: {} } });
    await prisma.agentStep.create({ data: { runId: run.id, name: 'ingest', status: 'succeeded', attempt: 1 } });
    await prisma.apiUsageLog.create({ data: { userId, operation: 'x', provider: 'openai', model: 'm' } });
    return { runId: run.id };
}

beforeAll(async () => {
    flags = await snapshotFlags();
});

afterAll(async () => {
    await deleteUserData(OTHER);
    await restoreFlags(flags);
});

describe('deleteUserData', () => {
    test('the model list is read from the schema and covers the core tables', () => {
        const models = userOwnedModels();
        for (const name of ['win', 'evidence', 'claimLink', 'chatMessage', 'agentRun', 'resume', 'channelIdentity', 'extensionAccessToken', 'vectorPoint', 'apiUsageLog']) {
            expect(models).toContain(name);
        }
    });

    test('removes every row for the user, cascades children, and leaves others alone', async () => {
        const mine = await seed(VICTIM);
        await seed(OTHER);
        await setFeatureFlagAllowListForTest('chat', [VICTIM, OTHER]);
        await prisma.extensionConnectGrant.create({
            data: { client: 'chrome', verifierHash: `${RUN}-h`, expiresAt: new Date(Date.now() + 60_000), approvedUserId: VICTIM },
        });

        const report = await deleteUserData(VICTIM);
        expect(report.leftovers).toEqual([]);

        for (const model of userOwnedModels()) {
            const delegate = (prisma as unknown as Record<string, { count: (a: object) => Promise<number> }>)[model];
            expect({ model, left: await delegate.count({ where: { userId: VICTIM } }) }).toEqual({ model, left: 0 });
        }
        expect(await prisma.agentStep.count({ where: { runId: mine.runId } })).toBe(0);
        expect(await prisma.extensionConnectGrant.count({ where: { approvedUserId: VICTIM } })).toBe(0);
        const chat = await prisma.featureFlag.findUniqueOrThrow({ where: { key: 'chat' } });
        expect(chat.allowUserIds).toEqual([OTHER]);

        // The other user is untouched.
        expect(await prisma.win.count({ where: { userId: OTHER } })).toBe(1);
        expect(await prisma.chatMessage.count({ where: { userId: OTHER } })).toBe(1);
        expect(await prisma.userProfile.count({ where: { userId: OTHER } })).toBe(1);
    });
});
