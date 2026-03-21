(function registerPageParser(globalScope) {
  const parser = globalScope.PatronusParser = globalScope.PatronusParser || {};

  function parseCurrentPage() {
    const classification = parser.classifyPage();
    const reducedRegions = parser.reduceDom();
    const jobDescription = parser.extractJobDescription(reducedRegions);
    const metadata = parser.extractJobMetadata(jobDescription);
    const normalized = parser.collectNormalizedFields();

    return {
      url: globalScope.location.href,
      visibleTitle: document.title || undefined,
      heading: metadata.roleTitle || document.title || undefined,
      classification: {
        platform: classification.platform,
        pageKind: classification.pageKind,
        confidenceBand: classification.confidenceBand,
        confidenceScore: classification.confidenceScore,
        reasons: classification.reasons,
      },
      metadata,
      jobDescription,
      reducedRegions: reducedRegions.map((region) => ({
        id: region.id,
        kind: region.kind,
        elementPath: region.elementPath,
        textSample: region.textSample,
        visibleTextLength: region.visibleTextLength,
        interactiveCount: region.interactiveCount,
        score: region.score,
      })),
      fields: normalized.fields,
      questions: normalized.questions,
      stats: {
        visibleFieldCount: normalized.fields.length,
        requiredFieldCount: normalized.fields.filter((field) => field.required).length,
        questionCount: normalized.questions.length,
        reducedRegionCount: reducedRegions.length,
      },
      extractedAt: new Date().toISOString(),
    };
  }

  parser.parseCurrentPage = parseCurrentPage;
})(globalThis);
