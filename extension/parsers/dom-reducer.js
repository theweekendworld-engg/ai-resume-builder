(function registerDomReducer(globalScope) {
  const parser = globalScope.PatronusParser = globalScope.PatronusParser || {};
  const utils = parser.utils;

  function inferRegionKind(element) {
    if (!(element instanceof HTMLElement)) return 'section';
    if (element.matches('dialog, [role="dialog"], [aria-modal="true"]')) return 'dialog';
    if (element.matches('form')) return 'form';
    if (element.matches('main, [role="main"], article')) return 'main';
    if (element.matches('aside, nav')) return 'sidebar';
    return 'section';
  }

  function scoreRegion(element, kind, text, interactiveCount) {
    const textLength = text.length;
    const keywordHits = utils.getKeywordHits(text, utils.POSITIVE_JD_KEYWORDS);
    const viewportBias = utils.getViewportBias(element);
    const kindBoost = kind === 'dialog'
      ? 0.32
      : kind === 'form'
        ? 0.28
        : kind === 'main'
          ? 0.22
          : kind === 'section'
            ? 0.12
            : 0;

    const score = (
      Math.min(textLength / 6000, 0.34)
      + Math.min(interactiveCount / 20, 0.24)
      + Math.min(keywordHits / 6, 0.2)
      + (viewportBias * 0.12)
      + kindBoost
    );

    return utils.clamp(score, 0, 1);
  }

  function collectCandidateRoots() {
    const selectors = [
      'dialog[open]',
      '[role="dialog"]',
      '[aria-modal="true"]',
      'form',
      'main',
      '[role="main"]',
      'article',
      'section',
      '#main',
      '#content',
      '.main',
      '.content',
      '.job-description',
      '.jobs-description',
      '.application',
    ];

    const candidates = [];
    for (const selector of selectors) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        if (!(element instanceof HTMLElement) || !utils.isElementVisible(element)) continue;
        candidates.push(element);
      }
    }

    const largestColumn = Array.from(document.querySelectorAll('div'))
      .filter((element) => element instanceof HTMLElement && utils.isElementVisible(element))
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
      })[0];

    if (largestColumn) {
      candidates.push(largestColumn);
    }

    if (document.body instanceof HTMLElement) {
      candidates.push(document.body);
    }

    return Array.from(new Set(candidates));
  }

  function reduceDom() {
    const rawRoots = collectCandidateRoots();
    const regions = rawRoots.map((element, index) => {
      const kind = inferRegionKind(element);
      const text = utils.readText(element);
      const interactiveCount = Array.from(element.querySelectorAll('input, textarea, select, button, [role="button"]'))
        .filter(utils.isElementVisible)
        .length;

      return {
        id: `region-${index + 1}`,
        kind,
        element,
        elementPath: utils.getElementPath(element),
        textSample: utils.getTextSample(element, 280),
        visibleTextLength: text.length,
        interactiveCount,
        score: scoreRegion(element, kind, text, interactiveCount),
      };
    }).filter((region) => region.visibleTextLength > 0 || region.interactiveCount > 0);

    regions.sort((left, right) => right.score - left.score);

    const deduped = [];
    for (const region of regions) {
      const isNestedDuplicate = deduped.some((existing) => {
        if (!(existing.element instanceof HTMLElement) || !(region.element instanceof HTMLElement)) return false;
        const sameKind = existing.kind === region.kind;
        const overlaps = existing.element.contains(region.element) || region.element.contains(existing.element);
        const similarText = Math.abs(existing.visibleTextLength - region.visibleTextLength) < 120;
        return sameKind && overlaps && similarText;
      });

      if (!isNestedDuplicate) {
        deduped.push(region);
      }

      if (deduped.length >= 8) break;
    }

    return deduped;
  }

  parser.reduceDom = reduceDom;
})(globalThis);
