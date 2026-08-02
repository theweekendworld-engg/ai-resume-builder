/**
 * THE INTEGRATION SEAM for the backfill surface.
 *
 * Same shape and same reasoning as `src/components/log/data-source.ts`: nothing
 * under `src/components/backfill/` or `src/app/(app)/log/backfill/` imports a
 * server action directly. One module knows about both sides, so the client
 * components stay renderable in a story, a test, or the pattern gallery without
 * a database behind them.
 */

import type { Result } from '@/lib/result';
import {
    answerBackfill,
    completeBackfillSession,
    confirmAllFromSession,
    pauseBackfillSession,
    startBackfillSession,
    type BackfillClosing,
} from '@/actions/backfill';
import type { BackfillEntryPoint } from '@/agents/backfillAgent';

import type { CapturedWinView, ProgressView, ChatMessage, NoticeView } from './types';

/** Everything the chat screen needs on first paint, already flattened. */
export type BackfillBootstrap = {
    sessionId: string;
    subjectLabel: string;
    /** Prior turns, rendered as history on a resumed session. */
    transcript: { role: 'agent' | 'user'; content: string }[];
    acknowledgement: string;
    question: string | null;
    progress: ProgressView;
    captured: CapturedWinView[];
    done: boolean;
};

export type AnswerResult = {
    acknowledgement: string;
    question: string | null;
    progress: ProgressView;
    captured: CapturedWinView[];
    notices: NoticeView[];
    done: boolean;
};

export type BackfillData = {
    answer(input: {
        sessionId: string;
        answer?: string;
        dontRemember?: boolean;
    }): Promise<Result<AnswerResult>>;
    pause(sessionId: string): Promise<Result<void>>;
    complete(sessionId: string): Promise<Result<BackfillClosing>>;
    confirmAll(sessionId: string): Promise<Result<{ confirmed: number; failed: number }>>;
    start(input: {
        subjectType: 'employer' | 'project' | 'competency' | 'period';
        subjectId?: string | null;
        subjectLabel: string;
        entryPoint: BackfillEntryPoint;
    }): Promise<Result<{ sessionId: string }>>;
};

export const backfillData: BackfillData = {
    async answer(input) {
        const result = await answerBackfill(input);
        if (!result.success) return result;
        return {
            success: true,
            data: {
                acknowledgement: result.data.acknowledgement,
                question: result.data.question,
                progress: result.data.progress,
                captured: result.data.captured as CapturedWinView[],
                notices: result.data.notices,
                done: result.data.done,
            },
        };
    },
    pause: pauseBackfillSession,
    complete: completeBackfillSession,
    confirmAll: confirmAllFromSession,
    async start(input) {
        const result = await startBackfillSession(input);
        if (!result.success) return result;
        return { success: true, data: { sessionId: result.data.sessionId } };
    },
};

export type { ChatMessage };
