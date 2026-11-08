/**
 * What a free account gets, and what happens when it runs out.
 *
 * ── Launch (2026-11-07) ──────────────────────────────────────────────────
 * During the launch every account gets every feature and a monthly allowance
 * (`LAUNCH_ALLOWANCE` in plans.ts, asserted in `plans.test.ts`). The trial
 * shape below is what Free returns to once paid plans do, so its blocks run
 * with `ENTITLEMENT_LAUNCH_OPEN=false`. The cost ceiling is not part of the
 * launch switch: Free's is $5 either way, with a matching token budget.
 *
 * The old shape gave Free a hard zero on most of the product — the cheapest
 * possible way to lose someone, because they never meet the thing they would
 * have paid for. Free is now a trial of the whole product: a few uses of every
 * metered feature, ten tailored resumes, and a window on the two features that
 * are screens rather than runs.
 *
 * Every number is env-tunable. That is the point of the tests below that set
 * environment variables: an operator changing a limit must not be able to
 * change what the limit MEANS.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';

import {
    METERED_ACTIONS,
    costBudgetUsd,
    freeResumeCap,
    freeTrialDays,
    freeTrialUses,
    isTrialLimit,
    meteredLimit,
    tierRequiredForAction,
    tokenBudget,
    type MeteredAction,
} from '@/lib/plans';
import { hasFeatureOrTrial, isTrialGranted, trialWindowFor } from '@/lib/trialWindow';

const ENV_KEYS = [
    'ENTITLEMENT_FREE_TRIAL_USES',
    'ENTITLEMENT_FREE_RESUME_LIFETIME_CAP',
    'ENTITLEMENT_FREE_TRIAL_DAYS',
    'ENTITLEMENT_TOKENS_FREE',
    'ENTITLEMENT_COST_USD_FREE',
    'ENTITLEMENT_LIMIT_FREE_MONTH_IN_REVIEW',
    'ENTITLEMENT_LIMIT_FREE_TAILORED_GENERATION',
];

afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
});

/** The trial packaging, which applies once the launch is switched off. */
function afterTheLaunch(): void {
    beforeAll(() => {
        process.env.ENTITLEMENT_LAUNCH_OPEN = 'false';
    });
    afterAll(() => {
        delete process.env.ENTITLEMENT_LAUNCH_OPEN;
    });
}

/**
 * `win_draft` is the one BUILT metered action that is deliberately not a
 * trial: it is an abuse ceiling on the capture loop, which the product refuses
 * to gate.
 */
const NOT_A_TRIAL: MeteredAction[] = ['win_draft'];

/**
 * No implementation exists behind these, so there is nothing to try. Same list
 * as `NO_FEATURE_YET` in `entitlementWiring.test.ts` — when one of them gets
 * built, it moves out of both.
 */
const UNBUILT: MeteredAction[] = ['auto_apply', 'tier2_grounding', 'radar_refresh'];

describe('free gets a taste of everything that exists (after the launch)', () => {
    afterTheLaunch();
    test.each(
        METERED_ACTIONS.filter((a) => !NOT_A_TRIAL.includes(a) && !UNBUILT.includes(a)),
    )('%s is available on Free', (action) => {
        // A zero here means a free user meets a locked screen instead of the
        // feature, which is what this change exists to end.
        expect(meteredLimit('free', action).limit).toBeGreaterThan(0);
    });

    test.each(UNBUILT)('%s stays closed — there is nothing behind it yet', (action) => {
        // A trial of a feature that does not exist can never be consumed, and
        // it would make `tierRequiredForAction` name Free as a tier that
        // offers the thing.
        expect(meteredLimit('free', action).limit).toBe(0);
        expect(tierRequiredForAction(action)).not.toBe('free');
    });

    test('the capture loop keeps its abuse ceiling, not a trial', () => {
        // Drafting a win is part of the ritual we promise never to gate, so
        // its limit is a rate limit and must not read as an upsell.
        expect(isTrialLimit('free', 'win_draft')).toBe(false);
        expect(meteredLimit('free', 'win_draft').scope).toBe('period');
    });

    test('a trial is lifetime — there is no next month that refills it', () => {
        expect(meteredLimit('free', 'month_in_review').scope).toBe('lifetime');
        expect(meteredLimit('free', 'review_packet').scope).toBe('lifetime');
    });

    test('paid tiers are allowances, never trials', () => {
        for (const action of METERED_ACTIONS) {
            expect(isTrialLimit('always_on', action)).toBe(false);
            expect(isTrialLimit('pro', action)).toBe(false);
        }
    });
});

describe('a trial does not make Free the answer to a paywall (after the launch)', () => {
    afterTheLaunch();
    test.each(['month_in_review', 'review_packet', 'tailored_generation'] as MeteredAction[])(
        '%s still points at a paid plan',
        (action) => {
            // Without the trial skip, `tierRequiredForAction` would find Free
            // first and the paywall would tell an out-of-quota free user that
            // the fix is the plan they are already on.
            expect(tierRequiredForAction(action)).not.toBe('free');
        },
    );

    test('an action Free genuinely owns still resolves to Free', () => {
        expect(tierRequiredForAction('win_draft')).toBe('free');
    });
});

describe('the resume cap (after the launch)', () => {
    afterTheLaunch();
    test('ten, total, not per month', () => {
        const limit = meteredLimit('free', 'tailored_generation');
        expect(limit.limit).toBe(10);
        expect(limit.scope).toBe('lifetime');
    });

    test('the cap is tunable without a deploy', () => {
        process.env.ENTITLEMENT_FREE_RESUME_LIFETIME_CAP = '25';
        expect(freeResumeCap()).toBe(25);
        expect(meteredLimit('free', 'tailored_generation').limit).toBe(25);
    });

    test('raising a limit does not turn a trial into an entitlement', () => {
        // The operator lever changes HOW MUCH of a taste it is. If it also
        // cleared `trial`, the paywall copy would flip to "you've used your
        // allowance" and stop upselling — a config change silently rewriting
        // the product's meaning.
        process.env.ENTITLEMENT_LIMIT_FREE_MONTH_IN_REVIEW = '9';
        const limit = meteredLimit('free', 'month_in_review');
        expect(limit.limit).toBe(9);
        expect(limit.trial).toBe(true);
        expect(tierRequiredForAction('month_in_review')).not.toBe('free');
    });

    test('the per-feature override beats the shared trial number', () => {
        process.env.ENTITLEMENT_FREE_TRIAL_USES = '5';
        process.env.ENTITLEMENT_LIMIT_FREE_MONTH_IN_REVIEW = '1';
        expect(meteredLimit('free', 'review_packet').limit).toBe(5);
        expect(meteredLimit('free', 'month_in_review').limit).toBe(1);
    });
});

describe('the shared trial number (after the launch)', () => {
    afterTheLaunch();
    test('defaults to three', () => {
        expect(freeTrialUses()).toBe(3);
    });

    test('moving it moves every trial at once', () => {
        process.env.ENTITLEMENT_FREE_TRIAL_USES = '4';
        expect(meteredLimit('free', 'month_in_review').limit).toBe(4);
        expect(meteredLimit('free', 'review_packet').limit).toBe(4);
        expect(meteredLimit('free', 'context_interview').limit).toBe(4);
        expect(meteredLimit('free', 'rubric_upload').limit).toBe(4);
        // …and does not open anything unbuilt.
        expect(meteredLimit('free', 'auto_apply').limit).toBe(0);
    });

    test('zero closes the trials without breaking the paywall', () => {
        process.env.ENTITLEMENT_FREE_TRIAL_USES = '0';
        expect(meteredLimit('free', 'month_in_review').limit).toBe(0);
        expect(tierRequiredForAction('month_in_review')).toBe('always_on');
    });
});

describe('the token backstop is per tier', () => {
    test('a paying customer is not held to a free account’s ceiling', () => {
        expect(tokenBudget('pro')).toBeGreaterThan(tokenBudget('always_on'));
        expect(tokenBudget('always_on')).toBeGreaterThan(tokenBudget('free'));
    });

    test('free’s budget comfortably covers its own resume cap', () => {
        // ~30k tokens per tailored generation end to end. If this ever fails,
        // the backstop is tighter than the product limit and users will hit a
        // confusing "token limit reached" instead of an honest paywall.
        expect(tokenBudget('free')).toBeGreaterThan(freeResumeCap() * 30_000);
        // …and the launch allowance, which is ten times the old cap.
        expect(tokenBudget('free')).toBeGreaterThan(meteredLimit('free', 'tailored_generation').limit * 30_000);
    });

    // 2026-11-07: the abuse ceiling moved from $2 / 400k tokens to $5 with a
    // matching token budget (tokens the dollars buy at the measured luna blend,
    // ~3M per $1), so a launch-sized job search fits under it with room.
    test('free is $5 a month, with a token budget matched to it', () => {
        expect(costBudgetUsd('free')).toBe(5);
        expect(tokenBudget('free')).toBe(15_000_000);
        // Matched on every tier, so the cost ceiling is the one that binds.
        expect(tokenBudget('always_on') / costBudgetUsd('always_on')).toBe(tokenBudget('free') / costBudgetUsd('free'));
        expect(tokenBudget('pro') / costBudgetUsd('pro')).toBe(tokenBudget('free') / costBudgetUsd('free'));
    });

    test('both budgets are tunable', () => {
        process.env.ENTITLEMENT_TOKENS_FREE = '123456';
        process.env.ENTITLEMENT_COST_USD_FREE = '7';
        expect(tokenBudget('free')).toBe(123_456);
        expect(costBudgetUsd('free')).toBe(7);
    });

    test('"unlimited" is accepted', () => {
        process.env.ENTITLEMENT_TOKENS_FREE = 'unlimited';
        expect(Number.isFinite(tokenBudget('free'))).toBe(false);
    });
});

describe('the window on the two features that are screens, not runs (after the launch)', () => {
    afterTheLaunch();
    const CREATED = new Date('2026-08-01T00:00:00Z');

    test('a fresh free account sees the whole Radar', () => {
        const window = trialWindowFor(CREATED, new Date('2026-08-05T00:00:00Z'));
        expect(window.active).toBe(true);
        expect(hasFeatureOrTrial('free', 'radar_full', window)).toBe(true);
        expect(isTrialGranted('free', 'radar_full', window)).toBe(true);
    });

    test('and the real readiness verdict', () => {
        const window = trialWindowFor(CREATED, new Date('2026-08-05T00:00:00Z'));
        expect(hasFeatureOrTrial('free', 'rubric_mapping', window)).toBe(true);
    });

    test('after the window it locks', () => {
        const window = trialWindowFor(CREATED, new Date('2026-09-01T00:00:00Z'));
        expect(window.active).toBe(false);
        expect(hasFeatureOrTrial('free', 'radar_full', window)).toBe(false);
    });

    test('a refresh cannot spend it — nothing is counted', () => {
        // The whole reason this is a window and not a counter. Three loads on
        // the same day must leave the trial exactly where it was.
        const at = new Date('2026-08-05T00:00:00Z');
        const first = trialWindowFor(CREATED, at);
        const second = trialWindowFor(CREATED, at);
        const third = trialWindowFor(CREATED, at);
        expect([first.daysLeft, second.daysLeft, third.daysLeft]).toEqual([
            first.daysLeft,
            first.daysLeft,
            first.daysLeft,
        ]);
        expect(first.active).toBe(true);
    });

    test('a subscriber’s access does not expire with the window', () => {
        const window = trialWindowFor(CREATED, new Date('2027-01-01T00:00:00Z'));
        expect(window.active).toBe(false);
        expect(hasFeatureOrTrial('always_on', 'radar_full', window)).toBe(true);
        // …and it is not a trial grant, so no countdown copy is shown.
        expect(isTrialGranted('always_on', 'radar_full', window)).toBe(false);
    });

    test('the window never extends to a feature that is not view-only', () => {
        // `apply_orchestration` is a paid capability, not a screen depth. A
        // trial that silently covered everything would give the product away.
        const window = trialWindowFor(CREATED, new Date('2026-08-05T00:00:00Z'));
        expect(hasFeatureOrTrial('free', 'apply_orchestration', window)).toBe(false);
        expect(hasFeatureOrTrial('free', 'log_history_unlimited', window)).toBe(false);
    });

    test('length is tunable, and zero disables it', () => {
        process.env.ENTITLEMENT_FREE_TRIAL_DAYS = '30';
        expect(freeTrialDays()).toBe(30);
        expect(trialWindowFor(CREATED, new Date('2026-08-20T00:00:00Z')).active).toBe(true);

        process.env.ENTITLEMENT_FREE_TRIAL_DAYS = '0';
        expect(trialWindowFor(CREATED, new Date('2026-08-01T01:00:00Z')).active).toBe(false);
    });

    test('an unknown account age grants nothing rather than everything', () => {
        expect(trialWindowFor(null).active).toBe(false);
    });
});
