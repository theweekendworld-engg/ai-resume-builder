import { auth } from '@clerk/nextjs/server';
import { Channel } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { processChannelGenerate } from '@/actions/channelGenerate';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const requestedChannel = typeof body?.channel === 'string' ? body.channel : 'web';
    const channel = requestedChannel === Channel.telegram || requestedChannel === Channel.whatsapp || requestedChannel === Channel.email
      ? requestedChannel
      : Channel.web;

    const authUserId = channel === Channel.web ? (await auth()).userId : undefined;

    const result = await processChannelGenerate({
      sessionId: body?.sessionId,
      userId: authUserId,
      sourceResumeId: body?.sourceResumeId,
      channel,
      externalId: body?.externalId,
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
