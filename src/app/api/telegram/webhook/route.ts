import { Channel } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { consumeChannelLinkToken } from '@/actions/channelIdentity';
import { processChannelGenerate } from '@/actions/channelGenerate';
import { config } from '@/lib/config';
import { sendTelegramMessage, verifyTelegramWebhookSecret } from '@/lib/telegram';

const TelegramUpdateSchema = z.object({
  update_id: z.number().optional(),
  message: z.object({
    message_id: z.number().optional(),
    text: z.string().optional(),
    chat: z.object({
      id: z.union([z.string(), z.number()]),
    }),
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

    const message = payload.data.message;
    if (!message?.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = String(message.chat.id);
    const text = message.text.trim();

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
      });
      return NextResponse.json({ ok: true });
    }

    await sendTelegramMessage({
      chatId,
      text: 'Generation is in progress. Send your next clarification answer if prompted.',
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
