import type {
    ApplicationSession,
    NormalizedPageModel,
} from '@/shared/types/messages';

const SESSION_PREFIX = 'session.';
const ARCHIVE_PREFIX = 'archive.';
const DEFAULT_TTL_HOURS = 4;

// Platforms where the parser can confidently identify multi-step flows. For
// others, we still maintain a session but step transitions stay manual.
const MULTI_STEP_PLATFORMS = new Set(['workday', 'greenhouse', 'lever']);

function sessionKey(tabId: number): string {
    return `${SESSION_PREFIX}${tabId}`;
}

function archiveKey(sessionId: string): string {
    return `${ARCHIVE_PREFIX}${sessionId}`;
}

function newSessionId(): string {
    return `s_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function originFromUrl(url: string): string {
    try {
        return new URL(url).origin;
    } catch {
        return '';
    }
}

function isApplicationKind(kind: string): boolean {
    return kind === 'application_form' || kind === 'multi_step_application';
}

async function readSession(tabId: number): Promise<ApplicationSession | null> {
    const out = await chrome.storage.local.get(sessionKey(tabId));
    const raw = out[sessionKey(tabId)];
    return (raw as ApplicationSession | undefined) ?? null;
}

async function writeSession(session: ApplicationSession, tabId: number): Promise<void> {
    await chrome.storage.local.set({ [sessionKey(tabId)]: session });
    await chrome.alarms.create(`session-ttl:${session.id}`, {
        when: Date.parse(session.ttlExpiresAt),
    });
}

async function archiveSessionByTab(tabId: number): Promise<void> {
    const out = await chrome.storage.local.get(sessionKey(tabId));
    const session = out[sessionKey(tabId)] as ApplicationSession | undefined;
    if (!session) return;
    await chrome.storage.local.set({
        [archiveKey(session.id)]: { ...session, archivedAt: new Date().toISOString() },
    });
    await chrome.storage.local.remove(sessionKey(tabId));
    await chrome.alarms.clear(`session-ttl:${session.id}`).catch(() => {});
}

function ttlISO(hours = DEFAULT_TTL_HOURS): string {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

// Called from the background worker's PAGE_CONTEXT_UPDATED handler. Creates a
// session for a multi-step flow, advances the step on URL change, or returns
// the existing session unchanged for same-page re-parses.
export async function reconcileSessionOnPageUpdate(
    tabId: number,
    pageModel: NormalizedPageModel
): Promise<ApplicationSession | null> {
    const platform = pageModel.classification.platform;
    const pageKind = pageModel.classification.pageKind;
    const origin = originFromUrl(pageModel.url);
    const isAppFlow = isApplicationKind(pageKind);

    if (!isAppFlow) {
        // Plain job_detail pages don't create or update sessions; leave any
        // existing session for this tab untouched.
        return await readSession(tabId);
    }

    const existing = await readSession(tabId);
    const now = new Date().toISOString();

    if (!existing) {
        // First parse on this tab that looks like an application flow.
        const session: ApplicationSession = {
            id: newSessionId(),
            workspaceId: null,
            platform,
            startedAt: now,
            lastActiveAt: now,
            ttlExpiresAt: ttlISO(),
            origin,
            currentUrl: pageModel.url,
            step: {
                index: 1,
                total: MULTI_STEP_PLATFORMS.has(platform) ? null : 1,
                label: pageModel.metadata['roleTitle']
                    ? String(pageModel.metadata['roleTitle']).slice(0, 80)
                    : null,
            },
            history: [
                {
                    stepIndex: 1,
                    url: pageModel.url,
                    visitedAt: now,
                    pageKind,
                    fieldsFilled: 0,
                    questionsAnswered: 0,
                },
            ],
        };
        await writeSession(session, tabId);
        return session;
    }

    // Existing session: decide whether this is a new step or just a re-parse.
    const sameOrigin = origin === existing.origin;
    const samePath = (() => {
        try {
            return new URL(existing.currentUrl).pathname === new URL(pageModel.url).pathname;
        } catch {
            return existing.currentUrl === pageModel.url;
        }
    })();

    if (!sameOrigin) {
        // Navigated off the application origin — archive this session and
        // start fresh on the next eligible parse.
        await archiveSessionByTab(tabId);
        return null;
    }

    if (samePath) {
        // Same step, just a re-parse — refresh activity timestamp + TTL.
        const refreshed: ApplicationSession = {
            ...existing,
            lastActiveAt: now,
            ttlExpiresAt: ttlISO(),
        };
        await writeSession(refreshed, tabId);
        return refreshed;
    }

    // URL pathname changed under the same origin → new step.
    const stepIndex = existing.step.index + 1;
    const advanced: ApplicationSession = {
        ...existing,
        lastActiveAt: now,
        ttlExpiresAt: ttlISO(),
        currentUrl: pageModel.url,
        step: { ...existing.step, index: stepIndex },
        history: [
            ...existing.history,
            {
                stepIndex,
                url: pageModel.url,
                visitedAt: now,
                pageKind,
                fieldsFilled: 0,
                questionsAnswered: 0,
            },
        ],
    };
    await writeSession(advanced, tabId);
    return advanced;
}

export async function getSession(tabId: number): Promise<ApplicationSession | null> {
    return readSession(tabId);
}

export async function bindWorkspace(
    tabId: number,
    workspaceId: string
): Promise<ApplicationSession | null> {
    const session = await readSession(tabId);
    if (!session) return null;
    const updated: ApplicationSession = {
        ...session,
        workspaceId,
        lastActiveAt: new Date().toISOString(),
    };
    await writeSession(updated, tabId);
    return updated;
}

// chrome.tabs.onRemoved already fires from tabContext for cache cleanup; mirror
// that here for the session persistence layer so closed tabs flush to archive.
chrome.tabs.onRemoved.addListener((tabId) => {
    void archiveSessionByTab(tabId);
});

// TTL alarm sweeps expired sessions to archive.
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith('session-ttl:')) return;
    const targetId = alarm.name.slice('session-ttl:'.length);
    const all = await chrome.storage.local.get(null);
    for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith(SESSION_PREFIX)) continue;
        const session = value as ApplicationSession;
        if (session.id === targetId) {
            const tabId = Number(key.slice(SESSION_PREFIX.length));
            await archiveSessionByTab(tabId);
            break;
        }
    }
});
