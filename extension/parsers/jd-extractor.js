(function registerJobExtraction(globalScope) {
  const parser = globalScope.PatronusParser = globalScope.PatronusParser || {};
  const utils = parser.utils;

  function pickTitleCandidate() {
    const headings = Array.from(document.querySelectorAll('h1, h2'))
      .filter(utils.isElementVisible)
      .map((node) => ({
        text: utils.readText(node),
        score: node.tagName.toLowerCase() === 'h1' ? 1 : 0.75,
        element: node,
      }))
      .filter((candidate) => candidate.text && candidate.text.length <= 140);

    headings.sort((left, right) => right.score - left.score);
    return headings[0] || null;
  }

  function pickCompanyCandidate(titleElement) {
    if (!(titleElement instanceof HTMLElement)) return '';

    const nearby = Array.from(titleElement.parentElement?.querySelectorAll('h2, h3, p, span, a, div') || [])
      .filter((element) => element instanceof HTMLElement && utils.isElementVisible(element))
      .map((element) => utils.readText(element))
      .filter((text) => text && text.length <= 120 && text !== utils.readText(titleElement))
      .filter((text) => !/(responsibilities|requirements|qualifications|apply|share)/i.test(text));

    const titleText = utils.readText(titleElement);
    const splitFromDocumentTitle = document.title
      .split(/[\-|@|,]/g)
      .map((part) => utils.normalizeWhitespace(part))
      .find((part) => part && part !== titleText && part.length <= 80);

    return nearby[0] || splitFromDocumentTitle || '';
  }

  function pickLocationCandidate(titleElement) {
    const scope = titleElement?.parentElement || document.body;
    const nodes = Array.from(scope.querySelectorAll('p, span, div, li'))
      .filter((element) => element instanceof HTMLElement && utils.isElementVisible(element))
      .map((element) => utils.readText(element))
      .filter(Boolean);

    return nodes.find((text) => {
      if (text.length > 120) return false;
      return /(remote|hybrid|onsite|on-site|\b[a-z]+,\s?[a-z]{2}\b|\b[a-z]+,\s?[a-z]+\b)/i.test(text);
    }) || '';
  }

  function inferWorkplaceType(locationText, descriptionText) {
    const text = `${locationText} ${descriptionText}`.toLowerCase();
    if (text.includes('hybrid')) return 'hybrid';
    if (text.includes('remote')) return 'remote';
    if (text.includes('onsite') || text.includes('on-site')) return 'onsite';
    return 'unknown';
  }

  function pickCompensation(text) {
    const matches = text.match(/([$€£]\s?\d[\d,]*(?:\s?[-to]{1,3}\s?[$€£]?\d[\d,]*)?(?:\s?\/\s?(?:year|yr|hour|hr))?)/i);
    return matches?.[0] || '';
  }

  function scoreJdCandidate(region, titleElementPath) {
    const text = utils.readText(region.element);
    const textLengthScore = Math.min(text.length / 7000, 0.35);
    const keywordScore = Math.min(utils.getKeywordHits(text, utils.POSITIVE_JD_KEYWORDS) / 6, 0.27);
    const negativePenalty = Math.min(utils.getKeywordHits(text, utils.NEGATIVE_JD_KEYWORDS) / 6, 0.2);
    const listDensity = Math.min(region.element.querySelectorAll('li').length / 20, 0.12);
    const linkPenalty = Math.min(region.element.querySelectorAll('a').length / 30, 0.12);
    const headingBoost = region.elementPath.includes(titleElementPath) ? 0.08 : 0;
    const regionBoost = region.kind === 'main' ? 0.12 : region.kind === 'section' ? 0.08 : 0.04;

    return utils.clamp(
      textLengthScore + keywordScore + listDensity + headingBoost + regionBoost - negativePenalty - linkPenalty,
      0,
      1
    );
  }

  function cleanJobDescription(text) {
    const lines = String(text || '')
      .split(/\n+/)
      .map((line) => utils.normalizeWhitespace(line))
      .filter(Boolean)
      .filter((line) => !/^(apply|share|save|report this job|sign in|follow company)$/i.test(line));

    return utils.dedupeLines(lines.join('\n')).slice(0, 100000).trim();
  }

  function extractJobDescription(reducedRegions) {
    const titleCandidate = pickTitleCandidate();
    const titlePath = titleCandidate?.element ? utils.getElementPath(titleCandidate.element) : '';
    const scoredRegions = reducedRegions
      .map((region) => ({
        region,
        text: utils.readText(region.element),
        score: scoreJdCandidate(region, titlePath),
      }))
      .filter((entry) => entry.text.length >= 150)
      .sort((left, right) => right.score - left.score);

    let combinedText = '';
    let sourceHint = '';
    let score = 0.15;

    if (scoredRegions[0] && scoredRegions[0].score >= 0.3) {
      combinedText = cleanJobDescription(scoredRegions[0].text);
      sourceHint = scoredRegions[0].region.id;
      score = scoredRegions[0].score;
    } else {
      combinedText = cleanJobDescription(scoredRegions.slice(0, 3).map((entry) => entry.text).join('\n\n'));
      sourceHint = scoredRegions.slice(0, 3).map((entry) => entry.region.id).join(', ');
      score = scoredRegions.length > 0 ? scoredRegions[0].score * 0.75 : 0.1;
    }

    if (!combinedText) return null;

    return {
      text: combinedText,
      confidenceScore: utils.clamp(score, 0, 1),
      confidenceBand: utils.confidenceBand(score),
      sourceHint: sourceHint || undefined,
    };
  }

  function extractMetadata(jobDescription) {
    const titleCandidate = pickTitleCandidate();
    const roleTitle = titleCandidate?.text || '';
    const companyName = pickCompanyCandidate(titleCandidate?.element);
    const location = pickLocationCandidate(titleCandidate?.element);
    const jsonLdObjects = utils.collectJsonLdObjects();
    const jobPosting = jsonLdObjects.find((entry) => String(entry['@type'] || '').toLowerCase() === 'jobposting');
    const descriptionText = jobDescription?.text || '';

    const companyFromJsonLd = utils.normalizeWhitespace(
      jobPosting?.hiringOrganization?.name || jobPosting?.organization?.name || ''
    );
    const locationFromJsonLd = utils.normalizeWhitespace(
      jobPosting?.jobLocation?.address?.addressLocality
      || jobPosting?.jobLocation?.address?.addressRegion
      || ''
    );

    return {
      companyName: companyName || companyFromJsonLd || undefined,
      roleTitle: roleTitle || utils.normalizeWhitespace(jobPosting?.title || '') || undefined,
      location: location || locationFromJsonLd || undefined,
      compensationText: pickCompensation(`${descriptionText} ${utils.readText(document.body).slice(0, 5000)}`) || undefined,
      workplaceType: inferWorkplaceType(location || locationFromJsonLd, descriptionText),
    };
  }

  parser.extractJobDescription = extractJobDescription;
  parser.extractJobMetadata = extractMetadata;
})(globalThis);
