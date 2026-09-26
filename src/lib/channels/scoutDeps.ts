/**
 * The Scout service surface channels depend on, behind one seam.
 *
 * Channels never import `@/services/scout` directly. Routing tests replace
 * this set so "a URL starts a run" can be asserted without starting a real
 * pipeline (which would fetch LinkedIn and call a model).
 */

import type { Result } from '@/lib/result';
import type { StartScoutParams, StartScoutResult } from '@/services/scout';
import type { ScoutRunView } from '@/lib/scout/types';
import type { ScoutActionDeps } from '@/lib/channels/scoutActions';
import type { InsightItem, JobBoardFilters, JobBoardItem, NoteItem } from '@/lib/inbox/types';

export type ScoutChannelDeps = ScoutActionDeps & {
    isScoutEnabled: (userId: string) => Promise<boolean>;
    startScoutRun: (params: StartScoutParams) => Promise<Result<StartScoutResult>>;
    findOpenQuestionRun: (userId: string) => Promise<ScoutRunView | null>;
    // The career inbox, for /jobs /applied /insights /notes.
    topFits: (userId: string, opts?: { sinceDays?: number; limit?: number }) => Promise<JobBoardItem[]>;
    listJobBoard: (userId: string, filters?: JobBoardFilters) => Promise<JobBoardItem[]>;
    listInsights: (userId: string, opts?: { tag?: string | null; q?: string | null; limit?: number }) => Promise<InsightItem[]>;
    listChatNotes: (userId: string, opts?: { limit?: number }) => Promise<NoteItem[]>;
};

let override: ScoutChannelDeps | null = null;

export async function scoutChannelDeps(): Promise<ScoutChannelDeps> {
    if (override) return override;
    const [service, flags, inbox, wins] = await Promise.all([
        import('@/services/scout'),
        import('@/lib/flags'),
        import('@/services/careerInbox'),
        import('@/services/wins'),
    ]);
    return {
        setJobStatus: inbox.setJobStatus,
        topFits: inbox.topFits,
        listJobBoard: inbox.listJobBoard,
        listInsights: inbox.listInsights,
        listChatNotes: inbox.listChatNotes,
        confirmWinForUser: wins.confirmWinForUser,
        dismissWinForUser: wins.dismissWinForUser,
        isScoutEnabled: (userId) => flags.isEnabled(userId, 'scout'),
        startScoutRun: service.startScoutRun,
        findOpenQuestionRun: service.findOpenQuestionRun,
        getScoutRun: service.getScoutRun,
        answerScoutQuestion: service.answerScoutQuestion,
        draftScoutOutreach: service.draftScoutOutreach,
        refreshScoutRun: service.refreshScoutRun,
    };
}

export const __testing = {
    setDeps(deps: ScoutChannelDeps | null) {
        override = deps;
    },
    reset() {
        override = null;
    },
};
