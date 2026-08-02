/**
 * The single place every handler module is wired in.
 *
 * Later phases add exactly two lines here: an import, and a `registerHandler`
 * call. Nothing else in the app should call `registerHandler` — keeping the
 * mapping in one file is what makes "which kinds can this deploy actually
 * run?" a question you answer by reading one screen.
 */

import { registerHandler, registeredKinds } from './runner';
import type { JobKind } from './types';
import { noopHandler } from './handlers/noop';
import { embedWinHandler } from './handlers/embedWin';
import { captureSyncHandler } from './handlers/captureSync';
import { draftWinsHandler } from './handlers/draftWins';

let registered = false;

/** Idempotent: safe to call on every request in a warm serverless container. */
export function registerAllHandlers(): JobKind[] {
    if (registered) return registeredKinds();

    registerHandler('noop', noopHandler);
    registerHandler('embed_win', embedWinHandler);
    registerHandler('capture_sync', captureSyncHandler);
    registerHandler('draft_wins', draftWinsHandler);
    // Phase 3+: weekly_digest, month_in_review, email_send
    // Phase 4+: radar_snapshot, reconcile_qdrant

    registered = true;
    return registeredKinds();
}

// Side-effect registration for `import '@/lib/jobs/registry'` call sites.
registerAllHandlers();
