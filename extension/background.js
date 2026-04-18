import { getAppBaseUrl } from './lib/app-config.js';
import { getUndoStorageKey } from './fill/undo-store.js';

const TAB_KEY_PREFIX = 'tab:';
const EXTENSION_SESSION_KEY = 'extensionSession';
const EXTENSION_CONNECT_GRANT_KEY = 'extensionConnectGrant';
const CONTENT_SCRIPT_FILES = [
  'parsers/utils.js',
  'parsers/page-classifier.js',
  'parsers/dom-reducer.js',
  'parsers/jd-extractor.js',
  'parsers/field-detector.js',
  'parsers/index.js',
  'fill/fill-executor.js',
  'content.js',
];
const inFlightApiRequests = new Map();

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function buildApiRequestKey(path, body) {
  return `${path}:${stableStringify(body ?? {})}`;
}

function runApiSingleFlight(key, operation) {
  const existing = inFlightApiRequests.get(key);
  if (existing) return existing;

  const promise = operation().finally(() => {
    if (inFlightApiRequests.get(key) === promise) {
      inFlightApiRequests.delete(key);
    }
  });

  inFlightApiRequests.set(key, promise);
  return promise;
}

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

async function clearTabContext(tabId) {
  await chrome.storage.session.remove(getStorageKey(tabId));
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

async function parseActiveTabContext() {
  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    throw new Error('No active tab');
  }

  const response = await sendParseRequest(activeTab.id);

  if (!response?.ok || !response?.payload) {
    throw new Error(response?.error || 'Failed to parse the active tab');
  }

  await saveTabContext(activeTab.id, response.payload);
  return {
    tabId: activeTab.id,
    context: response.payload,
  };
}

async function applyFillPlanFromBackground(actions) {
  const { tabId, response } = await sendToActiveTab({
    type: 'APPLY_FILL_PLAN',
    payload: {
      actions,
    },
  });

  const undoEntries = Array.isArray(response?.undoEntries) ? response.undoEntries : [];
  if (undoEntries.length > 0) {
    await saveUndoEntries(tabId, undoEntries);
  } else {
    await clearUndoEntries(tabId);
  }

  return {
    ok: true,
    result: {
      appliedCount: response?.appliedCount ?? 0,
      restoredCount: response?.restoredCount ?? 0,
      results: Array.isArray(response?.results) ? response.results : [],
    },
    hasUndo: undoEntries.length > 0,
  };
}

async function sendParseRequest(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'PARSE_PAGE_CONTEXT',
    });

    if (response?.ok && response?.payload) {
      return response;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const needsInjection = message.includes('Receiving end does not exist')
      || message.includes('Could not establish connection');

    if (!needsInjection) {
      throw error;
    }
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES,
  });

  return chrome.tabs.sendMessage(tabId, {
    type: 'PARSE_PAGE_CONTEXT',
  });
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

async function loadExtensionConnectGrant() {
  const appBaseUrl = await getAppBaseUrl();
  const stored = await chrome.storage.local.get(EXTENSION_CONNECT_GRANT_KEY);
  const grant = stored?.[EXTENSION_CONNECT_GRANT_KEY];

  if (!grant || typeof grant !== 'object') {
    return null;
  }

  if (grant.appBaseUrl !== appBaseUrl) {
    await chrome.storage.local.remove(EXTENSION_CONNECT_GRANT_KEY);
    return null;
  }

  return grant;
}

async function saveExtensionConnectGrant(grant) {
  await chrome.storage.local.set({
    [EXTENSION_CONNECT_GRANT_KEY]: grant,
  });
}

async function clearExtensionConnectGrant() {
  await chrome.storage.local.remove(EXTENSION_CONNECT_GRANT_KEY);
}

function shouldRefreshExtensionSession(expiresAt) {
  if (!expiresAt) return true;
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return true;
  return expiry - Date.now() <= (5 * 60 * 1000);
}

function isExpired(expiresAt) {
  if (!expiresAt) return true;
  const expiry = new Date(expiresAt).getTime();
  return Number.isNaN(expiry) || expiry <= Date.now();
}

function sessionFromPayload(session, appBaseUrl) {
  if (!session?.accessToken) return null;
  return {
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
    tokenType: session.tokenType || 'Bearer',
    sessionId: session.sessionId,
    appBaseUrl,
  };
}

async function startExtensionConnect() {
  const appBaseUrl = await getAppBaseUrl();
  const response = await fetch(`${appBaseUrl}/api/extension/connect/start`, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false || !payload?.grantId || !payload?.verifier || !payload?.connectUrl) {
    throw new Error(payload?.error || 'Unable to start extension connection');
  }

  const grant = {
    grantId: payload.grantId,
    verifier: payload.verifier,
    expiresAt: payload.expiresAt,
    appBaseUrl,
  };
  await saveExtensionConnectGrant(grant);
  await chrome.tabs.create({ url: payload.connectUrl });

  return {
    status: 'pending',
    appBaseUrl,
    expiresAt: payload.expiresAt,
    connectUrl: payload.connectUrl,
  };
}

async function pollExtensionConnectGrant() {
  const appBaseUrl = await getAppBaseUrl();
  const grant = await loadExtensionConnectGrant();

  if (!grant) {
    return {
      status: 'none',
      appBaseUrl,
    };
  }

  if (isExpired(grant.expiresAt)) {
    await clearExtensionConnectGrant();
    return {
      status: 'expired',
      appBaseUrl,
      message: 'Connection request expired. Start a new connection from the extension.',
    };
  }

  const response = await fetch(`${appBaseUrl}/api/extension/connect/poll`, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grantId: grant.grantId,
      verifier: grant.verifier,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (payload?.status === 'pending') {
    return {
      status: 'pending',
      appBaseUrl,
      expiresAt: payload.expiresAt || grant.expiresAt,
      message: 'Finish signing in on the web page, then return here.',
    };
  }

  if (payload?.status === 'authorized' && payload?.session) {
    const session = sessionFromPayload(payload.session, appBaseUrl);
    if (!session) {
      throw new Error('Extension connection did not return an access token');
    }

    await saveExtensionSession(session);
    await clearExtensionConnectGrant();
    return {
      status: 'authenticated',
      appBaseUrl,
      authType: 'extension_token',
      expiresAt: session.expiresAt,
      session,
      message: 'Dedicated extension access token is active.',
    };
  }

  if (!response.ok || payload?.success === false) {
    await clearExtensionConnectGrant();
    return {
      status: 'expired',
      appBaseUrl,
      message: payload?.error || 'Connection request could not be completed. Start a new connection from the extension.',
    };
  }

  return {
    status: 'pending',
    appBaseUrl,
    expiresAt: grant.expiresAt,
    message: 'Finish signing in on the web page, then return here.',
  };
}

async function ensureExtensionSession(forceRefresh = false) {
  const current = await loadExtensionSession();
  if (!forceRefresh && current?.accessToken && !shouldRefreshExtensionSession(current.expiresAt)) {
    return current;
  }

  if (current?.accessToken) {
    await clearExtensionSession();
  }

  const connectResult = await pollExtensionConnectGrant();
  return connectResult.status === 'authenticated' ? connectResult.session : null;
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
      credentials: 'omit',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  }

  let session = await ensureExtensionSession(false);
  if (!session?.accessToken) {
    throw new Error('Connect the browser extension to your signed-in Patronus account first.');
  }

  let result = await runWithSession(session);

  if (result.response.status === 401) {
    await clearExtensionSession();
    session = await ensureExtensionSession(true);
    if (!session) {
      throw new Error(result.payload?.error || 'Connect the browser extension to your signed-in Patronus account first.');
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
      const grant = await loadExtensionConnectGrant();
      if (grant) {
        return {
          ok: true,
          status: 'pending',
          appBaseUrl,
          expiresAt: grant.expiresAt,
          message: 'Finish signing in on the web page, then return to the extension.',
        };
      }

      return {
        ok: true,
        status: 'unauthenticated',
        appBaseUrl,
        message: 'Connect the extension to your signed-in Patronus account.',
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

async function postExtensionJsonSingleFlight(path, body) {
  const requestBody = body ?? {};
  return runApiSingleFlight(
    buildApiRequestKey(path, requestBody),
    () => postExtensionJson(path, requestBody)
  );
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
  return postExtensionJsonSingleFlight('/api/extension/workspaces/upsert', payload);
}

async function startResumeGeneration(payload) {
  return postExtensionJson('/api/extension/resume/generate', payload);
}

async function fetchGenerationStatus(sessionId, workspaceId) {
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
  return getExtensionJson(`/api/extension/generate/${encodeURIComponent(sessionId)}/status${query}`);
}

async function fetchCompanyInsight(payload) {
  return postExtensionJsonSingleFlight('/api/extension/company-insight', payload);
}

async function analyzeExtensionPage(payload) {
  return postExtensionJson('/api/extension/page/analyze', payload);
}

async function fetchWorkspace(workspaceId) {
  return fetchExtensionApi(`/api/extension/workspaces/${encodeURIComponent(workspaceId)}`);
}

globalThis.__PATRONUS_EXTENSION_DEBUG__ = {
  parseActiveTabContext,
  applyFillPlanFromBackground,
};

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

        if (context?.url && activeTab.url && context.url !== activeTab.url) {
          await Promise.all([
            clearTabContext(activeTab.id),
            clearUndoEntries(activeTab.id),
          ]);

          sendResponse({
            ok: true,
            context: null,
            hasUndo: false,
          });
          return;
        }

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

  if (message?.type === 'PARSE_ACTIVE_TAB_CONTEXT') {
    parseActiveTabContext()
      .then(({ context }) => {
        sendResponse({
          ok: true,
          context,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Unable to parse the active tab',
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

  if (message?.type === 'START_EXTENSION_CONNECT') {
    startExtensionConnect()
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Unable to start extension connection',
        });
      });
    return true;
  }

  if (message?.type === 'POLL_EXTENSION_CONNECT') {
    pollExtensionConnectGrant()
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Unable to check extension connection',
        });
      });
    return true;
  }

  if (message?.type === 'APPLY_FILL_PLAN') {
    applyFillPlanFromBackground(message.actions)
      .then((result) => sendResponse(result))
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
