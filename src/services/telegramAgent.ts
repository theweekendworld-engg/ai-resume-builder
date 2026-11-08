import { Channel, GenerationStatus } from '@prisma/client';
import { z } from 'zod';
import { consumeChannelLinkToken, describeAccount, unlinkChatByExternalId } from '@/actions/channelIdentity';
import { CLARIFICATION_REPLY_HINT, clarificationProgress, questionsIntro, routeClarificationReply, nextClarificationQuestion } from '@/lib/channels/clarification';
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
import { rememberedNote } from '@/lib/memory/format';
import { config } from '@/lib/config';
import { getGenerationProgressPercent, getGenerationStageLabel } from '@/lib/generationProgress';
import { prisma } from '@/lib/prisma';
import { draftFocusedSince } from '@/lib/chat/focus';
import {
  answerTelegramCallbackQuery,
  sendTelegramMessageDetailed,
} from '@/lib/telegram';
import {
  handleTelegramInboxCommand,
  handleTelegramScoutCallback,
  handleTelegramScoutCommand,
  handleTelegramScoutText,
  type ShareHint,
} from '@/lib/channels/telegramInbound';
import { parseInboxCommand, renderHelp } from '@/lib/channels/inboxCommands';
import { sendTelegramRich } from '@/lib/channels/telegramScout';
import {
  TELEGRAM_MEDIA_FIELDS,
  UNREADABLE_FILE_TEXT,
  classifyTelegramAttachment,
  composeFileText,
  readTelegramDocument,
  truncatedFileNotice,
} from '@/lib/channels/telegramFiles';
import { alertOperators } from '@/lib/opsAlert';
import { checkRateLimit } from '@/lib/rateLimit';

export const TelegramUpdateSchema = z.object({
  update_id: z.number().optional(),
  message: z.object({
    message_id: z.number().optional(),
    text: z.string().optional(),
    // A PDF or text file is read as if pasted; other media gets one sentence
    // (src/lib/channels/telegramFiles.ts).
    ...TELEGRAM_MEDIA_FIELDS,
    chat: z.object({
      id: z.union([z.string(), z.number()]),
      /** private | group | supergroup | channel. Only private chats are served. */
      type: z.string().optional(),
    }),
  }).optional(),
  callback_query: z.object({
    id: z.string(),
    data: z.string().optional(),
    message: z.object({
      message_id: z.number().optional(),
      chat: z.object({
        id: z.union([z.string(), z.number()]),
        type: z.string().optional(),
      }),
      // The keyboard the tapped button sat on, so spent buttons can be removed
      // without taking the others with them.
      reply_markup: z.object({
        inline_keyboard: z.array(z.array(z.record(z.string(), z.unknown()))),
      }).optional(),
    }).optional(),
  }).optional(),
});

/** True when a draft is in focus on Telegram and was focused after `since`. */
async function draftFocusIsNewerThan(userId: string, since: Date): Promise<boolean> {
  return draftFocusedSince(userId, Channel.telegram, since);
}

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
  // "Your usage", not "plans": during the launch there is nothing to buy.
  if (code === 'entitlement_required') return `\n\nYour usage: ${app}/settings/plan`;
  if (code === 'empty_profile' || code === 'no_base_resume') return `\n\nAdd your resume first: ${app}/dashboard?section=profile`;
  return '';
}

/** Refusals whose `error` the generation service wrote for the user to read. */
const USER_FACING_GENERATION_CODES = new Set(['entitlement_required', 'empty_profile', 'no_base_resume', 'enqueue_failed']);

const GENERATION_FAILED_TEXT =
  'Something went wrong on our side with that resume. Send /status to see where it stands, or /generate with the job description to start again.';

/**
 * Say why a generation request failed. A coded refusal (a plan limit, an
 * empty profile) keeps its own sentence and next step. Anything else is an
 * internal message ("Clarification state is invalid for this session") that
 * the user cannot act on: they get plain copy, and the operators get the text.
 */
async function sayGenerationFailure(chatId: string, result: { error?: string; code?: string }): Promise<void> {
  if (result.code && USER_FACING_GENERATION_CODES.has(result.code) && result.error) {
    await sayPlain(chatId, `${result.error}${failureNextStep(result.code)}`);
    return;
  }
  await sayPlain(chatId, `${GENERATION_FAILED_TEXT}${failureNextStep(result.code)}`);
  await alertOperators({
    key: `telegram_generation:${result.code ?? 'uncoded'}`,
    title: 'Telegram resume request failed',
    lines: [`code ${result.code ?? 'none'}`, result.error ?? 'no error recorded'],
  });
}

// ───────────────────────────────────────────── receipt and failure handling

/** Said when anything fails after Telegram was told the update arrived. */
export const TELEGRAM_FAILURE_TEXT =
  'Something went wrong on our side and I could not finish that. Please try again in a minute.';

/**
 * Claim an update id. Telegram redelivers whenever it is unsure the webhook
 * got an update, and the unique `updateId` makes the second delivery a no-op.
 * A database error is not a duplicate: it throws, so the user hears about it.
 */
async function claimTelegramUpdate(updateId: number | undefined): Promise<boolean> {
  if (typeof updateId !== 'number') return true;
  const claimed = await prisma.telegramUpdateReceipt.createMany({
    data: [{ updateId: String(updateId) }],
    skipDuplicates: true,
  });
  return claimed.count > 0;
}

/** The private chat an update came from, or null. Failures are never announced in a group. */
function replyChatOf(update: TelegramUpdatePayload): string | null {
  const chat = update.message?.chat ?? update.callback_query?.message?.chat;
  if (!chat || (chat.type && chat.type !== 'private')) return null;
  return String(chat.id);
}

/** What kind of update failed, for the operators. Never the user's text. */
function describeUpdate(update: TelegramUpdatePayload): string {
  const data = update.callback_query?.data;
  if (update.callback_query) return `button ${data ? `${data.split(':')[0]}:` : '(no data)'}`;
  const message = update.message;
  if (!message) return 'other update';
  if (message.document) return `file ${message.document.mime_type ?? 'unknown type'}`;
  if (message.text) {
    const command = /^\/[a-z_]+/i.exec(message.text.trim())?.[0];
    return command ? `command ${command}` : 'text message';
  }
  return 'media message';
}

/** A short, stable name for an error, so one kind of failure alerts once per window. */
function errorKind(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^P\d{4}$/.test(error.code)) {
    return `prisma_${error.code}`;
  }
  return error instanceof Error ? error.name : typeof error;
}

async function reportTelegramFailure(update: TelegramUpdatePayload, error: unknown): Promise<void> {
  const kind = errorKind(error);
  const message = error instanceof Error ? error.message : String(error);
  console.error('[telegram] update failed', { updateId: update.update_id, kind, update: describeUpdate(update), error: message });
  try {
    const chatId = replyChatOf(update);
    // Never throws: a failed send is logged by the transport.
    if (chatId) await sendTelegramMessageDetailed({ chatId, text: escapeTelegramHtml(TELEGRAM_FAILURE_TEXT) });
  } finally {
    await alertOperators({
      key: `telegram_update:${kind}`,
      title: 'Telegram update failed',
      lines: [`update ${update.update_id ?? 'without id'}: ${describeUpdate(update)}`, `${kind}: ${message}`],
    });
  }
}

export type TelegramUpdateOutcome = 'handled' | 'duplicate' | 'failed';

/**
 * Handle one update, at most once per `update_id`. Never throws.
 *
 * The webhook acknowledges Telegram before this runs, so nothing here can be
 * retried by Telegram: a failure anywhere (the receipt write included) tells
 * the user in plain words and alerts the operators. Before, a throw returned
 * 500, Telegram redelivered, the receipt written before the throw turned the
 * retry into a silent 200, and the user never heard back.
 */
export async function processTelegramUpdate(update: TelegramUpdatePayload): Promise<TelegramUpdateOutcome> {
  try {
    if (!(await claimTelegramUpdate(update.update_id))) return 'duplicate';
    await handleTelegramUpdate(update);
    return 'handled';
  } catch (error: unknown) {
    await reportTelegramFailure(update, error).catch(() => undefined);
    return 'failed';
  }
}

/**
 * A document or media message: the text to continue with, or null when it
 * was answered here. Files are read only for a linked account, under the
 * upload rate limit, so nobody can make the bot parse files for free.
 */
async function readFileMessage(
  chatId: string,
  message: NonNullable<TelegramUpdatePayload['message']>,
): Promise<{ text: string; hint: ShareHint } | null> {
  const attachment = classifyTelegramAttachment(message);
  if (attachment.kind === 'none') return null;
  if (attachment.kind === 'unreadable') {
    await sayPlain(chatId, UNREADABLE_FILE_TEXT);
    return null;
  }
  const userId = await findLinkedUserId(chatId);
  if (!userId) {
    await sayPlain(chatId, notLinkedText(telegramDashboardUrl(), 'Telegram'));
    return null;
  }
  const limited = await checkRateLimit('upload', `telegram_file:${userId}`);
  if (!limited.allowed) {
    await sayPlain(chatId, limited.error ?? 'Too many files at once. Try again in a few minutes.');
    return null;
  }
  const read = await readTelegramDocument(attachment);
  if (!read.ok) {
    await sayPlain(chatId, read.reply);
    return null;
  }
  if (read.truncated) await sayPlain(chatId, truncatedFileNotice());
  // The caption is the user's note about the file ("apply for me"), kept
  // apart for Scout; everything else reads the two as one pasted text.
  return { text: composeFileText(message.caption, read.text), hint: { post: read.text, note: message.caption ?? null } };
}

function telegramDashboardUrl(): string {
  return `${config.app.url.replace(/\/$/, '')}/settings/channels`;
}

/** Unlink confirmation buttons. Short, outside the `sc:` namespace. */
const UNLINK_KEYBOARD = {
  inline_keyboard: [[
    { text: 'Unlink this chat', callback_data: 'ul:yes' },
    { text: 'Keep it', callback_data: 'ul:no' },
  ]],
};

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
    await sayPlain(chatId, 'Channel not linked. Use /start link_<token> from your dashboard first.');
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
    await sayPlain(chatId, 'No generation sessions found yet. Use /generate <job description> to start.');
    return;
  }

  const atsText = typeof latest.atsScore === 'number' ? `\nATS estimate: ${latest.atsScore}%` : '';
  const resumeUrl = latest.resultResumeId ? `${config.app.url}/editor/${latest.resultResumeId}` : null;
  const linkText = resumeUrl ? `\nResume: ${resumeUrl}` : '';
  const errorText = latest.errorMessage ? `\nError: ${latest.errorMessage}` : '';
  const progress = latest.status === 'completed'
    ? ''
    : `\nProgress: ${getGenerationProgressPercent(latest.currentStep)}%`;
  await sayPlain(chatId, `Session ${latest.id}\nStatus: ${latest.status}\nStep: ${getGenerationStageLabel(latest.currentStep)}${progress}${atsText}${linkText}${errorText}`);
}

async function handleTelegramUpdate(update: TelegramUpdatePayload): Promise<void> {
  // Private chats only. A linked chat id is the identity, so a group the bot
  // was added to would let every member act as the account that linked it
  // (launch audit, 2026-10-02). Telegram always sends `type`.
  const chatType = update.message?.chat.type ?? update.callback_query?.message?.chat.type;
  if (chatType && chatType !== 'private') {
    const groupChatId = String(update.message?.chat.id ?? update.callback_query?.message?.chat.id ?? '');
    if (groupChatId && update.message?.text?.startsWith('/')) {
      await sayPlain(groupChatId, 'Patronus only works in a private chat. Message me directly.');
    }
    return;
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
          await sayPlain(chatId, 'Link your account first, then try again.');
        } else {
          await handleTelegramScoutCallback(
            chatId,
            userId,
            callback.data,
            callback.message?.message_id ?? null,
            callback.message?.reply_markup?.inline_keyboard ?? null,
          );
        }
      } else if (callback.data.startsWith('jw:')) {
        // Job-watch alert buttons. Ownership is checked against the linked user.
        const userId = await findLinkedUserId(chatId);
        if (!userId) {
          await sayPlain(chatId, 'Link your account first, then try again.');
        } else {
          const { handleTelegramWatchCallback } = await import('@/lib/channels/telegramWatch');
          await handleTelegramWatchCallback(
            chatId,
            userId,
            callback.data,
            callback.message?.message_id ?? null,
            (callback.message?.reply_markup?.inline_keyboard ?? null) as Parameters<typeof handleTelegramWatchCallback>[4],
          );
        }
      } else if (callback.data.startsWith('status:')) {
        await sendTelegramStatus(chatId, callback.data.split(':')[1]);
      } else if (callback.data.startsWith('regen:')) {
        const sessionId = callback.data.split(':')[1];
        // Scoped to the user this chat is linked to: a callback's data is
        // whatever the client sends (audit 2026-10-02).
        const ownerId = await findLinkedUserId(chatId);
        const seed = ownerId
          ? await prisma.generationSession.findFirst({
              where: { id: sessionId, userId: ownerId, channel: Channel.telegram },
              select: { jobDescription: true },
            })
          : null;
        if (!seed?.jobDescription) {
          await sayPlain(chatId, 'Unable to regenerate from this session.');
        } else {
          await sayPlain(chatId, 'Regenerating now. I will update you shortly.');
          const regenerated = await processChannelGenerate({
            channel: Channel.telegram,
            externalId: chatId,
            message: seed.jobDescription,
            // A regenerate of your own recent session is free (capped by the
            // service); without this it charged a second tailored resume.
            regenerateOfSessionId: sessionId,
          });
          if (!regenerated.success) {
            await sayGenerationFailure(chatId, regenerated);
          } else {
            await sayPlain(chatId, 'Regeneration started. Use /status to track progress.');
          }
        }
      }
    }
    await answerTelegramCallbackQuery(callback.id);
    return;
  }

  const message = update.message;
  if (!message) {
    return;
  }

  const chatId = String(message.chat.id);
  // A PDF or text file continues as if its text had been pasted.
  const file = message.text === undefined ? await readFileMessage(chatId, message) : null;
  const incoming = message.text ?? file?.text;
  if (!incoming) {
    return;
  }
  const text = incoming.trim();
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
      await sayPlain(chatId, 'Link your account first, then use /profile.');
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
    await sayPlain(chatId, `Your profile details:\n\nFull name: ${profile?.fullName?.trim() || notSet}\nEmail: ${profile?.email?.trim() || notSet}\nPhone: ${profile?.phone?.trim() || notSet}\nLocation: ${profile?.location?.trim() || notSet}\nTarget title: ${profile?.defaultTitle?.trim() || notSet}\nYears experience: ${profile?.yearsExperience?.trim() || notSet}\n\nTo update profile, use the dashboard profile section.`);
    return;
  }

  // /help needs no linked account: it is how an unlinked user finds out what
  // the bot does.
  // "/help what should i do now" is still /help (production 2026-10-03).
  if (/^\/help\b/i.test(text) || parseInboxCommand(text, { allowBare: false }) === 'help') {
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

  if (text.startsWith('/') && !/^\/(start|generate|status|profile|scout|jobs|applied|insights|notes|memory|help|unlink)\b/.test(text)) {
    await sayPlain(chatId, 'Unknown command. Available commands:\n/start - Link account or see welcome info\n/scout - Analyse a LinkedIn job or post link\n/jobs - Your best fits to review\n/applied - Jobs you applied to\n/insights - Your saved insights\n/notes - Your Work Log notes\n/memory - What I remember you told me\n/help - Everything the bot can do\n/generate - Start a new resume\n/status - Check generation progress\n/profile - View your profile details\n/unlink - Disconnect this chat');
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

    await sayPlain(chatId, 'Invalid start payload. Generate a new link code from the dashboard and try again.');
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
    await sayPlain(chatId, 'Invalid usage. Send:\n/generate <full job description>');
    return;
  }

  // An open resume clarification takes a message only when it plausibly
  // answers it: recent, not a link, not a pasted post; "skip" / "skip all"
  // always skip. Anything else goes on to Scout below, and the question is
  // mentioned so it is not forgotten. Users without Scout keep the old
  // behaviour (every message answers), since there is nowhere else for it.
  // A draft the user started revising AFTER the resume question was asked
  // owns their next short message: "add IIT Delhi" is an edit to the email,
  // not an answer to the resume question (docs/impl/07-telegram-apply.md).
  const draftFocusNewer = pendingSession && !isGenerateCommand
    ? await draftFocusIsNewerThan(identity.userId, pendingSession.updatedAt)
    : false;
  const clarificationRoute = pendingSession && !isGenerateCommand
    ? (draftFocusNewer ? 'pass' : routeClarificationReply({ text, askedAt: pendingSession.updatedAt }))
    : null;
  if (pendingSession && clarificationRoute === 'cancel') {
    // Conditional, so a session that moved on meanwhile is left alone; the
    // notified state is set so the "Generation failed" notice never fires.
    const message = 'Cancelled by you';
    const cancelled = await prisma.generationSession.updateMany({
      where: { id: pendingSession.id, status: GenerationStatus.awaiting_clarification },
      data: { status: GenerationStatus.failed, errorMessage: message, lastNotifiedState: `failed:${message}` },
    });
    await sayPlain(chatId, cancelled.count > 0
      ? 'Cancelled. That resume will not be made. Send /generate with a job description to start another.'
      : 'That resume is already being made. Use /status to see it.');
    return;
  }

  const scoutOn = clarificationRoute === 'pass'
    ? await handleTelegramScoutText(chatId, identity.userId, text, file?.hint)
    : false;
  if (scoutOn && pendingSession) {
    const question = nextClarificationQuestion(pendingSession.clarifications);
    await sayPlain(chatId, question
      ? `Your resume is still waiting on one question:\n\n${question}\n\nAnswer it, or say "skip", "skip all" or "cancel".`
      : 'Your resume is still waiting on a question. Send /status to see it, "skip all" to make it now, or "cancel".');
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
      await sayGenerationFailure(chatId, result);
      return;
    }

    const ack = clarificationRoute === 'skip' ? 'Skipped. Nothing about it goes on the resume.' : clarificationRoute === 'skip_all' ? 'Skipped the rest.' : 'Saved.';
    if (result.status === 'awaiting_clarification') {
      const question = result.nextQuestion?.question ?? result.questions?.[0]?.question;
      const fresh = await prisma.generationSession.findUnique({ where: { id: pendingSession.id }, select: { clarifications: true } });
      const progress = clarificationProgress(fresh?.clarifications);
      await sayPlain(chatId, question
        ? `${ack}\n\n${progress ? `Question ${progress.current} of ${progress.total}: ` : ''}${question}\n\nAnswer it, or say "skip", "skip all" or "cancel".`
        : `${ack} Please answer the next question to continue.`);
      return;
    }

    await sayPlain(chatId, `${ack} That was the last question. Making your resume now; I will message you when it is ready.`);
    return;
  }

  // Scout comes AFTER the resume clarification branch above, deliberately:
  // an open /generate clarification keeps precedence for free text, exactly as
  // before Scout existed. With the flag on, every other message is recorded
  // here: links, pasted posts, notes about the user's work, and replies to a
  // Scout question.
  if (!isGenerateCommand && await handleTelegramScoutText(chatId, identity.userId, text, file?.hint)) {
    return;
  }

  if (!isGenerateCommand) {
    await sayPlain(chatId, 'Unsupported input. Use one of:\n/scout <LinkedIn job or post link>\n/generate <job description>\n/status\n/help');
    return;
  }

  const jobDescription = generatePayload ?? '';
  await sayPlain(chatId, 'Processing your request. Creating a generation session now.');

  const result = await processChannelGenerate({
    channel: Channel.telegram,
    externalId: chatId,
    message: jobDescription,
  });

  if (!result.success) {
    await sayGenerationFailure(chatId, result);
    return;
  }

  // Long-term memory answered some questions: say what was used (docs/impl/08-memory.md).
  const recalled = rememberedNote(result.remembered);
  const recalledPrefix = recalled ? `${recalled}\n\n` : '';
  if (result.status === 'awaiting_clarification') {
    const question = result.nextQuestion?.question ?? result.questions?.[0]?.question;
    const total = result.questions?.length ?? 0;
    await sayPlain(chatId, question
        ? `${recalledPrefix}Before I write it, ${questionsIntro(total)}\n\n${total > 1 ? `Question 1 of ${total}: ` : ''}${question}\n\n${CLARIFICATION_REPLY_HINT}`
        : 'I need clarification. Please answer the next question to continue.');
    return;
  }

  await sayPlain(chatId, `${recalledPrefix}Generation started. Use /status for live progress.`);
}
