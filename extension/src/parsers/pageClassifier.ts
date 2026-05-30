import {
    clamp,
    confidenceBand,
    getKeywordHits,
    isElementVisible,
    normalizeToken,
    POSITIVE_JD_KEYWORDS,
    readText,
    type ConfidenceBand,
} from './utils';

export type Platform =
    | 'linkedin'
    | 'greenhouse'
    | 'lever'
    | 'workday'
    | 'indeed'
    | 'wellfound'
    | 'generic';

export type PageKind =
    | 'job_detail'
    | 'application_form'
    | 'multi_step_application'
    | 'auth_gate'
    | 'unsupported'
    | 'unknown';

export type PageClassification = {
    platform: Platform;
    pageKind: PageKind;
    confidenceScore: number;
    confidenceBand: ConfidenceBand;
    reasons: string[];
    counts: {
        visibleInputs: number;
        visibleButtons: number;
        visibleForms: number;
        visibleDialogs: number;
    };
};

export function detectPlatform(): Platform {
    const host = window.location.hostname.toLowerCase();
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('myworkdayjobs.com') || host.includes('workday.com')) return 'workday';
    if (host.includes('indeed.com')) return 'indeed';
    if (host.includes('wellfound.com') || host.includes('angel.co')) return 'wellfound';
    return 'generic';
}

function getVisibleCounts() {
    const inputs = Array.from(document.querySelectorAll('input, textarea, select')).filter(
        isElementVisible
    );
    const buttons = Array.from(
        document.querySelectorAll('button, [role="button"], a')
    ).filter(isElementVisible);
    const forms = Array.from(document.querySelectorAll('form')).filter(isElementVisible);
    const dialogs = Array.from(
        document.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"]')
    ).filter(isElementVisible);

    return { inputs, buttons, forms, dialogs };
}

export function classifyPage(): PageClassification {
    const platform = detectPlatform();
    const counts = getVisibleCounts();
    const bodyText = readText(document.body).slice(0, 12000);
    const normalizedBody = normalizeToken(bodyText);
    const reasons: string[] = [];
    let score = 0.32;
    let pageKind: PageKind = 'unknown';

    const hasApplyCopy = /(easy apply|apply now|submit application|application)/.test(
        normalizedBody
    );
    const hasJobCopy =
        /(job description|responsibilities|qualifications|requirements|about the role|about the job)/.test(
            normalizedBody
        );
    const hasAuthCopy = /(sign in|log in|create account|continue with google)/.test(
        normalizedBody
    );
    const hasStepper = Boolean(
        document.querySelector(
            '[aria-current="step"], [role="progressbar"], ol[aria-label*="step" i], ul[aria-label*="step" i]'
        )
    );
    const easyApplyDialog = document.querySelector(
        '[role="dialog"] [aria-label*="easy apply" i], [role="dialog"] form'
    );

    if (platform === 'linkedin' && easyApplyDialog) {
        pageKind = 'application_form';
        score = 0.96;
        reasons.push('Detected a LinkedIn apply dialog.');
    } else if (
        platform === 'greenhouse' &&
        document.querySelector('#application_form, form#application_form')
    ) {
        pageKind = 'application_form';
        score = 0.95;
        reasons.push('Detected a Greenhouse application form.');
    } else if (platform === 'workday' && hasStepper && counts.inputs.length >= 3) {
        pageKind = 'multi_step_application';
        score = 0.94;
        reasons.push('Detected a Workday multi-step application flow.');
    } else if (
        hasAuthCopy &&
        counts.inputs.length <= 3 &&
        document.querySelector('input[type="password"]')
    ) {
        pageKind = 'auth_gate';
        score = 0.86;
        reasons.push('Detected authentication prompts before application access.');
    } else if ((counts.inputs.length >= 4 || counts.forms.length > 0) && hasApplyCopy) {
        pageKind = hasStepper ? 'multi_step_application' : 'application_form';
        score = hasStepper ? 0.88 : 0.82;
        reasons.push('Detected visible application controls and apply copy.');
    } else if (hasJobCopy) {
        pageKind = 'job_detail';
        score = 0.78;
        reasons.push('Detected job-description language on the page.');
    } else if (
        counts.inputs.length === 0 &&
        getKeywordHits(bodyText, POSITIVE_JD_KEYWORDS) >= 2
    ) {
        pageKind = 'job_detail';
        score = 0.66;
        reasons.push('Detected dense role content without an active form.');
    } else if (document.body.childElementCount < 5) {
        pageKind = 'unsupported';
        score = 0.51;
        reasons.push('Page structure is too thin for reliable parsing.');
    } else {
        reasons.push('Fell back to generic page classification heuristics.');
    }

    return {
        platform,
        pageKind,
        confidenceScore: clamp(score, 0, 1),
        confidenceBand: confidenceBand(score),
        reasons,
        counts: {
            visibleInputs: counts.inputs.length,
            visibleButtons: counts.buttons.length,
            visibleForms: counts.forms.length,
            visibleDialogs: counts.dialogs.length,
        },
    };
}
