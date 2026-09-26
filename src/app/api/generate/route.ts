import { auth } from '@clerk/nextjs/server';
import { Channel } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { processChannelGenerate } from '@/services/channelGenerate';

/**
 * Session-only. This route used to accept `channel` and `externalId` from the
 * body and, for a non-web channel, resolve the user from a Telegram/WhatsApp
 * chat id, so any signed-in caller could generate as another user by naming
 * their chat. Chat channels reach generation through their own verified
 * webhooks (`src/services/telegramAgent.ts`), never through this route.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const result = await processChannelGenerate({
      sessionId: body?.sessionId,
      userId,
      sourceResumeId: body?.sourceResumeId,
      channel: Channel.web,
      message: body?.message,
      fallbackResumeData: body?.fallbackResumeData,
      maxQuestions: body?.maxQuestions,
    });

    if (!result.success) {
      const status = result.error === 'Not authenticated' ? 401 : 400;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process generate request',
      },
      { status: 500 }
    );
  }
}
