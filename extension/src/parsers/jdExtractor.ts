import {
    clamp,
    collectJsonLdObjects,
    confidenceBand,
    dedupeLines,
    getElementPath,
    getKeywordHits,
    isElementVisible,
    NEGATIVE_JD_KEYWORDS,
    normalizeWhitespace,
    POSITIVE_JD_KEYWORDS,
    readText,
    type ConfidenceBand,
} from './utils';
import type { ReducedRegion } from './domReducer';

export type JobDescriptionExtraction = {
    text: string;
    confidenceScore: number;
    confidenceBand: ConfidenceBand;
    sourceHint?: string;
};

export type JobMetadata = {
    companyName?: string;
    roleTitle?: string;
    location?: string;
    compensationText?: string;
    workplaceType: 'hybrid' | 'remote' | 'onsite' | 'unknown';
};

type TitleCandidate = {
    text: string;
    score: number;
    element: HTMLElement;
};

function pickTitleCandidate(): TitleCandidate | null {
    const headings = Array.from(document.querySelectorAll('h1, h2'))
        .filter(isElementVisible)
        .map((node): TitleCandidate => ({
            text: readText(node),
            score: node.tagName.toLowerCase() === 'h1' ? 1 : 0.75,
            element: node as HTMLElement,
        }))
        .filter((candidate) => candidate.text && candidate.text.length <= 140);

    headings.sort((left, right) => right.score - left.score);
    return headings[0] ?? null;
}

function pickCompanyCandidate(titleElement: HTMLElement | null | undefined): string {
    if (!(titleElement instanceof HTMLElement)) return '';

    const nearby = Array.from(
        titleElement.parentElement?.querySelectorAll('h2, h3, p, span, a, div') ?? []
    )
        .filter((element): element is HTMLElement =>
            element instanceof HTMLElement && isElementVisible(element)
        )
        .map((element) => readText(element))
        .filter((text) => text && text.length <= 120 && text !== readText(titleElement))
        .filter((text) => !/(responsibilities|requirements|qualifications|apply|share)/i.test(text));

    const titleText = readText(titleElement);
    const splitFromDocumentTitle = document.title
        .split(/[\-|@|,]/g)
        .map((part) => normalizeWhitespace(part))
        .find((part) => part && part !== titleText && part.length <= 80);

    return nearby[0] || splitFromDocumentTitle || '';
}

function pickLocationCandidate(titleElement: HTMLElement | null | undefined): string {
    const scope = titleElement?.parentElement || document.body;
    const nodes = Array.from(scope.querySelectorAll('p, span, div, li'))
        .filter((element): element is HTMLElement =>
            element instanceof HTMLElement && isElementVisible(element)
        )
        .map((element) => readText(element))
        .filter(Boolean);

    return (
        nodes.find((text) => {
            if (text.length > 120) return false;
            return /(remote|hybrid|onsite|on-site|\b[a-z]+,\s?[a-z]{2}\b|\b[a-z]+,\s?[a-z]+\b)/i.test(
                text
            );
        }) || ''
    );
}

function inferWorkplaceType(
    locationText: string,
    descriptionText: string
): JobMetadata['workplaceType'] {
    const text = `${locationText} ${descriptionText}`.toLowerCase();
    if (text.includes('hybrid')) return 'hybrid';
    if (text.includes('remote')) return 'remote';
    if (text.includes('onsite') || text.includes('on-site')) return 'onsite';
    return 'unknown';
}

function pickCompensation(text: string): string {
    const matches = text.match(
        /([$€£]\s?\d[\d,]*(?:\s?[-to]{1,3}\s?[$€£]?\d[\d,]*)?(?:\s?\/\s?(?:year|yr|hour|hr))?)/i
    );
    return matches?.[0] || '';
}

function scoreJdCandidate(region: ReducedRegion, titleElementPath: string): number {
    const text = readText(region.element);
    const textLengthScore = Math.min(text.length / 7000, 0.35);
    const keywordScore = Math.min(getKeywordHits(text, POSITIVE_JD_KEYWORDS) / 6, 0.27);
    const negativePenalty = Math.min(getKeywordHits(text, NEGATIVE_JD_KEYWORDS) / 6, 0.2);
    const listDensity = Math.min(region.element.querySelectorAll('li').length / 20, 0.12);
    const linkPenalty = Math.min(region.element.querySelectorAll('a').length / 30, 0.12);
    const headingBoost = region.elementPath.includes(titleElementPath) ? 0.08 : 0;
    const regionBoost = region.kind === 'main' ? 0.12 : region.kind === 'section' ? 0.08 : 0.04;

    return clamp(
        textLengthScore +
            keywordScore +
            listDensity +
            headingBoost +
            regionBoost -
            negativePenalty -
            linkPenalty,
        0,
        1
    );
}

function cleanJobDescription(text: string): string {
    const lines = String(text || '')
        .split(/\n+/)
        .map((line) => normalizeWhitespace(line))
        .filter(Boolean)
        .filter((line) => !/^(apply|share|save|report this job|sign in|follow company)$/i.test(line));

    return dedupeLines(lines.join('\n')).slice(0, 100000).trim();
}

export function extractJobDescription(
    reducedRegions: ReducedRegion[]
): JobDescriptionExtraction | null {
    const titleCandidate = pickTitleCandidate();
    const titlePath = titleCandidate?.element ? getElementPath(titleCandidate.element) : '';
    const scoredRegions = reducedRegions
        .map((region) => ({
            region,
            text: readText(region.element),
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
        combinedText = cleanJobDescription(
            scoredRegions
                .slice(0, 3)
                .map((entry) => entry.text)
                .join('\n\n')
        );
        sourceHint = scoredRegions
            .slice(0, 3)
            .map((entry) => entry.region.id)
            .join(', ');
        score = scoredRegions.length > 0 ? scoredRegions[0].score * 0.75 : 0.1;
    }

    if (!combinedText) return null;

    return {
        text: combinedText,
        confidenceScore: clamp(score, 0, 1),
        confidenceBand: confidenceBand(score),
        sourceHint: sourceHint || undefined,
    };
}

type JsonLdJobPosting = {
    '@type'?: string;
    title?: string;
    hiringOrganization?: { name?: string };
    organization?: { name?: string };
    jobLocation?: {
        address?: { addressLocality?: string; addressRegion?: string };
    };
};

export function extractJobMetadata(
    jobDescription: JobDescriptionExtraction | null
): JobMetadata {
    const titleCandidate = pickTitleCandidate();
    const roleTitle = titleCandidate?.text || '';
    const companyName = pickCompanyCandidate(titleCandidate?.element);
    const location = pickLocationCandidate(titleCandidate?.element);
    const jsonLdObjects = collectJsonLdObjects() as JsonLdJobPosting[];
    const jobPosting = jsonLdObjects.find(
        (entry) => String(entry?.['@type'] || '').toLowerCase() === 'jobposting'
    );
    const descriptionText = jobDescription?.text || '';

    const companyFromJsonLd = normalizeWhitespace(
        jobPosting?.hiringOrganization?.name || jobPosting?.organization?.name || ''
    );
    const locationFromJsonLd = normalizeWhitespace(
        jobPosting?.jobLocation?.address?.addressLocality ||
            jobPosting?.jobLocation?.address?.addressRegion ||
            ''
    );

    return {
        companyName: companyName || companyFromJsonLd || undefined,
        roleTitle: roleTitle || normalizeWhitespace(jobPosting?.title || '') || undefined,
        location: location || locationFromJsonLd || undefined,
        compensationText:
            pickCompensation(`${descriptionText} ${readText(document.body).slice(0, 5000)}`) ||
            undefined,
        workplaceType: inferWorkplaceType(location || locationFromJsonLd, descriptionText),
    };
}
