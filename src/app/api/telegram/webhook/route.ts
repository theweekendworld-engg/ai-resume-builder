import { Channel } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { consumeChannelLinkToken } from '@/actions/channelIdentity';
import { processChannelGenerate } from '@/actions/channelGenerate';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import {
  answerTelegramCallbackQuery,
  sendTelegramMessage,
  verifyTelegramWebhookSecret,
} from '@/lib/telegram';

const TelegramUpdateSchema = z.object({
  update_id: z.number().optional(),
  message: z.object({
    message_id: z.number().optional(),
    text: z.string().optional(),
    chat: z.object({
      id: z.union([z.string(), z.number()]),
    }),
  }).optional(),
  callback_query: z.object({
    id: z.string(),
    data: z.string().optional(),
    message: z.object({
      chat: z.object({
        id: z.union([z.string(), z.number()]),
      }),
    }).optional(),
  }).optional(),
});

function escapeMarkdown(value: string): string {
  return value.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function parseStartPayload(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/start')) return null;
  const parts = trimmed.split(/\s+/);
  return parts.length > 1 ? parts[1] : '';
}

function buildCompletionReplyMarkup(sessionId: string, resumeUrl: string | null, pdfUrl: string | null) {
  const inline_keyboard: Array<Array<Record<string, string>>> = [];
  if (resumeUrl) {
    inline_keyboard.push([{ text: 'Open Resume', url: resumeUrl }]);
  }
  if (pdfUrl) {
    inline_keyboard.push([{ text: 'Download PDF', url: pdfUrl }]);
  }
  inline_keyboard.push([
    { text: 'Regenerate', callback_data: `regen:${sessionId}` },
    { text: 'Status', callback_data: `status:${sessionId}` },
  ]);
  return { inline_keyboard };
}

async function sendTelegramStatus(chatId: string, sessionId?: string) {
  const identity = await prisma.channelIdentity.findUnique({
    where: {
      channel_externalId: { channel: Channel.telegram, externalId: chatId },
    },
    select: { userId: true, verified: true },
  });
  if (!identity?.verified) {
    await sendTelegramMessage({ chatId, text: 'Channel not linked. Use /start link_<token> from your dashboard first.' });
    return;
  }

  const latest = await prisma.generationSession.findFirst({
    where: {
      userId: identity.userId,
      channel: Channel.telegram,
      ...(sessionId ? { id: sessionId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      status: true,
      currentStep: true,
      atsScore: true,
      resultResumeId: true,
      pdfUrl: true,
      errorMessage: true,
    },
  });
  if (!latest) {
    await sendTelegramMessage({
      chatId,
      text: 'No generation sessions found yet. Use /generate and paste a job description.',
    });
    return;
  }

  const atsText = typeof latest.atsScore === 'number' ? `\nATS estimate: ${latest.atsScore}%` : '';
  const resumeUrl = latest.resultResumeId ? `${config.app.url}/editor/${latest.resultResumeId}` : null;
  const linkText = resumeUrl ? `\nResume: ${resumeUrl}` : '';
  const errorText = latest.errorMessage ? `\nError: ${latest.errorMessage}` : '';
  await sendTelegramMessage({
    chatId,
    text: `Session ${latest.id}\nStatus: ${latest.status}\nStep: ${latest.currentStep}${atsText}${linkText}${errorText}`,
  });
}

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-telegram-bot-api-secret-token');
    if (!verifyTelegramWebhookSecret(secret)) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const payload = TelegramUpdateSchema.safeParse(await req.json().catch(() => ({})));
    if (!payload.success) {
      return NextResponse.json({ ok: true });
    }

    const callback = payload.data.callback_query;
    if (callback?.data) {
      const chatId = String(callback.message?.chat.id ?? '');
      if (chatId) {
        if (callback.data.startsWith('status:')) {
          await sendTelegramStatus(chatId, callback.data.split(':')[1]);
        } else if (callback.data.startsWith('regen:')) {
          const sessionId = callback.data.split(':')[1];
          const seed = await prisma.generationSession.findFirst({
            where: { id: sessionId, channel: Channel.telegram },
            select: { jobDescription: true },
          });
          if (!seed?.jobDescription) {
            await sendTelegramMessage({ chatId, text: 'Unable to regenerate from this session.' });
          } else {
            await sendTelegramMessage({ chatId, text: 'Regenerating now. I will update you shortly.' });
            const regenerated = await processChannelGenerate({
              channel: Channel.telegram,
              externalId: chatId,
              message: seed.jobDescription,
            });
            if (!regenerated.success) {
              await sendTelegramMessage({ chatId, text: `Regeneration failed: ${regenerated.error ?? 'Unknown error'}` });
            } else if (regenerated.status === 'completed') {
              const resumeUrl = regenerated.resumeId ? `${config.app.url}/editor/${regenerated.resumeId}` : null;
              await sendTelegramMessage({
                chatId,
                text: `Regeneration complete${typeof regenerated.atsEstimate === 'number' ? ` (ATS ${regenerated.atsEstimate}%)` : ''}.`,
                replyMarkup: buildCompletionReplyMarkup(regenerated.sessionId ?? sessionId, resumeUrl, regenerated.pdfUrl ?? null),
              });
            } else {
              await sendTelegramMessage({ chatId, text: 'Regeneration started. Use /status to track progress.' });
            }
          }
        }
      }
      await answerTelegramCallbackQuery(callback.id);
      return NextResponse.json({ ok: true });
    }

    const message = payload.data.message;
    if (!message?.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = String(message.chat.id);
    const text = message.text.trim();
    if (text === '/generate') {
      await sendTelegramMessage({
        chatId,
        text: 'Paste the full job description and I will generate a tailored resume. I may ask clarifying questions one-by-one.',
      });
      return NextResponse.json({ ok: true });
    }
    if (text === '/status') {
      await sendTelegramStatus(chatId);
      return NextResponse.json({ ok: true });
    }
    if (text.startsWith('/profile')) {
      const profileParts = text.replace('/profile', '').trim();
      if (!profileParts) {
        await sendTelegramMessage({
          chatId,
          text: 'To update quickly, use:\n/profile Full Name | Target Title | Years Experience\nOr update full profile in dashboard.',
        });
        return NextResponse.json({ ok: true });
      }
      const identity = await prisma.channelIdentity.findUnique({
        where: {
          channel_externalId: { channel: Channel.telegram, externalId: chatId },
        },
        select: { userId: true, verified: true },
      });
      if (!identity?.verified) {
        await sendTelegramMessage({ chatId, text: 'Link your account first, then use /profile.' });
        return NextResponse.json({ ok: true });
      }
      const [fullName = '', defaultTitle = '', yearsExperience = ''] = profileParts.split('|').map((part) => part.trim());
      await prisma.userProfile.upsert({
        where: { userId: identity.userId },
        create: { userId: identity.userId, fullName, defaultTitle, yearsExperience },
        update: {
          ...(fullName ? { fullName } : {}),
          ...(defaultTitle ? { defaultTitle } : {}),
          ...(yearsExperience ? { yearsExperience } : {}),
        },
      });
      await sendTelegramMessage({ chatId, text: 'Profile updated successfully.' });
      return NextResponse.json({ ok: true });
    }

    const startPayload = parseStartPayload(text);
    if (startPayload !== null) {
      if (!startPayload) {
        await sendTelegramMessage({
          chatId,
          text: 'Send a full job description to start resume generation. Use your dashboard to generate a Telegram linking code first.',
        });
        return NextResponse.json({ ok: true });
      }

      if (startPayload.startsWith('link_')) {
        const token = startPayload.slice('link_'.length);
        const linkResult = await consumeChannelLinkToken({
          channel: Channel.telegram,
          token,
          externalId: chatId,
        });

        if (!linkResult.success) {
          await sendTelegramMessage({
            chatId,
            text: `Link failed: ${escapeMarkdown(linkResult.error ?? 'Unknown error')}`,
          });
          return NextResponse.json({ ok: true });
        }

        await sendTelegramMessage({
          chatId,
          text: 'Telegram linked successfully. Now send the job description text and I will generate your tailored resume.',
        });

        return NextResponse.json({ ok: true });
      }

      await sendTelegramMessage({
        chatId,
        text: 'Invalid start payload. Generate a new link code from the dashboard and try again.',
      });
      return NextResponse.json({ ok: true });
    }

    await sendTelegramMessage({
      chatId,
      text: 'Processing your request... Step 1/4: understanding the job description.',
    });

    const result = await processChannelGenerate({
      channel: Channel.telegram,
      externalId: chatId,
      message: text,
    });

    if (!result.success) {
      await sendTelegramMessage({
        chatId,
        text: `Request failed: ${escapeMarkdown(result.error ?? 'Unknown error')}`,
      });
      return NextResponse.json({ ok: true });
    }

    if (result.status === 'awaiting_clarification') {
      const question = result.nextQuestion?.question ?? result.questions?.[0]?.question;
      await sendTelegramMessage({
        chatId,
        text: question
          ? `I need one clarification before finalizing:\n\n${escapeMarkdown(question)}`
          : 'I need clarification. Please answer the next question to continue.',
      });
      return NextResponse.json({ ok: true });
    }

    if (result.status === 'completed') {
      const resumeUrl = result.resumeId ? `${config.app.url}/editor/${result.resumeId}` : null;
      const ats = typeof result.atsEstimate === 'number' ? `ATS estimate: *${result.atsEstimate}%*\n` : '';
      const linkLine = resumeUrl ? `[Open resume](${resumeUrl})` : 'Resume generated.';

      await sendTelegramMessage({
        chatId,
        text: `${ats}${linkLine}`,
        replyMarkup: buildCompletionReplyMarkup(result.sessionId ?? 'latest', resumeUrl, result.pdfUrl ?? null),
      });
      return NextResponse.json({ ok: true });
    }

    await sendTelegramMessage({
      chatId,
      text: 'Generation is in progress. Step 2/4 complete. Use /status for live progress.',
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to process Telegram webhook',
      },
      { status: 500 }
    );
  }
}
