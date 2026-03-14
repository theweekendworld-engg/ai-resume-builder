import { Channel } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { processChannelGenerate } from '@/actions/channelGenerate';
import { authenticateApiKey } from '@/app/api/v1/_utils';

const GenerateInputSchema = z.object({
  userId: z.string().min(1).max(255),
  message: z.string().min(20).max(50000),
  sessionId: z.string().cuid().optional(),
  sourceResumeId: z.string().cuid().optional(),
  maxQuestions: z.number().int().min(1).max(5).optional(),
  fallbackResumeData: z.unknown().optional(),
});

export async function POST(req: NextRequest) {
  const authResult = authenticateApiKey(req);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = GenerateInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') },
        { status: 400 }
      );
    }

    const result = await processChannelGenerate({
      userId: parsed.data.userId,
      channel: Channel.web,
      message: parsed.data.message,
      sessionId: parsed.data.sessionId,
      sourceResumeId: parsed.data.sourceResumeId,
      maxQuestions: parsed.data.maxQuestions,
      fallbackResumeData: parsed.data.fallbackResumeData,
    });

    const status = result.success ? 200 : 400;
    return NextResponse.json(result, { status });
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
