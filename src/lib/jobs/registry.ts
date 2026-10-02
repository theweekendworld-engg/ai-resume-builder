/**
 * The single place every handler module is wired in.
 *
 * Later phases add exactly two lines here: an import, and a `registerHandler`
 * call. Nothing else in the app should call `registerHandler` — keeping the
 * mapping in one file is what makes "which kinds can this deploy actually
 * run?" a question you answer by reading one screen.
 */

import { registerHandler, registeredKinds } from './runner';
import { ingestBoardHandler } from './handlers/ingestBoard';
import { skillRollupHandler } from './handlers/skillRollup';
import { radarSnapshotHandler } from './handlers/radarSnapshot';
import { missionNudgeHandler } from './handlers/missionNudge';
import type { JobKind } from './types';
import { noopHandler } from './handlers/noop';
import { embedWinHandler } from './handlers/embedWin';
import { embedProfileItemHandler } from './handlers/embedProfileItem';
import { purgeExpiredHandler } from './handlers/purgeExpired';
import { captureSyncHandler } from './handlers/captureSync';
import { draftWinsHandler } from './handlers/draftWins';
import { proactiveDowngradeHandler } from './handlers/proactiveDowngrade';
import { monthInReviewHandler } from './handlers/monthInReview';
import { weeklyDigestHandler } from './handlers/weeklyDigest';
import { reconcileGraphHandler } from './handlers/reconcileGraph';

let registered = false;

/** Idempotent: safe to call on every request in a warm serverless container. */
export function registerAllHandlers(): JobKind[] {
    if (registered) return registeredKinds();

    registerHandler('noop', noopHandler);
    registerHandler('embed_win', embedWinHandler);
    registerHandler('embed_profile_item', embedProfileItemHandler);
    registerHandler('purge_expired', purgeExpiredHandler);
    registerHandler('capture_sync', captureSyncHandler);
    registerHandler('draft_wins', draftWinsHandler);
    registerHandler('proactive_downgrade', proactiveDowngradeHandler);
    registerHandler('month_in_review', monthInReviewHandler);
    registerHandler('weekly_digest', weeklyDigestHandler);
    registerHandler('ingest_board', ingestBoardHandler);
    registerHandler('skill_rollup', skillRollupHandler);
    registerHandler('radar_snapshot', radarSnapshotHandler);
    registerHandler('mission_nudge', missionNudgeHandler);
    registerHandler('reconcile_qdrant', reconcileGraphHandler);
    // `email_send` stays deliberately unregistered — mail is sent inline by
    // the handler that composes it, and registry.test.ts asserts the absence.

    registered = true;
    return registeredKinds();
}

// Side-effect registration for `import '@/lib/jobs/registry'` call sites.
registerAllHandlers();
