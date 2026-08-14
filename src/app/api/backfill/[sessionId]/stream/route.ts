import { auth } from '@clerk/nextjs/server';
import { InterviewStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isEnabled } from '@/lib/flags';
import { decodeCaptured, type CapturedWin } from '@/agents/tools/backfill';

/**
 * The right rail's feed — `GET /api/backfill/[sessionId]/stream`.
 *
 * Reuses the polling-SSE shape of `/api/generate/stream`. It exists for one
 * reason: **the right rail is the product** (design/02 §I). Cards have to
 * appear within 2s of an answer, and the answer's two model calls do not finish
 * together — extraction lands first and writes its drafts immediately, while
 * the stronger conversational model is still composing the next question.
 *
 * Feeding the rail from this stream rather than from the action's return value
 * means the user watches their record fill while the agent is still thinking,
 * which is the difference between a conversation and a form. It is also the
 * recovery path for a session reopened in a second tab.
 */

const POLL_MS = 1_000;
/** Vercel will cut the function anyway; closing cleanly beats being killed. */
const MAX_STREAM_MS = 10 * 60_000;

export async function GET(
    request: Request,
    { params }: { params: Promise<{ sessionId: string }> },
) {
    const { userId } = await auth();
    if (!userId) return new Response('Unauthorized', { status: 401 });
    if (!(await isEnabled(userId, 'backfill'))) return new Response('Not found', { status: 404 });

    const { sessionId } = await params;
    if (!sessionId) return new Response('sessionId is required', { status: 400 });

    const encoder = new TextEncoder();
    const startedAt = Date.now();

    const stream = new ReadableStream({
        start(controller) {
            let closed = false;
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            const seen = new Set<string>();

            const close = () => {
                if (closed) return;
                closed = true;
                if (timeoutId) clearTimeout(timeoutId);
                timeoutId = null;
                try {
                    controller.close();
                } catch {
                    // Already closed by the runtime.
                }
            };

            const send = (event: string, payload: unknown): boolean => {
                if (closed) return false;
                try {
                    controller.enqueue(encoder.encode(`event: ${event}\n`));
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                    return true;
                } catch {
                    close();
                    return false;
                }
            };

            request.signal.addEventListener('abort', close);

            const poll = async () => {
                if (closed) return;
                try {
                    const session = await prisma.interviewSession.findFirst({
                        where: { id: sessionId, userId },
                        select: {
                            id: true,
                            status: true,
                            questionCount: true,
                            winIds: true,
                            completedAt: true,
                        },
                    });

                    if (!session) {
                        send('error', { message: 'Interview session not found' });
                        close();
                        return;
                    }

                    const captured = decodeCaptured(session.winIds);
                    const fresh: CapturedWin[] = captured.filter((win) => !seen.has(win.winId));
                    for (const win of fresh) seen.add(win.winId);

                    if (fresh.length > 0 && !send('capture', { wins: fresh })) return;

                    if (
                        !send('progress', {
                            sessionId: session.id,
                            status: session.status,
                            questionCount: session.questionCount,
                            capturedCount: captured.length,
                            quantifiedCount: captured.filter((win) => win.quantified).length,
                        })
                    ) {
                        return;
                    }

                    if (
                        session.status === InterviewStatus.completed ||
                        session.status === InterviewStatus.abandoned
                    ) {
                        send('complete', { sessionId: session.id, capturedCount: captured.length });
                        close();
                        return;
                    }

                    if (Date.now() - startedAt > MAX_STREAM_MS) {
                        send('idle', { sessionId: session.id, reason: 'stream_timeout' });
                        close();
                        return;
                    }

                    timeoutId = setTimeout(() => void poll(), POLL_MS);
                } catch (error) {
                    console.error('[backfill/stream] poll failed', error);
                    send('error', { message: 'Failed to stream the interview' });
                    close();
                }
            };

            void poll();

            return () => close();
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        },
    });
}
