/**
 * The Work Log action contract.
 *
 * ORCHESTRATOR-OWNED. Landed before Wave B so the data layer (B1) and the log
 * UI (B2) can be built in parallel: B1 implements these signatures, B2 renders
 * against them with a fixture factory, and integration is a type-check.
 *
 * Neither agent may edit this file. If a signature is wrong, report it.
 *
 * Spec: docs/prd/01-work-log.md §9.1 · design/02 §B, C, D
 */

import type { WinCategory, WinSensitivity, WinSource, WinStatus } from '@prisma/client';
import type { Result } from '@/lib/result';

// ---------------------------------------------------------------------------
// Wire types
//
// Server actions cross a serialization boundary, so these are the shapes the
// client sees — deliberately NOT the raw Prisma row. `skills`/`collaborators`
// are typed arrays here rather than Prisma's `JsonValue`, and evidence is
// flattened into the view instead of requiring a second round trip.
// ---------------------------------------------------------------------------

/** One piece of provenance behind a Win, as rendered by `SourceChip`. */
export type EvidenceView = {
    id: string;
    kind: 'repo' | 'metric_confirmed' | 'document' | 'url' | 'interview_assertion' | 'import';
    /** Supporting snippet. Preserved even when the upstream source disappears. */
    excerpt: string;
    /**
     * Chip label, e.g. "PR #482". Server-derived: the client cannot reliably
     * parse this out of a URL, and doing so breaks for URL-less sources.
     */
    label: string;
    /** Secondary line, e.g. "patronus/api". Null when there is nothing to add. */
    detail: string | null;
    /** Null when the source has no addressable location at all. */
    url: string | null;
    /**
     * False when the upstream source is gone (repo deleted, doc removed). Distinct
     * from `url === null`, which means it never had an address. Drives the
     * strikethrough treatment — the excerpt survives either way.
     */
    available: boolean;
    confirmedByUser: boolean;
};

/** Structured impact, present only when a real quantity was captured. */
export type ImpactView = {
    id: string;
    metric: string;
    baseline: string | null;
    result: string | null;
    delta: string | null;
    scope: string | null;
    timeframe: string | null;
};

export type WinView = {
    id: string;
    title: string;
    narrative: string;
    occurredAt: Date;
    periodEnd: Date | null;
    category: WinCategory;
    status: WinStatus;
    sensitivity: WinSensitivity;
    source: WinSource;
    sourceRef: string | null;
    employerId: string | null;
    /** Resolved for display; null when attribution is unknown or ambiguous. */
    employerName: string | null;
    projectId: string | null;
    skills: string[];
    collaborators: string[];
    confidence: number;
    confirmedAt: Date | null;
    createdAt: Date;
    impact: ImpactView | null;
    evidence: EvidenceView[];
    /**
     * Derived, not stored. `grounded` once at least one confirmed evidence link
     * resolves; drives the status dot and `GroundChip`.
     */
    groundState: 'grounded' | 'needs_confirmation' | 'unsupported';
    /** One short question (<=8 words) when the Win lacks an ImpactMetric. */
    quantifyPrompt: string | null;
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * AI-structured but NOT yet persisted. `structureDraft` returns this so quick
 * capture can show an editable result before anything is written; the user's
 * corrections then go straight into `createWinFromText` as one round trip.
 */
export type StructuredDraft = {
    title: string;
    narrative: string;
    category: WinCategory;
    occurredAt: Date;
    skills: string[];
    collaborators: string[];
    suggestedSensitivity: WinSensitivity;
    quantified: boolean;
    impact: ImpactInput | null;
    /**
     * <=8 words, present only when `quantified` is false. Same concept and same
     * name as `WinView.quantifyPrompt` — one for an unsaved draft, one for a
     * persisted Win. Do not reintroduce a third name for this.
     */
    quantifyPrompt: string | null;
    confidence: number;
};

export type ImpactInput = {
    metric: string;
    baseline?: string | null;
    result?: string | null;
    delta?: string | null;
    scope?: string | null;
    timeframe?: string | null;
};

export type CreateWinInput = {
    /** Raw user text. Required when no structured fields are supplied. */
    text?: string;
    /**
     * Pre-structured fields, typically a `StructuredDraft` the user has edited.
     * When present the server persists these directly and does NOT re-run the
     * model — otherwise the user's corrections would be silently overwritten.
     *
     * `title` and `category` are required: with them optional the server has to
     * invent a category, which is a product decision hiding in a type.
     */
    draft?: Pick<StructuredDraft, 'title' | 'category'> & Partial<StructuredDraft>;
    /** Defaults to today when omitted. */
    occurredAt?: Date;
    sensitivity?: WinSensitivity;
    source?: WinSource;
    sourceRef?: string;
    /** Set by capture connectors; enforces one Win per signal. */
    signalId?: string;
};

/** For the filter bar and the drawer's employer picker. */
export type EmployerOption = {
    id: string;
    name: string;
    role: string;
    current: boolean;
};

export type WinPatch = {
    title?: string;
    narrative?: string;
    occurredAt?: Date;
    periodEnd?: Date | null;
    category?: WinCategory;
    sensitivity?: WinSensitivity;
    employerId?: string | null;
    projectId?: string | null;
    skills?: string[];
    collaborators?: string[];
};

export type DismissReason = 'not_a_win' | 'noise' | 'duplicate' | 'expired' | 'user';

export type WinFilters = {
    status?: WinStatus[];
    category?: WinCategory[];
    employerId?: string | null;
    /** Inclusive bounds on `occurredAt`. */
    from?: Date;
    to?: Date;
    /** Matches title and narrative. */
    search?: string;
    /** Omit to use the caller's plan default (Free is a rolling 90 days). */
    includeBeyondHistoryLimit?: boolean;
};

/** Opaque cursor. Encodes `(occurredAt, id)`; callers must not parse it. */
export type WinCursor = string;

export type WinPage = {
    items: WinView[];
    nextCursor: WinCursor | null;
    /** Total matching the filter, ignoring pagination. */
    total: number;
    /**
     * Count hidden by the plan's history limit. Renders the "+41 older wins"
     * boundary — locked, never deleted (PRD 06 PW2).
     */
    hiddenByPlan: number;
};

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export type CategoryCount = { category: WinCategory; count: number };

export type LogSummary = {
    totalConfirmed: number;
    withEvidence: number;
    withImpact: number;
    draftCount: number;
    /** Consecutive weeks with >=1 confirmed Win. Never rendered below 2. */
    streakWeeks: number;
    categoryMix: CategoryCount[];
    /** Categories thin or absent this period — drives the rail's coaching line. */
    gaps: WinCategory[];
    /** Earliest confirmed `occurredAt`; null on an empty log. */
    recordStart: Date | null;
};

export type BulkResult = {
    ok: string[];
    failed: { winId: string; error: string }[];
};

// ---------------------------------------------------------------------------
// The eight actions (PRD 01 §9.1)
//
// Every one is a server action returning `Result<T>` — expected failures come
// back as values, never thrown (impl/00 §P-3). Auth is implicit: each resolves
// userId from Clerk and scopes every query by it.
// ---------------------------------------------------------------------------

export type CreateWinFromText = (input: CreateWinInput) => Promise<Result<WinView>>;

/**
 * Structure raw text WITHOUT persisting anything. Quick capture calls this on
 * idle, shows the editable result, and only writes when the user submits — so
 * an abandoned capture leaves no draft behind.
 */
export type StructureDraft = (text: string) => Promise<Result<StructuredDraft>>;

/**
 * Transactional. Writes Evidence(confirmedByUser=true) + ClaimLink(grounded). Idempotent.
 *
 * `evidence.source` carries what the user typed into a `needs_confirmation`
 * GroundChip. That is the one-click evidence-capture path (PRD 01 §7.1) — the
 * chip is a producer, not a status light, so dropping this loses the capture.
 */
export type ConfirmWin = (
    winId: string,
    patch?: WinPatch,
    evidence?: { source: string },
) => Promise<Result<WinView>>;

/** Reverses confirm completely, including the Qdrant point. */
export type UnconfirmWin = (winId: string) => Promise<Result<WinView>>;

/** Re-embeds when title, narrative, skills, or sensitivity change. */
export type UpdateWin = (winId: string, patch: WinPatch) => Promise<Result<WinView>>;

export type DismissWin = (winId: string, reason: DismissReason) => Promise<Result<void>>;

export type ListWins = (
    filters: WinFilters,
    cursor?: WinCursor,
    limit?: number,
) => Promise<Result<WinPage>>;

/** Partial success is normal — inspect `failed`. */
export type BulkConfirm = (winIds: string[]) => Promise<Result<BulkResult>>;

export type GetLogSummary = (range?: { from?: Date; to?: Date }) => Promise<Result<LogSummary>>;

// ---------------------------------------------------------------------------
// Added 2026-08-02 after the Wave B integration gate.
//
// These are call sites the log UI genuinely needs and the original eight did
// not cover. They were found by building the UI against the contract before
// the implementation existed — which is precisely what that ordering is for.
// ---------------------------------------------------------------------------

/**
 * Answer the quantify prompt: writes an `ImpactMetric` and links it.
 *
 * The highest-leverage interaction in the drawer — it is the Context Interview
 * mechanic delivered one question at a time. `answer` is the user's own words;
 * the server parses it into a metric and must NOT invent a figure it does not
 * contain (PRD 01 §8.1 rule 1).
 */
export type AddImpact = (winId: string, answer: string) => Promise<Result<WinView>>;

/** Hides from the default log view. Still counted in packets and exports. */
export type ArchiveWin = (winId: string) => Promise<Result<WinView>>;
export type UnarchiveWin = (winId: string) => Promise<Result<WinView>>;

/**
 * Permanent. Removes the Win, its Evidence, its ClaimLinks, and its Qdrant
 * point. Distinct from dismiss (which is retained to train the noise filter)
 * and from archive (which is reversible).
 */
export type DeleteWin = (winId: string) => Promise<Result<void>>;

/** Employers for the filter bar and the drawer picker, most recent first. */
export type ListEmployers = () => Promise<Result<EmployerOption[]>>;
