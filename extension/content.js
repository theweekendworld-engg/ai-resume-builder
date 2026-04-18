(function extensionContent(globalScope) {
  if (globalScope.__PATRONUS_CONTENT_READY__) {
    return;
  }
  globalScope.__PATRONUS_CONTENT_READY__ = true;

  function hasValidExtensionContext() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  function safeSendResponse(sendResponse, payload) {
    if (!hasValidExtensionContext()) {
      return;
    }

    try {
      sendResponse(payload);
    } catch {
      // Ignore stale callbacks from invalidated extension instances.
    }
  }

  function createFallbackContext(error) {
    return {
      url: globalScope.location.href,
      visibleTitle: document.title || undefined,
      heading: document.title || 'Page detected',
      classification: {
        platform: 'generic',
        pageKind: 'unknown',
        confidenceBand: 'low',
        confidenceScore: 0,
        reasons: ['Parser fallback was used because the structured scan failed.'],
      },
      metadata: {},
      jobDescription: null,
      reducedRegions: [],
      fields: [],
      questions: [],
      stats: {
        visibleFieldCount: 0,
        requiredFieldCount: 0,
        questionCount: 0,
        reducedRegionCount: 0,
      },
      extractedAt: new Date().toISOString(),
      parserError: error instanceof Error ? error.message : 'Failed to parse page',
    };
  }

  function parseSnapshot() {
    return (() => {
      try {
        return globalScope.PatronusParser?.parseCurrentPage?.() || createFallbackContext(new Error('Parser unavailable'));
      } catch (error) {
        return createFallbackContext(error);
      }
    })();
  }

  if (!hasValidExtensionContext()) {
    return;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PARSE_PAGE_CONTEXT') {
      safeSendResponse(sendResponse, {
        ok: true,
        payload: parseSnapshot(),
      });
      return undefined;
    }

    if (message?.type === 'APPLY_FILL_PLAN') {
      globalScope.PatronusFill?.applyFillPlan?.(message?.payload?.actions || [])
        .then((result) => safeSendResponse(sendResponse, result))
        .catch((error) => {
          safeSendResponse(sendResponse, {
            appliedCount: 0,
            restoredCount: 0,
            results: [{
              actionId: '',
              fieldLabel: 'Safe autofill',
              status: 'failed',
              reason: error instanceof Error ? error.message : 'Failed to apply fill plan',
            }],
            undoEntries: [],
          });
        });
      return true;
    }

    if (message?.type === 'UNDO_FILL_PLAN') {
      globalScope.PatronusFill?.undoFillPlan?.(message?.payload?.undoEntries || [])
        .then((result) => safeSendResponse(sendResponse, result))
        .catch((error) => {
          safeSendResponse(sendResponse, {
            appliedCount: 0,
            restoredCount: 0,
            results: [{
              actionId: '',
              fieldLabel: 'Undo autofill',
              status: 'failed',
              reason: error instanceof Error ? error.message : 'Failed to undo fill plan',
            }],
          });
        });
      return true;
    }

    if (message?.type === 'FOCUS_FIELD') {
      globalScope.PatronusFill?.focusField?.(message?.payload?.locator)
        .then((result) => safeSendResponse(sendResponse, result))
        .catch((error) => {
          safeSendResponse(sendResponse, {
            appliedCount: 0,
            restoredCount: 0,
            results: [{
              actionId: '',
              fieldLabel: 'Focus field',
              status: 'failed',
              reason: error instanceof Error ? error.message : 'Failed to focus the field',
            }],
          });
        });
      return true;
    }

    return undefined;
  });
})(globalThis);
