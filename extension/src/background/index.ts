import { on } from './messageBus';
import { setAuth, clearAuth, getAuthState, getToken } from './tokenStore';
import {
    setPageModel,
    getPageModel,
    setUndoEntries,
    getUndoEntries,
    clearUndoEntries,
} from './tabContext';
import { getAppBaseUrl } from './backendConfig';
import { reconcileSessionOnPageUpdate, getSession, bindWorkspace } from './session';
import { startConnectFlow, cancelConnectFlow, pollConnectOnce } from './connect';
import { buildFillPlan } from '@/fill/planner';
import type { ResolvedProfileBundle } from '@/fill/valueResolver';

type ProfileBackendBundle = {
    profile?: {
        fullName?: string;
        email?: string;
        phone?: string;
        location?: string;
        linkedin?: string;
        github?: string;
        website?: string;
        yearsExperience?: string;
    };
    experiences?: unknown[];
};

let cachedBundle: ProfileBackendBundle | null = null;
let cachedBundleAt = 0;

async function getProfileBundle(): Promise<ProfileBackendBundle | null> {
    if (cachedBundle && Date.now() - cachedBundleAt < 60_000) return cachedBundle;
    const token = await getToken();
    if (!token) return null;
    const base = await getAppBaseUrl();
    try {
        const res = await fetch(`${base}/api/extension/me`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { success: boolean; bundle?: ProfileBackendBundle };
        cachedBundle = json.bundle ?? null;
        cachedBundleAt = Date.now();
        return cachedBundle;
    } catch {
        return null;
    }
}

// MV3 service worker entry. Stays restart-safe by keeping all durable state in
// chrome.storage.local (auth) and re-hydrating in-memory caches lazily.

on('PING', async () => ({ ok: true, data: { pong: true } }));

on('AUTH_GET', async () => ({ ok: true, data: await getAuthState() }));

on('AUTH_HANDSHAKE', async (msg) => {
    await setAuth({
        token: msg.token,
        userId: msg.userId,
        email: msg.email,
        expiresAt: msg.expiresAt,
    });
    return { ok: true, data: { stored: true } };
});

on('AUTH_CLEAR', async () => {
    await clearAuth();
    return { ok: true, data: { cleared: true } };
});

on('CONNECT_START', async () => {
    const res = await startConnectFlow();
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, data: { connectUrl: res.connectUrl } };
});

on('CONNECT_CANCEL', async () => {
    await cancelConnectFlow();
    return { ok: true, data: { cancelled: true } };
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'connect:poll') {
        pollConnectOnce().catch(() => {
            // pollConnectOnce already swallows transient errors; this catch is
            // a final safety net so an unhandled rejection doesn't crash the SW.
        });
    }
});

on('PAGE_CONTEXT_UPDATED', async (msg, sender) => {
    // The content script doesn't know its own tabId, so tabId on the message
    // is a placeholder (-1). Read the real tabId off the MessageSender.
    const realTabId = sender?.tab?.id ?? msg.tabId;
    setPageModel(realTabId, msg.pageModel);
    const session = await reconcileSessionOnPageUpdate(realTabId, msg.pageModel);
    return { ok: true, data: { received: true, sessionId: session?.id ?? null } };
});

on('GET_SESSION', async (msg) => ({
    ok: true,
    data: await getSession(msg.tabId),
}));

on('BIND_WORKSPACE', async (msg) => {
    const session = await bindWorkspace(msg.tabId, msg.workspaceId);
    if (session) {
        // Best-effort upsync to the orchestrate route so the workspace mirrors
        // session state server-side. Failure does not block the local bind.
        const token = await getToken();
        if (token) {
            const base = await getAppBaseUrl();
            const pageModel = getPageModel(msg.tabId);
            fetch(`${base}/api/extension/session/orchestrate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    workspaceId: session.workspaceId ?? undefined,
                    session,
                    pageSummary: pageModel
                        ? {
                              url: pageModel.url,
                              companyName: pageModel.metadata?.['companyName'] as string | undefined,
                              roleTitle: pageModel.metadata?.['roleTitle'] as string | undefined,
                              location: pageModel.metadata?.['location'] as string | undefined,
                              platform: pageModel.classification.platform,
                              pageKind: pageModel.classification.pageKind,
                          }
                        : undefined,
                }),
                keepalive: true,
            }).catch(() => {});
        }
    }
    return { ok: true, data: session };
});

on('GET_FILL_PLAN', async (msg) => {
    const pageModel = getPageModel(msg.tabId);
    if (!pageModel) return { ok: false, error: 'no_page_model' };
    const bundle = await getProfileBundle();
    if (!bundle) return { ok: false, error: 'no_profile' };
    const plan = buildFillPlan(
        pageModel.fields as never,
        bundle as ResolvedProfileBundle
    );
    return { ok: true, data: plan };
});

on('APPLY_FILLS', async (msg) => {
    try {
        const pageModel = getPageModel(msg.tabId);
        if (!pageModel) return { ok: false, error: 'no_page_model' };
        const bundle = await getProfileBundle();
        if (!bundle) return { ok: false, error: 'no_profile' };
        const plan = buildFillPlan(
            pageModel.fields as never,
            bundle as ResolvedProfileBundle
        );
        const filterIds = msg.actionIds && msg.actionIds.length > 0
            ? new Set(msg.actionIds)
            : null;
        const actions = plan.actions.filter((a) => {
            if (!a.canApply) return false;
            if (filterIds && !filterIds.has(a.id)) return false;
            // Bulk default: only auto_fill. Individual selection allows review_required.
            if (!filterIds && a.action !== 'auto_fill') return false;
            return true;
        });
        const res = (await chrome.tabs.sendMessage(msg.tabId, {
            type: 'CONTENT_APPLY_FILLS',
            actions,
        })) as { undoEntries?: unknown[]; appliedCount?: number; results?: unknown[] };
        setUndoEntries(msg.tabId, (res?.undoEntries ?? []) as never);
        return { ok: true, data: res };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : 'apply_failed',
        };
    }
});

on('UNDO_FILLS', async (msg) => {
    try {
        const entries = getUndoEntries(msg.tabId);
        if (entries.length === 0) {
            return { ok: true, data: { restoredCount: 0, results: [] } };
        }
        const res = (await chrome.tabs.sendMessage(msg.tabId, {
            type: 'CONTENT_UNDO_FILLS',
            undoEntries: entries,
        })) as { restoredCount?: number; results?: unknown[] };
        clearUndoEntries(msg.tabId);
        return { ok: true, data: res };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : 'undo_failed',
        };
    }
});

on('SUGGEST_ANSWER', async (msg) => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'not_authenticated' };
    const base = await getAppBaseUrl();
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const pageModel = tab?.id != null ? getPageModel(tab.id) : null;
        const body = {
            selectedTone: msg.tone,
            question: {
                id: msg.questionId,
                questionText: msg.questionText,
                typeHint: msg.typeHint,
                sectionHeading: msg.sectionHeading,
                locator: msg.locator,
                answerMode: 'long_text',
            },
            context: {
                sourceUrl: msg.sourceUrl || pageModel?.url,
                platform: pageModel?.classification.platform,
                pageKind: pageModel?.classification.pageKind,
                visibleTitle: pageModel?.visibleTitle,
                companyName: pageModel?.metadata?.['companyName'],
                roleTitle: pageModel?.metadata?.['roleTitle'],
                location: pageModel?.metadata?.['location'],
                jobDescription: pageModel?.jobDescription?.text,
            },
        };
        const res = await fetch(`${base}/api/extension/questions/suggest`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) return { ok: false, error: `suggest_failed:${res.status}` };
        const json = (await res.json()) as { success?: boolean; drafts?: unknown[] };
        return { ok: true, data: json };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : 'suggest_error',
        };
    }
});

on('INSERT_ANSWER', async (msg) => {
    try {
        const res = (await chrome.tabs.sendMessage(msg.tabId, {
            type: 'CONTENT_INSERT_TEXT',
            locator: msg.locator,
            text: msg.text,
        })) as { ok?: boolean; error?: string };
        if (res?.ok) return { ok: true, data: { inserted: true } };
        return { ok: false, error: res?.error ?? 'insert_failed' };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : 'insert_failed',
        };
    }
});

on('GET_PAGE_CONTEXT', async (msg) => ({
    ok: true,
    data: getPageModel(msg.tabId),
}));

on('REQUEST_REPARSE', async (msg) => {
    try {
        await chrome.tabs.sendMessage(msg.tabId, { type: 'CONTENT_REPARSE' });
        return { ok: true, data: { requested: true } };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : 'reparse_failed',
        };
    }
});

on('OPEN_SIDEPANEL', async (msg) => {
    try {
        await chrome.sidePanel.open({ tabId: msg.tabId });
        return { ok: true, data: { opened: true } };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : 'open_sidepanel_failed',
        };
    }
});

on('GET_PROFILE', async () => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'not_authenticated' };
    const base = await getAppBaseUrl();
    try {
        const res = await fetch(`${base}/api/extension/me`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return { ok: false, error: `profile_fetch_failed:${res.status}` };
        const json = (await res.json()) as {
            success: boolean;
            bundle?: {
                profile?: { fullName?: string; email?: string; phone?: string; location?: string };
                experiences?: unknown[];
            };
        };
        const p = json.bundle?.profile ?? {};
        const experiencesCount = json.bundle?.experiences?.length ?? 0;
        const bundle = {
            fullName: p.fullName ?? '',
            email: p.email ?? '',
            phone: p.phone ?? '',
            location: p.location ?? '',
            experiencesCount,
        };
        const missing: string[] = [];
        if (!bundle.fullName) missing.push('full name');
        if (!bundle.email) missing.push('email');
        if (!bundle.phone) missing.push('phone');
        if (!bundle.location) missing.push('location');
        if (bundle.experiencesCount === 0) missing.push('at least one work experience');
        return {
            ok: true,
            data: { bundle, completeness: { complete: missing.length === 0, missing } },
        };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : 'profile_fetch_error',
        };
    }
});

on('TELEMETRY_BATCH', async (msg) => {
    try {
        const token = await getToken();
        if (!token) {
            // No-op when disconnected; telemetry never fails loud.
            return { ok: true, data: { accepted: false, reason: 'no_token' } };
        }
        const base = await getAppBaseUrl();
        const res = await fetch(`${base}/api/extension/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ events: msg.events }),
            keepalive: true,
        });
        return { ok: true, data: { accepted: res.ok } };
    } catch {
        // Drop telemetry rather than surface errors. Caller queue is bounded.
        return { ok: true, data: { accepted: false, reason: 'network_error' } };
    }
});

// Default to opening the side panel on action click for tabs where it's not
// already wired (chromium quirk: per-tab setOptions is needed in some flows).
chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: false })
        .catch(() => {
            // Some chromium variants do not expose this API; ignore.
        });
});
