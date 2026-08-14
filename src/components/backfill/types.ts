/**
 * Client-side view types for the backfill chat.
 *
 * Deliberately plain string unions rather than the Prisma enums. Importing enum
 * *values* from `@prisma/client` pulls server-only code into the client bundle
 * — the same reason `src/components/patterns/types.ts` mirrors them instead of
 * re-exporting. The members are identical, so a server payload assigns
 * structurally with no adapter.
 */

import type {
    WinCategoryValue,
    WinSensitivityValue,
} from '@/components/patterns';

export type { WinCategoryValue, WinSensitivityValue };

export type BackfillTopicValue =
    | 'anchor'
    | 'quantify'
    | 'scope'
    | 'rarity'
    | 'evidence'
    | 'sweep';

export type CapturedWinView = {
    winId: string;
    title: string;
    category: WinCategoryValue;
    sensitivity: WinSensitivityValue;
    quantified: boolean;
    metricLabel: string | null;
    questionIndex: number;
    capturedAt: string;
};

export type NoticeView = {
    kind: 'sensitivity' | 'metric_conflict' | 'duplicate';
    message: string;
};

export type ProgressView = {
    questionNumber: number;
    minutesLeft: number;
    cap: number;
};

/** One rendered bubble. `pending` marks an answer whose turn is still in flight. */
export type ChatMessage = {
    id: string;
    role: 'agent' | 'user';
    content: string;
    /** Inline notices rendered under an agent message. */
    notices?: NoticeView[];
    pending?: boolean;
};
