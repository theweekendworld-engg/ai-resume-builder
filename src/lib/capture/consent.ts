/**
 * Consent copy — PRD 02 §3.2, design/02 §A2.
 *
 * VERBATIM. This is the spec, not a draft. `CaptureSource.consentCopyVersion`
 * records which of these strings a user agreed to, so we can answer "what
 * exactly did this user consent to, and when" for any row in the table. That is
 * only true if the copy and the version move together — change one word, bump
 * the version, and leave the old entry in `CONSENT_HISTORY`.
 *
 * The three checkmarks carry the whole consent burden and are not collapsible
 * fine print (design/02 §A2).
 */

export const GITHUB_CONSENT_VERSION = 'github-2026-08-01';

export const GITHUB_CONSENT = {
    version: GITHUB_CONSENT_VERSION,
    heading: 'Connect GitHub',
    body: 'We read your merged pull requests and code reviews to draft your weekly wins. We do **not** read your source code, we never write anything to GitHub, and you choose which repos we look at.',
    assurance: 'Everything we pull is shown to you before it becomes part of your record.',
    /** The §A2 rendering of the same promises, as three checkmarks. */
    checkmarks: [
        'We never read your source code',
        'We never write anything to GitHub',
        'You choose which repos we look at',
    ],
    primaryCta: 'Connect with private repos',
    secondaryCta: 'Connect public repos only',
    /** Refusal is not a dead end (§A2). */
    deferCta: "I'll do this later",
} as const;

/** Past versions, kept so an old `consentCopyVersion` is still explainable. */
export const CONSENT_HISTORY: Record<string, { heading: string; body: string }> = {
    [GITHUB_CONSENT_VERSION]: { heading: GITHUB_CONSENT.heading, body: GITHUB_CONSENT.body },
};

// ───────────────────────────────────────────────────── repo picker (§A2b)

export const REPO_PICKER_COPY = {
    heading: 'Which repos should we look at?',
    searchPlaceholder: 'Search repos…',
    hint: "Pre-selected: repos you've contributed to in the last 90 days.",
    cta: 'Start scanning',
    /** Zero selected disables the button with inline text, not a toast (§A2b). */
    emptyError: 'Pick at least one repo — we can’t scan nothing.',
} as const;

// ───────────────────────────────────────────────────── disconnect (§7.2)

/**
 * The disconnect dialog states the data consequence precisely and
 * non-punitively. Both options ship: offering the destructive one is what makes
 * the safe one trustworthy.
 */
export function disconnectCopy(winCount: number): {
    body: string;
    safeCta: string;
    destructiveCta: string;
} {
    const wins = `${winCount} logged win${winCount === 1 ? '' : 's'}`;
    return {
        body: `Disconnecting stops future syncs. Your ${wins} stay yours — they're already part of your record. We'll delete the raw GitHub data we cached (PR titles and descriptions) within 24 hours.`,
        safeCta: 'Disconnect',
        destructiveCta: `Disconnect and delete the ${winCount} win${winCount === 1 ? '' : 's'} too`,
    };
}

// ───────────────────────────────────────────────────── known limits (§11)

/** One source per kind in R1. Say so rather than letting someone discover it. */
export const TWO_ACCOUNTS_LIMIT_COPY =
    'One GitHub account per person for now. If you contribute from a work and a personal account, connect the one with more of your work.';
