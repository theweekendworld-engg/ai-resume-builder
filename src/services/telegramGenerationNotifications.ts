import { Channel, GenerationStatus } from '@prisma/client';
import { config } from '@/lib/config';
import { readStoredPdf } from '@/lib/pdfStorage';
import { prisma } from '@/lib/prisma';
import { sendTelegramDocument, sendTelegramMessage } from '@/lib/telegram';

function isValidHttpUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://');
}

function buildCompletionReplyMarkup(sessionId: string, resumeUrl: string | null, pdfUrl: string | null) {
  const inline_keyboard: Array<Array<Record<string, string>>> = [];
  if (resumeUrl && isValidHttpUrl(resumeUrl)) {
    inline_keyboard.push([{ text: 'Open Resume', url: resumeUrl }]);
  }
  if (pdfUrl && isValidHttpUrl(pdfUrl)) {
    inline_keyboard.push([{ text: 'Download PDF', url: pdfUrl }]);
  }
  inline_keyboard.push([
    { text: 'Regenerate', callback_data: `regen:${sessionId}` },
    { text: 'Status', callback_data: `status:${sessionId}` },
  ]);
  return { inline_keyboard };
}

async function trySendCompletionPdf(params: {
  chatId: string;
  userId: string;
  sessionId: string;
  resumeId?: string | null;
  atsEstimate?: number | null;
}): Promise<void> {
  if (!config.features.telegramSendPdfDocument) return;

  const pdfRow = await prisma.generatedPdf.findFirst({
    where: {
      userId: params.userId,
      sessionId: params.sessionId,
      ...(params.resumeId ? { resumeId: params.resumeId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: { blobKey: true, blobUrl: true },
  });

  if (!pdfRow) return;

  let buffer: Buffer | null = null;
  if (config.pdfStorage.mode !== 'blob') {
    buffer = await readStoredPdf(pdfRow.blobKey);
  }

  if (!buffer && (pdfRow.blobUrl.startsWith('http://') || pdfRow.blobUrl.startsWith('https://'))) {
    const response = await fetch(pdfRow.blobUrl, { cache: 'no-store' });
    if (response.ok) {
      buffer = Buffer.from(await response.arrayBuffer());
    }
  }

  if (!buffer) return;

  const caption = typeof params.atsEstimate === 'number'
    ? `Tailored resume ready. ATS estimate: ${params.atsEstimate}%`
    : 'Tailored resume ready.';

  await sendTelegramDocument({
    chatId: params.chatId,
    fileName: 'tailored-resume.pdf',
    document: buffer,
    caption,
  });
}

export async function notifyTelegramGenerationSession(sessionId: string): Promise<void> {
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
      atsScore: true,
      errorMessage: true,
      lastNotifiedState: true,
    },
  });

  if (!session) return;

  const stateKey = session.status === GenerationStatus.completed
    ? `completed:${session.resultResumeId ?? 'none'}:${session.pdfUrl ?? 'none'}`
    : `failed:${session.errorMessage ?? 'unknown'}`;
  if (session.lastNotifiedState === stateKey) return;

  const identity = await prisma.channelIdentity.findFirst({
    where: {
      channel: Channel.telegram,
      userId: session.userId,
      verified: true,
    },
    select: { externalId: true },
  });
  if (!identity?.externalId) return;

  const chatId = identity.externalId;

  if (session.status === GenerationStatus.completed) {
    const resumeUrl = session.resultResumeId ? `${config.app.url}/editor/${session.resultResumeId}` : null;
    await trySendCompletionPdf({
      chatId,
      userId: session.userId,
      sessionId: session.id,
      resumeId: session.resultResumeId,
      atsEstimate: session.atsScore,
    });
    await sendTelegramMessage({
      chatId,
      text: `${typeof session.atsScore === 'number' ? `ATS estimate: *${session.atsScore}%*\n` : ''}${resumeUrl ? `[Open resume](${resumeUrl})` : 'Resume generated.'}`,
      replyMarkup: buildCompletionReplyMarkup(session.id, resumeUrl, session.pdfUrl ?? null),
    });
  } else {
    await sendTelegramMessage({
      chatId,
      text: `Generation failed.\n${session.errorMessage ?? 'Unknown error'}\n\nUse /status to inspect the session or tap regenerate.`,
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
