import {
    clamp,
    getElementPath,
    getKeywordHits,
    getTextSample,
    getViewportBias,
    isElementVisible,
    POSITIVE_JD_KEYWORDS,
    readText,
} from './utils';

export type RegionKind = 'dialog' | 'form' | 'main' | 'sidebar' | 'section';

export type ReducedRegion = {
    id: string;
    kind: RegionKind;
    element: HTMLElement;
    elementPath: string;
    textSample: string;
    visibleTextLength: number;
    interactiveCount: number;
    score: number;
};

function inferRegionKind(element: unknown): RegionKind {
    if (!(element instanceof HTMLElement)) return 'section';
    if (element.matches('dialog, [role="dialog"], [aria-modal="true"]')) return 'dialog';
    if (element.matches('form')) return 'form';
    if (element.matches('main, [role="main"], article')) return 'main';
    if (element.matches('aside, nav')) return 'sidebar';
    return 'section';
}

function scoreRegion(
    element: HTMLElement,
    kind: RegionKind,
    text: string,
    interactiveCount: number
): number {
    const textLength = text.length;
    const keywordHits = getKeywordHits(text, POSITIVE_JD_KEYWORDS);
    const viewportBias = getViewportBias(element);
    const kindBoost =
        kind === 'dialog'
            ? 0.32
            : kind === 'form'
              ? 0.28
              : kind === 'main'
                ? 0.22
                : kind === 'section'
                  ? 0.12
                  : 0;

    const score =
        Math.min(textLength / 6000, 0.34) +
        Math.min(interactiveCount / 20, 0.24) +
        Math.min(keywordHits / 6, 0.2) +
        viewportBias * 0.12 +
        kindBoost;

    return clamp(score, 0, 1);
}

function collectCandidateRoots(): HTMLElement[] {
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

    const candidates: HTMLElement[] = [];
    for (const selector of selectors) {
        for (const element of Array.from(document.querySelectorAll(selector))) {
            if (!(element instanceof HTMLElement) || !isElementVisible(element)) continue;
            candidates.push(element);
        }
    }

    const largestColumn = Array.from(document.querySelectorAll('div'))
        .filter((el) => isElementVisible(el))
        .sort((left, right) => {
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
        })[0];

    if (largestColumn) {
        candidates.push(largestColumn);
    }

    if (document.body instanceof HTMLElement) {
        candidates.push(document.body);
    }

    return Array.from(new Set(candidates));
}

export function reduceDom(): ReducedRegion[] {
    const rawRoots = collectCandidateRoots();
    const regions: ReducedRegion[] = rawRoots
        .map((element, index): ReducedRegion => {
            const kind = inferRegionKind(element);
            const text = readText(element);
            const interactiveCount = Array.from(
                element.querySelectorAll('input, textarea, select, button, [role="button"]')
            ).filter(isElementVisible).length;

            return {
                id: `region-${index + 1}`,
                kind,
                element,
                elementPath: getElementPath(element),
                textSample: getTextSample(element, 280),
                visibleTextLength: text.length,
                interactiveCount,
                score: scoreRegion(element, kind, text, interactiveCount),
            };
        })
        .filter((region) => region.visibleTextLength > 0 || region.interactiveCount > 0);

    regions.sort((left, right) => right.score - left.score);

    const deduped: ReducedRegion[] = [];
    for (const region of regions) {
        const isNestedDuplicate = deduped.some((existing) => {
            if (!(existing.element instanceof HTMLElement) || !(region.element instanceof HTMLElement))
                return false;
            const sameKind = existing.kind === region.kind;
            const overlaps =
                existing.element.contains(region.element) || region.element.contains(existing.element);
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
