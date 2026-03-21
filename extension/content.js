(function extensionContent(globalScope) {
  let lastPublishedSignature = '';
  let publishTimer = null;

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

  function snapshotSignature(payload) {
    return JSON.stringify({
      url: payload.url,
      pageKind: payload.classification?.pageKind,
      platform: payload.classification?.platform,
      heading: payload.heading,
      fieldCount: payload.stats?.visibleFieldCount,
      questionCount: payload.stats?.questionCount,
      roleTitle: payload.metadata?.roleTitle,
      companyName: payload.metadata?.companyName,
      jobDescriptionSample: payload.jobDescription?.text?.slice(0, 240) || '',
    });
  }

  function publishSnapshot(force) {
    const payload = (() => {
      try {
        return globalScope.PatronusParser?.parseCurrentPage?.() || createFallbackContext(new Error('Parser unavailable'));
      } catch (error) {
        return createFallbackContext(error);
      }
    })();

    const signature = snapshotSignature(payload);
    if (!force && signature === lastPublishedSignature) {
      return;
    }

    lastPublishedSignature = signature;
    chrome.runtime.sendMessage({
      type: 'PAGE_CONTEXT',
      payload,
    });
  }

  function schedulePublish(delay, force) {
    globalScope.clearTimeout(publishTimer);
    publishTimer = globalScope.setTimeout(() => publishSnapshot(Boolean(force)), delay);
  }

  publishSnapshot(true);

  globalScope.addEventListener('load', () => publishSnapshot(true));
  globalScope.addEventListener('focus', () => schedulePublish(150, true));
  globalScope.addEventListener('popstate', () => schedulePublish(150, true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      schedulePublish(150, true);
    }
  });

  const observer = new MutationObserver(() => {
    schedulePublish(350, false);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'aria-hidden', 'aria-expanded', 'open'],
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'APPLY_FILL_PLAN') {
      globalScope.PatronusFill?.applyFillPlan?.(message?.payload?.actions || [])
        .then((result) => sendResponse(result))
        .catch((error) => {
          sendResponse({
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
        .then((result) => sendResponse(result))
        .catch((error) => {
          sendResponse({
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
        .then((result) => sendResponse(result))
        .catch((error) => {
          sendResponse({
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
