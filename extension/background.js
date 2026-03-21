import { getAppBaseUrl } from './lib/app-config.js';
import { getUndoStorageKey } from './fill/undo-store.js';

const TAB_KEY_PREFIX = 'tab:';

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

async function fetchExtensionProfileBundle() {
  const appBaseUrl = await getAppBaseUrl();
  const response = await fetch(`${appBaseUrl}/api/extension/me`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || 'Unable to load extension profile bundle');
  }

  return payload.bundle;
}

async function postExtensionJson(path, body) {
  const appBaseUrl = await getAppBaseUrl();
  const response = await fetch(`${appBaseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || `Request to ${path} failed`);
  }

  return payload;
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

async function fetchWorkspace(workspaceId) {
  const appBaseUrl = await getAppBaseUrl();
  const response = await fetch(`${appBaseUrl}/api/extension/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || 'Unable to load the application workspace');
  }

  return payload;
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
