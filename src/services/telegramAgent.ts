import { Channel, GenerationStatus } from '@prisma/client';
import { z } from 'zod';
import { consumeChannelLinkToken, describeAccount, unlinkChatByExternalId } from '@/actions/channelIdentity';
import { routeClarificationReply, nextClarificationQuestion } from '@/lib/channels/clarification';
import { escapeTelegramHtml } from '@/lib/channels/format';
import {
  UNLINK_CONFIRM,
  alreadyLinkedText,
  conflictText,
  linkedText,
  notLinkedText,
  unlinkedText,
  welcomeBackText,
} from '@/lib/channels/linkCopy';
import { processChannelGenerate } from '@/services/channelGenerate';
import { config } from '@/lib/config';
import { getGenerationProgressPercent, getGenerationStageLabel } from '@/lib/generationProgress';
import { prisma } from '@/lib/prisma';
import {
  answerTelegramCallbackQuery,
  sendTelegramMessage,
  sendTelegramMessageDetailed,
} from '@/lib/telegram';
import {
  handleTelegramInboxCommand,
  handleTelegramScoutCallback,
  handleTelegramScoutCommand,
  handleTelegramScoutText,
} from '@/lib/channels/telegramInbound';
import { parseInboxCommand, renderHelp } from '@/lib/channels/inboxCommands';
import { sendTelegramRich } from '@/lib/channels/telegramScout';

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
      message_id: z.number().optional(),
      chat: z.object({
        id: z.union([z.string(), z.number()]),
      }),
      // The keyboard the tapped button sat on, so spent buttons can be removed
      // without taking the others with them.
      reply_markup: z.object({
        inline_keyboard: z.array(z.array(z.record(z.string(), z.unknown()))),
      }).optional(),
    }).optional(),
  }).optional(),
});

/** A verified Telegram → user link, or null. */
async function findLinkedUserId(chatId: string): Promise<string | null> {
  const identity = await prisma.channelIdentity.findUnique({
    where: {
      channel_externalId: { channel: Channel.telegram, externalId: chatId },
    },
    select: { userId: true, verified: true },
  });
  return identity?.verified ? identity.userId : null;
}

export type TelegramUpdatePayload = z.infer<typeof TelegramUpdateSchema>;

/** Plain text, escaped for HTML mode: names and emails may contain `_` or `*`. */
async function sayPlain(chatId: string, text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  await sendTelegramMessageDetailed({ chatId, text: escapeTelegramHtml(text), ...(replyMarkup ? { replyMarkup } : {}) });
}

/** A generation refusal's way forward, keyed on the service's machine code. */
function failureNextStep(code: string | undefined): string {
  const app = config.app.url.replace(/\/$/, '');
  if (code === 'entitlement_required') return `\n\nSee plans: ${app}/settings/plan`;
  if (code === 'empty_profile' || code === 'no_base_resume') return `\n\nAdd your resume first: ${app}/dashboard?section=profile`;
  return '';
}

function telegramDashboardUrl(): string {
  return `${config.app.url.replace(/\/$/, '')}/dashboard?section=telegram`;
}

/** Unlink confirmation buttons. Short, outside the `sc:` namespace. */
const UNLINK_KEYBOARD = {
  inline_keyboard: [[
    { text: 'Unlink this chat', callback_data: 'ul:yes' },
    { text: 'Keep it', callback_data: 'ul:no' },
  ]],
};

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
      if (callback.data === 'ul:yes') {
        const { removed } = await unlinkChatByExternalId(Channel.telegram, chatId);
        await sayPlain(chatId, removed > 0 ? unlinkedText(telegramDashboardUrl()) : 'This chat was not linked.');
      } else if (callback.data === 'ul:no') {
        await sayPlain(chatId, 'Kept. This chat stays linked.');
      } else if (callback.data.startsWith('sc:')) {
        // Scout buttons (answer / draft / why / refresh). Ownership of the run
        // is checked by the service, so the user id must come from the link.
        const userId = await findLinkedUserId(chatId);
        if (!userId) {
          await sendTelegramMessage({ chatId, text: 'Link your account first, then try again.' });
        } else {
          await handleTelegramScoutCallback(
            chatId,
            userId,
            callback.data,
            callback.message?.message_id ?? null,
            callback.message?.reply_markup?.inline_keyboard ?? null,
          );
        }
      } else if (callback.data.startsWith('status:')) {
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
            // A regenerate of your own recent session is free (capped by the
            // service); without this it charged a second tailored resume.
            regenerateOfSessionId: sessionId,
          });
          if (!regenerated.success) {
            await sendTelegramMessage({ chatId, text: `Regeneration failed: ${regenerated.error ?? 'Unknown error'}${failureNextStep(regenerated.code)}` });
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

  // /help needs no linked account: it is how an unlinked user finds out what
  // the bot does.
  if (parseInboxCommand(text, { allowBare: false }) === 'help') {
    await sendTelegramRich(chatId, renderHelp(config.app.url, { bare: false }), 'none');
    return;
  }

  // /unlink needs no Scout flag and no generation state: it only asks whether
  // to disconnect the chat the message came from.
  if (/^\/unlink\b/.test(text)) {
    const linked = await findLinkedUserId(chatId);
    if (!linked) {
      await sayPlain(chatId, 'This chat is not linked to Patronus.');
      return;
    }
    await sayPlain(chatId, `${UNLINK_CONFIRM}\n\nLinked to: ${await describeAccount(linked)}`, UNLINK_KEYBOARD);
    return;
  }

  if (text.startsWith('/') && !/^\/(start|generate|status|profile|scout|jobs|applied|insights|notes|help|unlink)\b/.test(text)) {
    await sendTelegramMessage({
      chatId,
      text: 'Unknown command. Available commands:\n/start - Link account or see welcome info\n/scout - Analyse a LinkedIn job or post link\n/jobs - Your best fits to review\n/applied - Jobs you applied to\n/insights - Your saved insights\n/notes - Your Work Log notes\n/help - Everything the bot can do\n/generate - Start a new resume\n/status - Check generation progress\n/profile - View your profile details\n/unlink - Disconnect this chat',
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
        const linkedUser = await findLinkedUserId(chatId);
        await sayPlain(chatId, welcomeBackText(linkedUser ? await describeAccount(linkedUser) : 'your Patronus account', { bare: false }));
      } else {
        await sayPlain(chatId, notLinkedText(telegramDashboardUrl(), 'Telegram'));
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
        // A chat already linked to ANOTHER account: say which (masked) and
        // how to move it. The old "Your account is already linked" hid this,
        // and the chat kept recording into the other account.
        if (linkResult.code === 'linked_to_other' && linkResult.otherUserId) {
          await sayPlain(chatId, conflictText({
            otherAccount: await describeAccount(linkResult.otherUserId),
            app: 'Telegram',
            unlinkCommand: '/unlink',
          }));
          return;
        }
        const linkedUser = await findLinkedUserId(chatId);
        if (linkedUser) {
          await sayPlain(chatId, alreadyLinkedText(await describeAccount(linkedUser)));
          return;
        }
        await sayPlain(chatId, `That link did not work: ${linkResult.error ?? 'unknown error'}.\n\nGet a fresh one at ${telegramDashboardUrl()} (tap "Link Telegram").`);
        return;
      }

      await sayPlain(chatId, linkedText(await describeAccount(linkResult.userId ?? ''), { bare: false }));
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
    await sayPlain(chatId, notLinkedText(telegramDashboardUrl(), 'Telegram'));
    return;
  }

  const pendingSession = await prisma.generationSession.findFirst({
    where: {
      userId: identity.userId,
      channel: Channel.telegram,
      status: GenerationStatus.awaiting_clarification,
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, updatedAt: true, clarifications: true },
  });

  // `/scout <link>` is explicit, so it wins over everything — including an
  // open resume clarification, which it would otherwise be mistaken for.
  if (/^\/scout\b/.test(text)) {
    await handleTelegramScoutCommand(chatId, identity.userId, text.replace(/^\/scout\b/, '').trim());
    return;
  }

  // Inbox lookups are explicit commands too, so they also win over an open
  // resume clarification.
  const inboxCommand = parseInboxCommand(text, { allowBare: false });
  if (inboxCommand) {
    await handleTelegramInboxCommand(chatId, identity.userId, inboxCommand);
    return;
  }

  if (isGenerateCommand && !generatePayload) {
    await sendTelegramMessage({
      chatId,
      text: 'Invalid usage. Send:\n/generate <full job description>',
    });
    return;
  }

  // An open resume clarification takes a message only when it plausibly
  // answers it: recent, not a link, not a pasted post; "skip" / "skip all"
  // always skip. Anything else goes on to Scout below, and the question is
  // mentioned so it is not forgotten. Users without Scout keep the old
  // behaviour (every message answers), since there is nowhere else for it.
  const clarificationRoute = pendingSession && !isGenerateCommand
    ? routeClarificationReply({ text, askedAt: pendingSession.updatedAt })
    : null;
  const scoutOn = clarificationRoute === 'pass'
    ? await handleTelegramScoutText(chatId, identity.userId, text)
    : false;
  if (scoutOn && pendingSession) {
    const question = nextClarificationQuestion(pendingSession.clarifications);
    await sayPlain(chatId, question
      ? `(Your resume question is still open: "${question}" Reply to it, or send "skip".)`
      : '(A resume question is still open. Send /status to see it, or "skip all" to generate now.)');
    return;
  }

  if (pendingSession && !isGenerateCommand) {
    const result = await processChannelGenerate({
      channel: Channel.telegram,
      externalId: chatId,
      sessionId: pendingSession.id,
      ...(clarificationRoute === 'skip'
        ? { skip: true }
        : clarificationRoute === 'skip_all'
          ? { skipAll: true }
          : { message: text }),
    });

    if (!result.success) {
      await sendTelegramMessage({
        chatId,
        text: `Request failed: ${escapeMarkdown(result.error ?? 'Unknown error')}${failureNextStep(result.code)}`,
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

  // Scout comes AFTER the resume clarification branch above, deliberately:
  // an open /generate clarification keeps precedence for free text, exactly as
  // before Scout existed. With the flag on, every other message is recorded
  // here: links, pasted posts, notes about the user's work, and replies to a
  // Scout question.
  if (!isGenerateCommand && await handleTelegramScoutText(chatId, identity.userId, text)) {
    return;
  }

  if (!isGenerateCommand) {
    await sendTelegramMessage({
      chatId,
      text: 'Unsupported input. Use one of:\n/scout <LinkedIn job or post link>\n/generate <job description>\n/status\n/help',
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
      text: `Request failed: ${escapeMarkdown(result.error ?? 'Unknown error')}${failureNextStep(result.code)}`,
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
