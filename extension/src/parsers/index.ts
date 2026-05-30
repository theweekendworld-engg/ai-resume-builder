import { classifyPage } from './pageClassifier';
import { reduceDom } from './domReducer';
import { extractJobDescription, extractJobMetadata } from './jdExtractor';
import { collectNormalizedFields } from './fieldDetector';

export type { Platform, PageKind, PageClassification } from './pageClassifier';
export type { ReducedRegion, RegionKind } from './domReducer';
export type { JobDescriptionExtraction, JobMetadata } from './jdExtractor';
export type {
    NormalizedField,
    NormalizedQuestion,
    FieldInputType,
    FieldLocator,
} from './fieldDetector';

export type ParsedPageModel = ReturnType<typeof parseCurrentPage>;

export function parseCurrentPage() {
    const classification = classifyPage();
    const reducedRegions = reduceDom();
    const jobDescription = extractJobDescription(reducedRegions);
    const metadata = extractJobMetadata(jobDescription);
    const normalized = collectNormalizedFields();

    return {
        url: window.location.href,
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
