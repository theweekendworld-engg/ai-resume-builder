import { Channel, GenerationStatus } from '@prisma/client';
import { z } from 'zod';
import { consumeChannelLinkToken } from '@/actions/channelIdentity';
import { processChannelGenerate } from '@/actions/channelGenerate';
import { config } from '@/lib/config';
import { getGenerationProgressPercent, getGenerationStageLabel } from '@/lib/generationProgress';
import { prisma } from '@/lib/prisma';
import {
  answerTelegramCallbackQuery,
  sendTelegramMessage,
} from '@/lib/telegram';

export const TelegramUpdateSchema = z.object({
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

export type TelegramUpdatePayload = z.infer<typeof TelegramUpdateSchema>;

function escapeMarkdown(value: string): string {
  return value.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function parseStartPayload(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/start')) return null;
  const parts = trimmed.split(/\s+/);
  return parts.length > 1 ? parts[1] : '';
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
      stepStartedAt: true,
      startedAt: true,
      atsScore: true,
      resultResumeId: true,
      pdfUrl: true,
      errorMessage: true,
    },
  });
  if (!latest) {
    await sendTelegramMessage({
      chatId,
      text: 'No generation sessions found yet. Use /generate <job description> to start.',
    });
    return;
  }

  const atsText = typeof latest.atsScore === 'number' ? `\nATS estimate: ${latest.atsScore}%` : '';
  const resumeUrl = latest.resultResumeId ? `${config.app.url}/editor/${latest.resultResumeId}` : null;
  const linkText = resumeUrl ? `\nResume: ${resumeUrl}` : '';
  const errorText = latest.errorMessage ? `\nError: ${latest.errorMessage}` : '';
  const progress = latest.status === 'completed'
    ? ''
    : `\nProgress: ${getGenerationProgressPercent(latest.currentStep)}%`;
  await sendTelegramMessage({
    chatId,
    text: `Session ${latest.id}\nStatus: ${latest.status}\nStep: ${getGenerationStageLabel(latest.currentStep)}${progress}${atsText}${linkText}${errorText}`,
  });
}

export async function processTelegramUpdate(update: TelegramUpdatePayload): Promise<void> {
  if (typeof update.update_id === 'number') {
    const receipt = await prisma.telegramUpdateReceipt.findUnique({
      where: { updateId: String(update.update_id) },
      select: { id: true },
    });
    if (receipt) {
      return;
    }
    const created = await prisma.telegramUpdateReceipt.create({
      data: {
        updateId: String(update.update_id),
      },
    }).then(() => true).catch(() => false);
    if (!created) {
      return;
    }
  }

  const callback = update.callback_query;
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
          } else {
            await sendTelegramMessage({ chatId, text: 'Regeneration started. Use /status to track progress.' });
          }
        }
      }
    }
    await answerTelegramCallbackQuery(callback.id);
    return;
  }

  const message = update.message;
  if (!message?.text) {
    return;
  }

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const isGenerateCommand = text.startsWith('/generate');
  const generatePayload = isGenerateCommand ? text.replace(/^\/generate\b/, '').trim() : null;

  if (text === '/status') {
    await sendTelegramStatus(chatId);
    return;
  }

  if (text.startsWith('/profile')) {
    const identity = await prisma.channelIdentity.findUnique({
      where: {
        channel_externalId: { channel: Channel.telegram, externalId: chatId },
      },
      select: { userId: true, verified: true },
    });
    if (!identity?.verified) {
      await sendTelegramMessage({ chatId, text: 'Link your account first, then use /profile.' });
      return;
    }
    const profile = await prisma.userProfile.findUnique({
      where: { userId: identity.userId },
      select: {
        fullName: true,
        email: true,
        phone: true,
        location: true,
        defaultTitle: true,
        yearsExperience: true,
      },
    });
    const notSet = 'Not set';
    await sendTelegramMessage({
      chatId,
      text: `Your profile details:\n\nFull name: ${escapeMarkdown(profile?.fullName?.trim() || notSet)}\nEmail: ${escapeMarkdown(profile?.email?.trim() || notSet)}\nPhone: ${escapeMarkdown(profile?.phone?.trim() || notSet)}\nLocation: ${escapeMarkdown(profile?.location?.trim() || notSet)}\nTarget title: ${escapeMarkdown(profile?.defaultTitle?.trim() || notSet)}\nYears experience: ${escapeMarkdown(profile?.yearsExperience?.trim() || notSet)}\n\nTo update profile, use the dashboard profile section.`,
    });
    return;
  }

  if (text.startsWith('/') && !/^\/(start|generate|status|profile)\b/.test(text)) {
    await sendTelegramMessage({
      chatId,
      text: 'Unknown command. Available commands:\n/start - Link account or see welcome info\n/generate - Start a new resume\n/status - Check generation progress\n/profile - View your profile details',
    });
    return;
  }

  const startPayload = parseStartPayload(text);
  if (startPayload !== null) {
    if (!startPayload) {
      const existingIdentity = await prisma.channelIdentity.findUnique({
        where: {
          channel_externalId: { channel: Channel.telegram, externalId: chatId },
        },
        select: { verified: true },
      });
      if (existingIdentity?.verified) {
        await sendTelegramMessage({
          chatId,
          text: 'Welcome back! Your account is linked.\n\nUse:\n/generate <job description> - start a new resume\n/status - check progress\n/profile - view your profile details',
        });
      } else {
        const dashboardUrl = `${config.app.url}/dashboard?section=telegram`;
        await sendTelegramMessage({
          chatId,
          text: `Welcome to Patronus!\n\nTo get started, link your account from the dashboard first:\n[Open Dashboard](${dashboardUrl})\n\nOnce linked, use /generate <job description> to create a tailored resume.`,
        });
      }
      return;
    }

    if (startPayload.startsWith('link_')) {
      const token = startPayload.slice('link_'.length);
      const linkResult = await consumeChannelLinkToken({
        channel: Channel.telegram,
        token,
        externalId: chatId,
      });

      if (!linkResult.success) {
        const alreadyLinked = await prisma.channelIdentity.findUnique({
          where: {
            channel_externalId: { channel: Channel.telegram, externalId: chatId },
          },
          select: { verified: true },
        });
        if (alreadyLinked?.verified) {
          await sendTelegramMessage({
            chatId,
            text: 'Your account is already linked. Use /generate <job description> to get started!',
          });
          return;
        }
        const dashboardUrl = `${config.app.url}/dashboard?section=telegram`;
        await sendTelegramMessage({
          chatId,
          text: `Link failed: ${escapeMarkdown(linkResult.error ?? 'Unknown error')}\n\n[Generate a new link from the dashboard](${dashboardUrl})`,
        });
        return;
      }

      await sendTelegramMessage({
        chatId,
        text: 'Telegram linked successfully. Use /generate <job description> to start your tailored resume.',
      });

      return;
    }

    await sendTelegramMessage({
      chatId,
      text: 'Invalid start payload. Generate a new link code from the dashboard and try again.',
    });
    return;
  }

  const identity = await prisma.channelIdentity.findUnique({
    where: {
      channel_externalId: { channel: Channel.telegram, externalId: chatId },
    },
    select: { userId: true, verified: true },
  });

  if (!identity?.verified) {
    const dashboardUrl = `${config.app.url}/dashboard?section=telegram`;
    await sendTelegramMessage({
      chatId,
      text: `Your Telegram is not linked yet.\n\n[Link your account from the dashboard](${dashboardUrl})\n\nOnce linked, use /generate <job description> to start.`,
    });
    return;
  }

  const pendingSession = await prisma.generationSession.findFirst({
    where: {
      userId: identity.userId,
      channel: Channel.telegram,
      status: GenerationStatus.awaiting_clarification,
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });

  if (isGenerateCommand && !generatePayload) {
    await sendTelegramMessage({
      chatId,
      text: 'Invalid usage. Send:\n/generate <full job description>',
    });
    return;
  }

  if (pendingSession && !isGenerateCommand) {
    const result = await processChannelGenerate({
      channel: Channel.telegram,
      externalId: chatId,
      sessionId: pendingSession.id,
      message: text,
    });

    if (!result.success) {
      await sendTelegramMessage({
        chatId,
        text: `Request failed: ${escapeMarkdown(result.error ?? 'Unknown error')}`,
      });
      return;
    }

    if (result.status === 'awaiting_clarification') {
      const question = result.nextQuestion?.question ?? result.questions?.[0]?.question;
      await sendTelegramMessage({
        chatId,
        text: question
          ? escapeMarkdown(question)
          : 'Please answer the next question to continue.',
      });
      return;
    }

    await sendTelegramMessage({
      chatId,
      text: 'All clarifications received. Generation started. Use /status for progress.',
    });
    return;
  }

  if (!isGenerateCommand) {
    await sendTelegramMessage({
      chatId,
      text: 'Unsupported input. Use one of:\n/generate <job description>\n/status\n/profile',
    });
    return;
  }

  const jobDescription = generatePayload ?? '';
  await sendTelegramMessage({
    chatId,
    text: 'Processing your request. Creating a generation session now.',
  });

  const result = await processChannelGenerate({
    channel: Channel.telegram,
    externalId: chatId,
    message: jobDescription,
  });

  if (!result.success) {
    await sendTelegramMessage({
      chatId,
      text: `Request failed: ${escapeMarkdown(result.error ?? 'Unknown error')}`,
    });
    return;
  }

  if (result.status === 'awaiting_clarification') {
    const question = result.nextQuestion?.question ?? result.questions?.[0]?.question;
    await sendTelegramMessage({
      chatId,
      text: question
        ? `I need one clarification before finalizing:\n\n${escapeMarkdown(question)}`
        : 'I need clarification. Please answer the next question to continue.',
    });
    return;
  }

  await sendTelegramMessage({
    chatId,
    text: 'Generation started. Use /status for live progress.',
  });
}
