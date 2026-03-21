import { getAppBaseUrl } from './lib/app-config.js';
import { getUndoStorageKey } from './fill/undo-store.js';

const TAB_KEY_PREFIX = 'tab:';
const EXTENSION_SESSION_KEY = 'extensionSession';

async function setPanelBehavior() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // Ignore on unsupported Chrome versions.
  }
}

function getStorageKey(tabId) {
  return `${TAB_KEY_PREFIX}${tabId}`;
}

async function saveTabContext(tabId, payload) {
  await chrome.storage.session.set({
    [getStorageKey(tabId)]: {
      ...payload,
      tabId,
      updatedAt: new Date().toISOString(),
    },
  });
}

async function loadTabContext(tabId) {
  const result = await chrome.storage.session.get(getStorageKey(tabId));
  return result[getStorageKey(tabId)] ?? null;
}

async function loadUndoEntries(tabId) {
  const result = await chrome.storage.session.get(getUndoStorageKey(tabId));
  return result[getUndoStorageKey(tabId)] ?? [];
}

async function saveUndoEntries(tabId, entries) {
  await chrome.storage.session.set({
    [getUndoStorageKey(tabId)]: entries,
  });
}

async function clearUndoEntries(tabId) {
  await chrome.storage.session.remove(getUndoStorageKey(tabId));
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function sendToActiveTab(message) {
  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    throw new Error('No active tab');
  }

  const response = await chrome.tabs.sendMessage(activeTab.id, message);
  return {
    tabId: activeTab.id,
    response,
  };
}

async function loadExtensionSession() {
  const appBaseUrl = await getAppBaseUrl();
  const stored = await chrome.storage.local.get(EXTENSION_SESSION_KEY);
  const session = stored?.[EXTENSION_SESSION_KEY];

  if (!session || typeof session !== 'object') {
    return null;
  }

  if (session.appBaseUrl !== appBaseUrl) {
    await chrome.storage.local.remove(EXTENSION_SESSION_KEY);
    return null;
  }

  return session;
}

async function saveExtensionSession(session) {
  await chrome.storage.local.set({
    [EXTENSION_SESSION_KEY]: session,
  });
}

async function clearExtensionSession() {
  await chrome.storage.local.remove(EXTENSION_SESSION_KEY);
}

function shouldRefreshExtensionSession(expiresAt) {
  if (!expiresAt) return true;
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return true;
  return expiry - Date.now() <= (5 * 60 * 1000);
}

async function createExtensionSession() {
  const appBaseUrl = await getAppBaseUrl();
  const response = await fetch(`${appBaseUrl}/api/extension/session`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    await clearExtensionSession();
    return null;
  }

  if (!response.ok || payload?.success === false || !payload?.accessToken) {
    throw new Error(payload?.error || 'Unable to create an extension session');
  }

  const session = {
    accessToken: payload.accessToken,
    expiresAt: payload.expiresAt,
    tokenType: payload.tokenType || 'Bearer',
    sessionId: payload.sessionId,
    appBaseUrl,
  };
  await saveExtensionSession(session);
  return session;
}

async function ensureExtensionSession(forceRefresh = false) {
  const current = await loadExtensionSession();
  if (!forceRefresh && current?.accessToken && !shouldRefreshExtensionSession(current.expiresAt)) {
    return current;
  }

  return createExtensionSession();
}

async function fetchExtensionApi(path, options = {}) {
  const appBaseUrl = await getAppBaseUrl();

  async function runWithSession(session) {
    const headers = {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(session?.accessToken ? { Authorization: `${session.tokenType || 'Bearer'} ${session.accessToken}` } : {}),
      ...(options.headers || {}),
    };

    const response = await fetch(`${appBaseUrl}${path}`, {
      method: options.method || 'GET',
      credentials: 'include',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  }

  let session = await ensureExtensionSession(false);
  let result = await runWithSession(session);

  if (result.response.status === 401) {
    await clearExtensionSession();
    session = await ensureExtensionSession(true);
    if (!session) {
      throw new Error(result.payload?.error || 'Sign in to the web app to authorize the browser extension.');
    }
    result = await runWithSession(session);
  }

  if (!result.response.ok || result.payload?.success === false) {
    throw new Error(result.payload?.error || `Request to ${path} failed`);
  }

  return result.payload;
}

async function fetchExtensionProfileBundle() {
  const payload = await fetchExtensionApi('/api/extension/me');
  return payload.bundle;
}

async function probeExtensionAccess() {
  const appBaseUrl = await getAppBaseUrl();

  try {
    const session = await ensureExtensionSession(false);
    if (!session) {
      return {
        ok: true,
        status: 'unauthenticated',
        appBaseUrl,
        message: 'Sign in to the web app in this browser first.',
      };
    }

    const payload = await fetchExtensionApi('/api/extension/me');
    return {
      ok: true,
      status: 'authenticated',
      appBaseUrl,
      authType: payload?.authType || 'extension_token',
      expiresAt: session.expiresAt,
      message: 'Dedicated extension access token is active.',
    };
  } catch (error) {
    return {
      ok: true,
      status: 'unreachable',
      appBaseUrl,
      message: error instanceof Error ? error.message : 'Unable to reach the configured app URL.',
    };
  }
}

async function postExtensionJson(path, body) {
  return fetchExtensionApi(path, {
    method: 'POST',
    body: body ?? {},
  });
}

async function getExtensionJson(path) {
  return fetchExtensionApi(path);
}

async function suggestQuestionAnswers(payload) {
  return postExtensionJson('/api/extension/questions/suggest', payload);
}

async function saveQuestionAnswer(payload) {
  return postExtensionJson('/api/extension/questions/save', payload);
}

async function upsertWorkspace(payload) {
  return postExtensionJson('/api/extension/workspaces/upsert', payload);
}

async function startResumeGeneration(payload) {
  return postExtensionJson('/api/extension/resume/generate', payload);
}

async function fetchGenerationStatus(sessionId, workspaceId) {
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
  return getExtensionJson(`/api/extension/generate/${encodeURIComponent(sessionId)}/status${query}`);
}

async function fetchCompanyInsight(payload) {
  return postExtensionJson('/api/extension/company-insight', payload);
}

async function analyzeExtensionPage(payload) {
  return postExtensionJson('/api/extension/page/analyze', payload);
}

async function fetchWorkspace(workspaceId) {
  return fetchExtensionApi(`/api/extension/workspaces/${encodeURIComponent(workspaceId)}`);
}

chrome.runtime.onInstalled.addListener(() => {
  setPanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  setPanelBehavior();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PAGE_CONTEXT') {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false, error: 'Missing tab context' });
      return;
    }

    saveTabContext(tabId, message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to save tab context',
        });
      });

    return true;
  }

  if (message?.type === 'GET_ACTIVE_TAB_CONTEXT') {
    getActiveTab()
      .then(async (activeTab) => {
        if (!activeTab?.id) {
          sendResponse({ ok: false, error: 'No active tab' });
          return;
        }

        const [context, undoEntries] = await Promise.all([
          loadTabContext(activeTab.id),
          loadUndoEntries(activeTab.id),
        ]);

        sendResponse({
          ok: true,
          context,
          hasUndo: undoEntries.length > 0,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Unable to load tab context',
        });
      });
    return true;
  }

  if (message?.type === 'GET_EXTENSION_PROFILE_BUNDLE') {
    fetchExtensionProfileBundle()
      .then((bundle) => sendResponse({ ok: true, bundle }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Unable to load extension profile bundle',
        });
      });
    return true;
  }

  if (message?.type === 'CHECK_EXTENSION_ACCESS') {
    probeExtensionAccess()
      .then((payload) => sendResponse(payload))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Unable to verify extension access',
        });
      });
    return true;
  }

  if (message?.type === 'APPLY_FILL_PLAN') {
    sendToActiveTab({
      type: 'APPLY_FILL_PLAN',
      payload: {
        actions: message.actions,
      },
    })
      .then(async ({ tabId, response }) => {
        const undoEntries = Array.isArray(response?.undoEntries) ? response.undoEntries : [];
        if (undoEntries.length > 0) {
          await saveUndoEntries(tabId, undoEntries);
        } else {
          await clearUndoEntries(tabId);
        }

        sendResponse({
          ok: true,
          result: {
            appliedCount: response?.appliedCount ?? 0,
            restoredCount: response?.restoredCount ?? 0,
            results: Array.isArray(response?.results) ? response.results : [],
          },
          hasUndo: undoEntries.length > 0,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to apply fill plan',
        });
      });
    return true;
  }

  if (message?.type === 'SUGGEST_QUESTION_ANSWERS') {
    suggestQuestionAnswers(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to suggest answers for the detected question',
        });
      });
    return true;
  }

  if (message?.type === 'SAVE_QUESTION_ANSWER') {
    saveQuestionAnswer(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to save the drafted answer',
        });
      });
    return true;
  }

  if (message?.type === 'UPSERT_WORKSPACE') {
    upsertWorkspace(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to sync the application workspace',
        });
      });
    return true;
  }

  if (message?.type === 'GET_WORKSPACE') {
    fetchWorkspace(message.workspaceId)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to load the application workspace',
        });
      });
    return true;
  }

  if (message?.type === 'START_RESUME_GENERATION') {
    startResumeGeneration(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to start resume generation',
        });
      });
    return true;
  }

  if (message?.type === 'GET_GENERATION_STATUS') {
    fetchGenerationStatus(message.sessionId, message.workspaceId)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to load generation status',
        });
      });
    return true;
  }

  if (message?.type === 'GET_COMPANY_INSIGHT') {
    fetchCompanyInsight(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to load company insight',
        });
      });
    return true;
  }

  if (message?.type === 'ANALYZE_PAGE_CONTEXT') {
    analyzeExtensionPage(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to analyze the current page',
        });
      });
    return true;
  }

  if (message?.type === 'OPEN_URL') {
    chrome.tabs.create({ url: message.url })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to open the requested URL',
        });
      });
    return true;
  }

  if (message?.type === 'INSERT_QUESTION_ANSWER') {
    const action = {
      id: `question-answer-${Date.now()}`,
      action: 'review_required',
      fieldLabel: message.payload?.fieldLabel || 'Application question',
      inputType: message.payload?.inputType || 'textarea',
      locator: message.payload?.locator,
      value: message.payload?.answer || '',
      valuePreview: message.payload?.answer || '',
      canApply: true,
      reason: 'Insert the reviewed AI draft into this question field.',
      confidenceBand: 'medium',
      confidenceScore: typeof message.payload?.confidence === 'number' ? message.payload.confidence : 0.72,
      source: {
        type: 'manual',
        label: 'AI answer suggestion',
      },
    };

    sendToActiveTab({
      type: 'APPLY_FILL_PLAN',
      payload: {
        actions: [action],
      },
    })
      .then(async ({ tabId, response }) => {
        const undoEntries = Array.isArray(response?.undoEntries) ? response.undoEntries : [];
        if (undoEntries.length > 0) {
          await saveUndoEntries(tabId, undoEntries);
        } else {
          await clearUndoEntries(tabId);
        }

        sendResponse({
          ok: true,
          result: {
            appliedCount: response?.appliedCount ?? 0,
            restoredCount: response?.restoredCount ?? 0,
            results: Array.isArray(response?.results) ? response.results : [],
          },
          hasUndo: undoEntries.length > 0,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to insert the selected answer',
        });
      });
    return true;
  }

  if (message?.type === 'UNDO_LAST_FILL') {
    getActiveTab()
      .then(async (activeTab) => {
        if (!activeTab?.id) {
          sendResponse({ ok: false, error: 'No active tab' });
          return;
        }

        const undoEntries = await loadUndoEntries(activeTab.id);
        if (undoEntries.length === 0) {
          sendResponse({ ok: true, result: { appliedCount: 0, restoredCount: 0, results: [] }, hasUndo: false });
          return;
        }

        const response = await chrome.tabs.sendMessage(activeTab.id, {
          type: 'UNDO_FILL_PLAN',
          payload: {
            undoEntries,
          },
        });

        await clearUndoEntries(activeTab.id);
        sendResponse({
          ok: true,
          result: {
            appliedCount: response?.appliedCount ?? 0,
            restoredCount: response?.restoredCount ?? 0,
            results: Array.isArray(response?.results) ? response.results : [],
          },
          hasUndo: false,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to undo fill plan',
        });
      });
    return true;
  }

  if (message?.type === 'FOCUS_FIELD') {
    sendToActiveTab({
      type: 'FOCUS_FIELD',
      payload: {
        locator: message.locator,
      },
    })
      .then(({ response }) => {
        sendResponse({
          ok: true,
          result: {
            appliedCount: response?.appliedCount ?? 0,
            restoredCount: response?.restoredCount ?? 0,
            results: Array.isArray(response?.results) ? response.results : [],
          },
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to focus the requested field',
        });
      });
    return true;
  }

  return undefined;
});
