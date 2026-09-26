'use server';

/**
 * The browser's entry to channel generation. Identity comes from the SESSION
 * and nothing else: `userId`, `channel` and `externalId` in the input are
 * ignored, because this export is a public endpoint and those are fields a
 * caller could set to someone else's. The implementation, which trusts its
 * caller, is `src/services/channelGenerate.ts`.
 */

import { auth } from '@clerk/nextjs/server';
import { Channel } from '@prisma/client';
import {
    processChannelGenerate as processForTrustedCaller,
    type ChannelGenerateResponse,
} from '@/services/channelGenerate';

export type { ChannelGenerateResponse };

export async function processChannelGenerate(input: unknown): Promise<ChannelGenerateResponse> {
    const { userId } = await auth();
    if (!userId) return { success: false, error: 'Not authenticated' } as ChannelGenerateResponse;
    const fields = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const { userId: _ignoredUserId, externalId: _ignoredExternalId, channel: _ignoredChannel, ...rest } = fields;
    void _ignoredUserId;
    void _ignoredExternalId;
    void _ignoredChannel;
    return processForTrustedCaller({ ...rest, userId, channel: Channel.web });
}
