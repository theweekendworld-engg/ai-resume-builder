/**
 * A finished resume, delivered to Telegram.
 *
 * One message: the PDF itself, named from the record
 * (`Jai_Shankar_Resume_iServeWorld.pdf`), captioned with what it is ("One
 * page, tailored for Forward Deployed AI Engineer at iServeWorld."), with
 * Open resume and Regenerate under it. The live test (2026-11-08) got the
 * file as "tailored-resume.pdf", captioned "ATS estimate: 37%", and then a
 * second message saying "ATS estimate: 37%" again: a duplicate, leading with
 * an estimate that undersells the document. The estimate stays in /status.
 *
 * A session the apply chain started is not announced here at all: the chain
 * sends the PDF together with the application draft
 * (`src/services/applyChain.ts`).
 */

import { Channel, GenerationStatus } from '@prisma/client';
import { config } from '@/lib/config';
import { readStoredPdf } from '@/lib/pdfStorage';
import { resumePdfIdentity } from '@/lib/pdfLinks';
import { countPdfPages } from '@/lib/pdfParser';
import { prisma } from '@/lib/prisma';
import { escapeTelegramHtml } from '@/lib/channels/format';
import { sendTelegramDocument, sendTelegramMessage } from '@/lib/telegram';

function isValidHttpUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://');
}

/** The idempotency key for "this outcome was announced". */
export function generationStateKey(session: {
  status: GenerationStatus;
  resultResumeId: string | null;
  pdfUrl: string | null;
  errorMessage: string | null;
}): string {
  return session.status === GenerationStatus.completed
    ? `completed:${session.resultResumeId ?? 'none'}:${session.pdfUrl ?? 'none'}`
    : `failed:${session.errorMessage ?? 'unknown'}`;
}

/**
 * "One page, tailored for Forward Deployed AI Engineer at iServeWorld."
 * The page count is the compiled PDF's own, never assumed.
 */
export function completionCaption(params: { pages: number | null; role: string | null; company: string | null }): string {
  const target = params.role && params.company ? `${params.role} at ${params.company}` : params.role ?? params.company ?? null;
  const length = params.pages === 1 ? 'One page' : params.pages && params.pages > 1 ? `${params.pages} pages` : null;
  if (length && target) return `${length}, tailored for ${target}.`;
  if (target) return `Tailored for ${target}.`;
  if (length) return `${length}, tailored for this job.`;
  return 'Your tailored resume is ready.';
}

/** Open resume · Regenerate (and Download PDF when the file could not be attached). */
export function completionKeyboard(sessionId: string, resumeUrl: string | null, pdfUrl: string | null = null) {
  const first: Array<Record<string, string>> = [];
  if (resumeUrl && isValidHttpUrl(resumeUrl)) first.push({ text: 'Open resume', url: resumeUrl });
  first.push({ text: 'Regenerate', callback_data: `regen:${sessionId}` });
  const rows: Array<Array<Record<string, string>>> = [first];
  if (pdfUrl && isValidHttpUrl(pdfUrl)) rows.push([{ text: 'Download PDF', url: pdfUrl }]);
  return { inline_keyboard: rows };
}

/**
 * Send a session's PDF as a document. `sent: false` when the feature is off,
 * there is no stored PDF, or Telegram refused it; the caption is returned
 * either way so the caller can say the same thing in text.
 */
export async function sendTailoredPdf(params: {
  chatId: string;
  userId: string;
  sessionId: string;
  resumeId?: string | null;
  replyMarkup?: Record<string, unknown>;
}): Promise<{ sent: boolean; caption: string; fileName: string }> {
  const identity = await resumePdfIdentity({ userId: params.userId, resumeId: params.resumeId, sessionId: params.sessionId });
  const plain = { sent: false, caption: completionCaption({ pages: null, role: identity.role, company: identity.company }), fileName: identity.fileName };
  if (!config.features.telegramSendPdfDocument) return plain;

  const pdfRow = await prisma.generatedPdf.findFirst({
    where: {
      userId: params.userId,
      sessionId: params.sessionId,
      ...(params.resumeId ? { resumeId: params.resumeId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: { blobKey: true },
  });
  if (!pdfRow) return plain;

  const buffer = await readStoredPdf(pdfRow.blobKey);
  if (!buffer) return plain;

  const pages = await countPdfPages(buffer).catch(() => null);
  const caption = completionCaption({ pages, role: identity.role, company: identity.company });
  try {
    await sendTelegramDocument({
      chatId: params.chatId,
      fileName: identity.fileName,
      document: buffer,
      caption,
      ...(params.replyMarkup ? { replyMarkup: params.replyMarkup } : {}),
    });
    return { sent: true, caption, fileName: identity.fileName };
  } catch (error: unknown) {
    // Said in text instead: a refused upload must not lose the announcement.
    console.warn('[telegram] resume PDF upload failed', { sessionId: params.sessionId, error: error instanceof Error ? error.message : String(error) });
    return { ...plain, caption };
  }
}

/** The linked Telegram chat for a user, or null. */
export async function telegramChatFor(userId: string): Promise<string | null> {
  const identity = await prisma.channelIdentity.findFirst({
    where: { channel: Channel.telegram, userId, verified: true },
    select: { externalId: true },
  });
  return identity?.externalId ?? null;
}

export async function notifyTelegramGenerationSession(sessionId: string): Promise<void> {
  // A session the apply chain started is the chain's to announce, on any channel.
  const { settleApplyChainSession } = await import('@/services/applyChain');
  const chained = await settleApplyChainSession(sessionId).catch((error: unknown) => {
    // Before the chain claims a session it has sent nothing, so the plain
    // announcement below is still the right thing to send.
    console.error('[apply] could not settle the chain for a session', { sessionId, error: error instanceof Error ? error.message : String(error) });
    return false;
  });
  if (chained) return;

  const session = await prisma.generationSession.findFirst({
    where: {
      id: sessionId,
      channel: Channel.telegram,
      status: {
        in: [GenerationStatus.completed, GenerationStatus.failed],
      },
    },
    select: {
      id: true,
      userId: true,
      status: true,
      resultResumeId: true,
      pdfUrl: true,
      errorMessage: true,
      lastNotifiedState: true,
    },
  });

  if (!session) return;

  const stateKey = generationStateKey(session);
  if (session.lastNotifiedState === stateKey) return;

  const chatId = await telegramChatFor(session.userId);
  if (!chatId) return;

  if (session.status === GenerationStatus.completed) {
    const resumeUrl = session.resultResumeId ? `${config.app.url}/editor/${session.resultResumeId}` : null;
    const pdf = await sendTailoredPdf({
      chatId,
      userId: session.userId,
      sessionId: session.id,
      resumeId: session.resultResumeId,
      replyMarkup: completionKeyboard(session.id, resumeUrl),
    });
    if (!pdf.sent) {
      const publicPdfUrl = config.pdfStorage.access !== 'private'
        ? await prisma.generatedPdf.findFirst({
          where: {
            userId: session.userId,
            sessionId: session.id,
            ...(session.resultResumeId ? { resumeId: session.resultResumeId } : {}),
          },
          orderBy: { createdAt: 'desc' },
          select: { blobUrl: true },
        }).then((row) => row?.blobUrl ?? null)
        : null;
      await sendTelegramMessage({
        chatId,
        parseMode: 'HTML',
        text: `${escapeTelegramHtml(pdf.caption)}${resumeUrl ? `\n<a href="${escapeTelegramHtml(resumeUrl)}">Open resume</a>` : ''}`,
        replyMarkup: completionKeyboard(session.id, resumeUrl, publicPdfUrl),
      });
    }
  } else {
    await sendTelegramMessage({
      chatId,
      parseMode: 'HTML',
      text: escapeTelegramHtml(`Generation failed.\n${session.errorMessage ?? 'Unknown error'}\n\nUse /status to inspect the session or tap regenerate.`),
      replyMarkup: {
        inline_keyboard: [[
          { text: 'Regenerate', callback_data: `regen:${session.id}` },
          { text: 'Status', callback_data: `status:${session.id}` },
        ]],
      },
    });
  }

  await prisma.generationSession.update({
    where: { id: session.id },
    data: {
      lastNotifiedState: stateKey,
    },
  });
}
