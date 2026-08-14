// Typed message envelope between extension surfaces (content script, side
// panel, popup) and the background service worker. Keep this file flat — both
// the sender and receiver depend on it, so a single source of truth avoids
// drift.

export type NormalizedPageModel = {
    url: string;
    visibleTitle?: string;
    heading?: string;
    classification: {
        platform: string;
        pageKind: string;
        confidenceBand: 'high' | 'medium' | 'low';
        confidenceScore: number;
        reasons: string[];
    };
    metadata: Record<string, unknown>;
    jobDescription: {
        text: string;
        confidenceScore: number;
        confidenceBand: 'high' | 'medium' | 'low';
        sourceHint?: string;
    } | null;
    fields: Array<{
        key?: string;
        label: string;
        inputType: string;
        required: boolean;
        confidenceBand: 'high' | 'medium' | 'low';
        confidenceScore: number;
        reasons: string[];
        sectionHeading?: string;
        options?: string[];
        locator: Record<string, unknown>;
    }>;
    questions: Array<Record<string, unknown>>;
    reducedRegions: Array<Record<string, unknown>>;
    stats: {
        visibleFieldCount: number;
        requiredFieldCount: number;
        questionCount: number;
        reducedRegionCount: number;
    };
    extractedAt: string;
};

export type AuthState =
    | { status: 'connected'; userId: string; email?: string; expiresAt: string }
    | { status: 'expired' }
    | { status: 'disconnected' };

export type TelemetryEvent = {
    type: string;
    payload: Record<string, unknown>;
    extVersion: string;
    clientOccurredAt: string;
};

export type ApplicationSession = {
    id: string;
    workspaceId: string | null;
    platform: string;
    startedAt: string;
    lastActiveAt: string;
    ttlExpiresAt: string;
    origin: string;
    currentUrl: string;
    step: { index: number; total: number | null; label: string | null };
    history: Array<{
        stepIndex: number;
        url: string;
        visitedAt: string;
        pageKind: string;
        fieldsFilled: number;
        questionsAnswered: number;
    }>;
};

export type ProfileBundle = {
    fullName: string;
    email: string;
    phone: string;
    location?: string;
    experiencesCount: number;
};

export type ProfileCompleteness = {
    complete: boolean;
    missing: string[];
};

export type ProfileResponse = {
    bundle: ProfileBundle;
    completeness: ProfileCompleteness;
};

export type FillActionInWire = {
    id: string;
    action: 'auto_fill' | 'review_required' | 'manual_upload' | 'skip';
    fieldKey?: string;
    fieldLabel: string;
    inputType: string;
    locator: Record<string, unknown>;
    value?: string;
    valuePreview?: string;
    suggestedOption?: string;
    canApply: boolean;
    reason: string;
    confidenceBand: 'high' | 'medium' | 'low';
    confidenceScore: number;
    source: { type: string; label: string; path?: string };
};

export type FillPlanWire = {
    generatedAt: string;
    safeAutofillCount: number;
    reviewCount: number;
    skipCount: number;
    actions: FillActionInWire[];
};

export type ConnectStartResult = { connectUrl: string };

export type WorkspaceListItemWire = {
    id: string;
    sourceUrl: string;
    sourcePlatform: string | null;
    companyName: string | null;
    roleTitle: string | null;
    location: string | null;
    applicationStatus: string;
    fitScore: number | null;
    questionCount: number;
    answeredQuestionCount: number;
    selectedResumeId: string | null;
    updatedAt: string;
    createdAt: string;
};

export type WorkspaceListResult = { workspaces: WorkspaceListItemWire[] };

/**
 * One row of the saved-answer library, as it crosses the wire.
 *
 * Mirrors `ExtensionSavedAnswer` on the server. `questionFingerprint` is
 * deliberately absent: it is the internal matching key and means nothing to a
 * user looking at their own library.
 */
export type SavedAnswerWire = {
    id: string;
    canonicalQuestion: string;
    answerText: string;
    questionType: string | null;
    answerMode: string | null;
    usageCount: number;
    autoUse: boolean;
    lastUsedAt: string | null;
    updatedAt: string;
};

/**
 * A resume-tailoring run, as reported by the backend.
 *
 * Generation is asynchronous and can take tens of seconds, so the panel starts
 * a run and then polls this shape until it reaches a terminal status.
 */
/**
 * What the finished resume answers, trimmed for a 400px panel.
 *
 * Mirrors `ExtensionJobMatchSchema` on the server. Optional because a session
 * that ran before this existed, or fell back to v1, has a score and no report
 * behind it.
 */
export type GenerationMatchWire = {
    score: number | null;
    role: string;
    company: string;
    /** Stated must-haves nothing on the resume answers, in the employer's words. */
    unanswered: string[];
    /** Named by the posting, evidenced nowhere, therefore left off. */
    skillGaps: string[];
};

export type GenerationSessionWire = {
    id: string;
    status: 'pending' | 'awaiting_clarification' | 'generating' | 'completed' | 'failed';
    currentStep: string;
    stageLabel: string;
    progressPercent: number;
    atsScore?: number | null;
    errorMessage?: string | null;
    resumeId?: string | null;
    editorUrl?: string;
    pdfId?: string;
    pdfUrl?: string;
    elapsedMs: number;
    startedAt: string;
    updatedAt: string;
    completedAt?: string | null;
    match?: GenerationMatchWire;
};

export type Message =
    | { type: 'PING' }
    | { type: 'AUTH_GET' }
    | { type: 'AUTH_CLEAR' }
    | { type: 'CONNECT_START' }
    | { type: 'CONNECT_CANCEL' }
    | { type: 'PAGE_CONTEXT_UPDATED'; tabId: number; pageModel: NormalizedPageModel }
    | { type: 'GET_PAGE_CONTEXT'; tabId: number }
    | { type: 'REQUEST_REPARSE'; tabId: number }
    | { type: 'OPEN_SIDEPANEL'; tabId: number }
    | { type: 'TELEMETRY_BATCH'; events: TelemetryEvent[] }
    | { type: 'GET_SESSION'; tabId: number }
    | { type: 'BIND_WORKSPACE'; tabId: number; workspaceId: string }
    /**
     * Start tracking the job on this tab: create-or-match a workspace from the
     * page, then bind the tab's session to it. One message rather than an
     * upsert followed by a bind, so the panel cannot leave a workspace created
     * but unbound if the second call fails.
     */
    | { type: 'TRACK_APPLICATION'; tabId: number }
    | { type: 'GET_PROFILE' }
    | { type: 'LIST_WORKSPACES' }
    | {
          type: 'TAILOR_START';
          jobDescription?: string;
          companyName?: string;
          roleTitle?: string;
          sourceUrl?: string;
          workspaceId?: string;
      }
    | { type: 'TAILOR_STATUS'; sessionId: string }
    | { type: 'LIST_ANSWERS' }
    | { type: 'UPDATE_ANSWER'; answerId: string; answerText?: string; autoUse?: boolean }
    | { type: 'DELETE_ANSWER'; answerId: string }
    | { type: 'GET_FILL_PLAN'; tabId: number }
    | { type: 'APPLY_FILLS'; tabId: number; actionIds?: string[] }
    | { type: 'UNDO_FILLS'; tabId: number }
    | {
          type: 'SUGGEST_ANSWER';
          questionId: string;
          questionText: string;
          tone: 'concise' | 'balanced' | 'high_conviction';
          typeHint?: string;
          sectionHeading?: string;
          locator?: Record<string, unknown>;
          sourceUrl?: string;
      }
    | {
          type: 'INSERT_ANSWER';
          tabId: number;
          locator: Record<string, unknown>;
          text: string;
      };

export type Response<T> = { ok: true; data: T } | { ok: false; error: string };
