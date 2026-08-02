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

export type Message =
    | { type: 'PING' }
    | { type: 'AUTH_GET' }
    | { type: 'AUTH_HANDSHAKE'; token: string; userId: string; email?: string; expiresAt: string }
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
    | { type: 'GET_PROFILE' }
    | { type: 'LIST_WORKSPACES' }
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
