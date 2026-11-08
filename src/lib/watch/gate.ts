/**
 * The alert gate (PRD 12 §5). Pure.
 *
 * "Only send me jobs I match 85% or more" is a promise about accuracy, so the
 * gate is fail-closed: every condition has to be positively true, and anything
 * unknown resolves to "hold", never to "send". A friend who texts you a job at
 * 6am and is wrong twice stops being read; the cost of a missed match is one
 * job, the cost of a false one is the channel.
 *
 * Eligibility (citizenship, clearance, Public Trust, work authorization) and
 * an unclear region scope on a remote role hold a match whatever its score: those are the two
 * facts no skill outweighs, and "unknown" is never "fine".
 *
 * The number itself is `scoreFit`: 70% requirement coverage (musts weigh 80%)
 * and 30% named-skill overlap, computed by code from line-level evidence. It
 * is the same score Scout shows on a shared link, so a job alerted at 88 opens
 * to a card that says 88.
 */

import { isRemoteScopeCheck, type Coverage } from '@/lib/scout/fit/evaluate';
import type { FitData } from '@/lib/scout/types';

/** The user's bar. Below it nothing is sent, however good the rest looks. */
export const ALERT_MIN_SCORE = 85;

/**
 * Below this many musts there is not enough to judge: a posting that names
 * two requirements scores 100 against almost anyone.
 */
export const ALERT_MIN_MUSTS = 3;

/** Must-have coverage required on top of the score. */
export const ALERT_MIN_MUST_COVERAGE = 0.8;

/** Postings older than this are not news. */
export const ALERT_MAX_AGE_DAYS = 21;

/**
 * How the requirements were matched.
 *   model          the matcher ran and answered
 *   deterministic  nothing needed the model (every requirement resolved by code)
 *   fallback       the model failed and keywords stood in — never alerted
 */
export type MatchedVia = 'model' | 'deterministic' | 'fallback';

export type GateInput = {
    fit: Omit<FitData, 'summary'>;
    coverage: Coverage;
    matchedVia: MatchedVia;
    /** A preference question is open: an unknown that would change the verdict. */
    questionOpen: boolean;
    postedAt: Date | null;
    closed: boolean;
    now: Date;
};

export type GateResult = { qualifies: true } | { qualifies: false; reason: string };

/**
 * Checked in order; the first failure is the reason shown on the match, so
 * the order runs from "fix this in settings" to "it is just not a fit".
 */
export function alertGate(input: GateInput): GateResult {
    const { fit, coverage } = input;
    if (input.closed) return { qualifies: false, reason: 'The posting has closed' };
    if (input.postedAt && input.now.getTime() - input.postedAt.getTime() > ALERT_MAX_AGE_DAYS * 86_400_000) {
        return { qualifies: false, reason: `Posted more than ${ALERT_MAX_AGE_DAYS} days ago` };
    }
    if (input.matchedVia === 'fallback') {
        return { qualifies: false, reason: 'Requirements could not be checked properly tonight; it will be retried' };
    }
    // Who may hold the job comes before anything about the job: citizenship,
    // clearance, Public Trust, work authorization. Anything short of a
    // positive match on the user's own stated authorization holds it.
    const eligibility = fit.preferenceChecks.find((check) => check.key === 'eligibility' && check.status !== 'match');
    if (eligibility) {
        return {
            qualifies: false,
            reason: eligibility.status === 'conflict' ? eligibility.detail : `Eligibility unclear: ${eligibility.detail}`,
        };
    }
    if (input.questionOpen) {
        return { qualifies: false, reason: 'Needs one of your preferences (location, work mode, pay or role) to judge' };
    }
    // A remote role scoped to a region the user may be outside of ("Remote -
    // US" for someone whose places cannot be placed) is held, not sent.
    const whereUnknown = fit.preferenceChecks.find((check) => check.status === 'unknown' && isRemoteScopeCheck(check));
    if (whereUnknown) return { qualifies: false, reason: `Location unclear: ${whereUnknown.detail}` };
    const conflict = fit.preferenceChecks.find((check) => check.status === 'conflict');
    if (conflict) return { qualifies: false, reason: conflict.detail };
    if (fit.score === null) return { qualifies: false, reason: 'Not enough in your record to score this' };
    if (coverage.mustTotal < ALERT_MIN_MUSTS) {
        return { qualifies: false, reason: 'The posting lists too few requirements to judge a match' };
    }
    if (fit.score < ALERT_MIN_SCORE) return { qualifies: false, reason: `Scored ${fit.score}, below your ${ALERT_MIN_SCORE}` };
    if (fit.verdict !== 'strong') return { qualifies: false, reason: `Verdict is ${fit.verdict.replace(/_/g, ' ')}, not strong` };
    if (coverage.mustRatio !== null && coverage.mustRatio < ALERT_MIN_MUST_COVERAGE) {
        return { qualifies: false, reason: `Evidence for ${coverage.mustCovered} of ${coverage.mustTotal} must-haves` };
    }
    const blocking = fit.gaps.find((gap) => gap.severity === 'blocking');
    if (blocking) return { qualifies: false, reason: `No evidence for: "${blocking.text}"` };
    return { qualifies: true };
}
