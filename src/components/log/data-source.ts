/**
 * THE INTEGRATION SEAM.
 *
 * Every byte of data the Log surface renders arrives through this module, and
 * nothing under `src/components/log/` or `src/app/(app)/log/` imports the
 * fixtures directly. Swapping to the real server actions is the single
 * assignment at the bottom of this file.
 *
 * `src/actions/wins.ts` is being written in parallel and may not exist yet, so
 * this file imports the *types* from the orchestrator-owned contract and the
 * *implementation* from the fixture factory. When the actions land, the
 * implementation object changes and the types do not — which is the point of
 * having landed `wins.types.ts` first.
 */

import type {
  AddImpact,
  ArchiveWin,
  BulkConfirm,
  ConfirmWin,
  CreateWinFromText,
  DeleteWin,
  DismissWin,
  GetLogSummary,
  ListEmployers,
  ListWins,
  LogSummary,
  RestoreWin,
  StructuredDraft,
  StructureDraft,
  UnarchiveWin,
  UnconfirmWin,
  UpdateWin,
  WinPage,
  WinView,
} from '@/actions/wins.types';
import type { ProgressStage } from '@/components/patterns/progress-stages';

import * as fixtures from './fixtures';
import * as winsActions from '@/actions/wins';

/**
 * The UI's draft type is the contract's, not a local shape. B2 originally
 * defined a narrower `DraftStructure`; keeping both meant the seam could never
 * type-check. Re-exported here so nothing under `log/` reaches past this module.
 */
export type DraftStructure = StructuredDraft;

/* -------------------------------------------------------------------------- */
/* Surface state                                                               */
/*                                                                             */
/* design/02 §B lists four states that are facts about the *connector*, not    */
/* about the Wins: first run with no source, connected and syncing, sync       */
/* error, and loading. None of them has a home in `wins.types.ts`. They are    */
/* modelled here and reported as a contract gap.                               */
/* -------------------------------------------------------------------------- */

export type SyncState =
  | { state: 'idle'; lastSyncedAt: Date | null }
  | { state: 'syncing'; stages: ProgressStage[] }
  | { state: 'error'; message: string; lastSyncedAt: Date | null };

export interface LogSurfaceState {
  /** False on first run: drives the `EmptyState` with sample cards. */
  sourceConnected: boolean;
  sync: SyncState;
  plan: 'free' | 'career';
  /** Fixture-only. Holds the client in its skeleton treatment for review. */
  forceLoading?: boolean;
}

export interface LogSnapshot {
  page: WinPage;
  summary: LogSummary;
  surface: LogSurfaceState;
  employers: Array<{ id: string; name: string }>;
  /** Rendered behind the first-run empty state. Empty once a source exists. */
  samples: WinView[];
}

/**
 * Fixture-only. Each value maps to one row of the state table in design/02 §B
 * so every state is reachable at `/log?scenario=…` without a database.
 */
export type LogScenario = 'default' | 'first-run' | 'syncing' | 'error' | 'loading';

export const LOG_SCENARIOS: LogScenario[] = ['default', 'first-run', 'syncing', 'error', 'loading'];

export function parseScenario(value: string | undefined): LogScenario {
  return LOG_SCENARIOS.includes(value as LogScenario) ? (value as LogScenario) : 'default';
}

/* -------------------------------------------------------------------------- */
/* The data source                                                             */
/* -------------------------------------------------------------------------- */

export interface LogDataSource {
  /* --- the eight actions of PRD 01 §9.1 ------------------------------------ */
  listWins: ListWins;
  getLogSummary: GetLogSummary;
  confirmWin: ConfirmWin;
  unconfirmWin: UnconfirmWin;
  updateWin: UpdateWin;
  dismissWin: DismissWin;
  /** Undo a dismissal from the review queue. */
  restoreWin: RestoreWin;
  bulkConfirm: BulkConfirm;
  createWinFromText: CreateWinFromText;

  /* --- added to the contract after the Wave B integration gate ------------- */
  /** §D: structure raw notes into an editable draft before anything is written. */
  structureDraft: StructureDraft;
  /** §C: answer the quantify prompt. */
  addImpact: AddImpact;
  /** §C: `[ Archive ]` — hides from the log, stays in packets and exports. */
  archiveWin: ArchiveWin;
  unarchiveWin: UnarchiveWin;
  /** §C: `[ Delete ]`, and the undo behind the §D capture toast. */
  deleteWin: DeleteWin;
  /** Filter bar and the drawer's employer picker. */
  listEmployers: ListEmployers;
}

const fixtureDataSource: LogDataSource = {
  listWins: fixtures.listWins,
  getLogSummary: fixtures.getLogSummary,
  confirmWin: fixtures.confirmWin,
  unconfirmWin: fixtures.unconfirmWin,
  updateWin: fixtures.updateWin,
  dismissWin: fixtures.dismissWin,
  bulkConfirm: fixtures.bulkConfirm,
  createWinFromText: fixtures.createWinFromText,
  restoreWin: fixtures.restoreWin,
  structureDraft: fixtures.structureDraft,
  addImpact: fixtures.addImpact,
  archiveWin: fixtures.archiveWin,
  unarchiveWin: fixtures.unarchiveWin,
  deleteWin: fixtures.deleteWin,
  listEmployers: fixtures.listEmployers,
};

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SEAM — now flipped to the real server actions.
 *
 * The fixture source is retained and still type-checked: flip `USE_FIXTURES`
 * to review all six of design/02 §B's states without a database. `?scenario=`
 * only does anything against the fixtures.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const USE_FIXTURES = false;

export const logData: LogDataSource = USE_FIXTURES ? fixtureDataSource : winsActions;

/**
 * The reference "now" for the whole surface.
 *
 * Against fixtures it is pinned, so "Today" and "Jul 14" mean the same thing in
 * the server render and the client hydration. Against real data it is the real
 * clock — a pinned now would mislabel every relative date.
 */
export function logNow(): Date {
  return USE_FIXTURES ? fixtures.FIXTURE_NOW : new Date();
}

/* -------------------------------------------------------------------------- */
/* Initial load                                                                */
/* -------------------------------------------------------------------------- */

const SYNC_STAGES: ProgressStage[] = [
  { id: 'sync-1', label: 'Reading merged pull requests', status: 'done', result: 'found 38' },
  { id: 'sync-2', label: 'Reading code reviews', status: 'done', result: 'found 12 substantive' },
  { id: 'sync-3', label: 'Drafting your strongest wins', status: 'active' },
  { id: 'sync-4', label: 'Checking each one against your record', status: 'pending' },
];

/**
 * One round trip for the page shell. The real implementation is the same two
 * calls in a `Promise.all`; the `scenario` argument is fixture-only and drops
 * out with the fixtures.
 */
export async function loadLogSnapshot(
  scenario: LogScenario = 'default',
  surface?: LogSurfaceState,
): Promise<LogSnapshot> {
  const [pageResult, summaryResult, employerResult] = await Promise.all([
    logData.listWins({}, undefined, fixtures.FIXTURE_PAGE_SIZE),
    logData.getLogSummary(),
    logData.listEmployers(),
  ]);

  const emptyPage: WinPage = { items: [], nextCursor: null, total: 0, hiddenByPlan: 0 };
  const emptySummary: LogSummary = {
    totalConfirmed: 0,
    withEvidence: 0,
    withImpact: 0,
    draftCount: 0,
    streakWeeks: 0,
    categoryMix: [],
    gaps: [],
    recordStart: null,
  };

  const page = pageResult.success ? pageResult.data : emptyPage;
  const summary = summaryResult.success ? summaryResult.data : emptySummary;
  const employers = employerResult.success ? employerResult.data : [];

  if (scenario === 'first-run') {
    return {
      page: emptyPage,
      summary: emptySummary,
      surface: { sourceConnected: false, sync: { state: 'idle', lastSyncedAt: null }, plan: 'free' },
      employers,
      samples: fixtures.sampleWins(),
    };
  }

  if (scenario === 'syncing') {
    return {
      page: { ...page, items: page.items.slice(0, 3), total: 3, hiddenByPlan: 0 },
      summary,
      surface: { sourceConnected: true, sync: { state: 'syncing', stages: SYNC_STAGES }, plan: 'free' },
      employers,
      samples: [],
    };
  }

  if (scenario === 'error') {
    return {
      page,
      summary,
      surface: {
        sourceConnected: true,
        sync: {
          state: 'error',
          message: "GitHub stopped responding. Your log is up to date as of Jul 29.",
          lastSyncedAt: new Date('2026-07-29T16:02:00.000Z'),
        },
        plan: 'free',
      },
      employers,
      samples: [],
    };
  }

  if (scenario === 'loading') {
    return {
      page: emptyPage,
      summary,
      surface: {
        sourceConnected: true,
        sync: { state: 'idle', lastSyncedAt: null },
        plan: 'free',
        forceLoading: true,
      },
      employers,
      samples: [],
    };
  }

  // Real data: the connector state comes from `CaptureSource` rows. It used
  // to be hard-coded `sourceConnected: true`, which made the "Connect GitHub"
  // first run unreachable for every new user (audit 2026-09-27, §G). The page
  // passes the real surface in; fixtures keep their pinned demo state.
  return {
    page,
    summary,
    surface: surface ?? {
      sourceConnected: true,
      sync: { state: 'idle', lastSyncedAt: new Date('2026-07-31T16:02:00.000Z') },
      plan: 'free',
    },
    employers,
    samples: surface && !surface.sourceConnected && page.items.length === 0 ? fixtures.sampleWins() : [],
  };
}
