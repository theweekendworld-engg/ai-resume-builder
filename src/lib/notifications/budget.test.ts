/**
 * The notification budget.
 *
 * Pure, so all of this runs with no database. The cases worth pinning are the
 * ones where the budget interacts with priority — the headroom rule is the
 * only non-obvious thing in the file, and it is the whole reason a product
 * announcement cannot eat the slot a mission nudge needs on Thursday.
 */

import { describe, expect, test } from 'bun:test';

import {
    NOTIFICATION_PRIORITY,
    WEEKLY_NOTIFICATION_BUDGET,
    ceilingFor,
    decideSend,
    isExemptFromBudget,
    priorityOf,
    weekStart,
} from './budget';

describe('exemptions', () => {
    test('transactional mail never consumes budget', () => {
        // Rate-limiting a login link to protect someone from marketing is an
        // outage dressed as a courtesy.
        expect(isExemptFromBudget('transactional')).toBe(true);
        expect(decideSend({ category: 'transactional', spentThisWeek: 99 }).allowed).toBe(true);
    });

    test('everything with an unsubscribe preference competes', () => {
        for (const category of ['weeklyDigest', 'monthlyReview', 'radarDigest', 'missionNudges', 'productUpdates'] as const) {
            expect(isExemptFromBudget(category)).toBe(false);
        }
    });
});

describe('priority order — §7', () => {
    test('mission nudge outranks the log digest, which outranks radar', () => {
        expect(priorityOf('missionNudges')).toBeLessThan(priorityOf('weeklyDigest'));
        expect(priorityOf('weeklyDigest')).toBeLessThan(priorityOf('radarDigest'));
        expect(priorityOf('radarDigest')).toBeLessThan(priorityOf('productUpdates'));
    });

    test('every category is ranked', () => {
        for (const category of ['transactional', 'weeklyDigest', 'monthlyReview', 'radarDigest', 'missionNudges', 'productUpdates'] as const) {
            expect(NOTIFICATION_PRIORITY).toContain(category);
        }
    });
});

describe('the headroom rule', () => {
    test('the top-priority notification may spend the whole budget', () => {
        // A mission nudge on the third message of the week still goes.
        expect(decideSend({ category: 'missionNudges', spentThisWeek: 2 }).allowed).toBe(true);
        expect(decideSend({ category: 'missionNudges', spentThisWeek: 3 }).allowed).toBe(false);
    });

    test('a product announcement will not take the last slot', () => {
        // The decisions are hours apart, so we cannot reorder against a nudge
        // that has not happened yet. Reserving is the only way to say "this
        // one matters less" when you cannot see the week ahead.
        expect(decideSend({ category: 'productUpdates', spentThisWeek: 0 }).allowed).toBe(true);
        expect(decideSend({ category: 'productUpdates', spentThisWeek: 1 }).allowed).toBe(false);
    });

    test('the weekly digest may also spend the whole budget', () => {
        // It is the core ritual. A digest suppressed for being third would be
        // a broken promise, not a courtesy.
        expect(decideSend({ category: 'weeklyDigest', spentThisWeek: 2 }).allowed).toBe(true);
        expect(decideSend({ category: 'weeklyDigest', spentThisWeek: 3 }).allowed).toBe(false);
    });

    test('the monthly ones sit between, and never crowd out a nudge', () => {
        for (const category of ['radarDigest', 'monthlyReview'] as const) {
            expect(decideSend({ category, spentThisWeek: 1 }).allowed).toBe(true);
            expect(decideSend({ category, spentThisWeek: 2 }).allowed).toBe(false);
        }
    });

    test('the ceiling ordering matches the priority ordering', () => {
        // The bug the explicit table replaced: a derived ceiling saturated so
        // that "radar outranks announcements" was true in the ordering and
        // had no effect at all.
        const ranked = NOTIFICATION_PRIORITY.filter((c) => c !== 'transactional');
        const ceilings = ranked.map(ceilingFor);
        for (let i = 1; i < ceilings.length; i += 1) {
            expect(ceilings[i]).toBeLessThanOrEqual(ceilings[i - 1]);
        }
        expect(new Set(ceilings).size).toBeGreaterThan(1);
    });

    test('nothing reserves the entire budget away from itself', () => {
        // Even the lowest-priority category gets one slot in an empty week,
        // or it could never send at all and the preference would be a lie.
        const lowest = NOTIFICATION_PRIORITY[NOTIFICATION_PRIORITY.length - 1];
        expect(decideSend({ category: lowest, spentThisWeek: 0 }).allowed).toBe(true);
    });

    test('an empty week always allows the first message of any category', () => {
        for (const category of NOTIFICATION_PRIORITY) {
            expect(decideSend({ category, spentThisWeek: 0 }).allowed).toBe(true);
        }
    });
});

describe('the realistic week', () => {
    test('digest + radar + nudge all fit; a fourth does not', () => {
        // The exact scenario §7 was written for: three features, three crons,
        // none of them aware of the others.
        let spent = 0;
        const send = (category: Parameters<typeof decideSend>[0]['category']) => {
            const decision = decideSend({ category, spentThisWeek: spent });
            if (decision.allowed) spent += 1;
            return decision.allowed;
        };

        expect(send('missionNudges')).toBe(true);
        expect(send('weeklyDigest')).toBe(true);
        expect(send('radarDigest')).toBe(false); // radar leaves the last slot alone
        expect(send('missionNudges')).toBe(true); // …which the nudge may still use
        expect(send('missionNudges')).toBe(false);
        expect(spent).toBe(WEEKLY_NOTIFICATION_BUDGET);
    });
});

describe('the budget week', () => {
    test('starts on Monday UTC', () => {
        // Matches the weekly digest's own week, so a Friday digest and a
        // Monday nudge cannot be accounted to different weeks in a way that
        // lets four messages through across a weekend.
        expect(weekStart(new Date('2026-08-05T13:00:00Z')).toISOString()).toBe(
            '2026-08-03T00:00:00.000Z',
        );
    });

    test('Monday is its own week start', () => {
        expect(weekStart(new Date('2026-08-03T00:00:01Z')).toISOString()).toBe(
            '2026-08-03T00:00:00.000Z',
        );
    });

    test('Sunday belongs to the week that began six days earlier', () => {
        // The off-by-one that would give someone a fresh budget every Sunday.
        expect(weekStart(new Date('2026-08-09T23:59:59Z')).toISOString()).toBe(
            '2026-08-03T00:00:00.000Z',
        );
    });

    test('handles a month boundary', () => {
        expect(weekStart(new Date('2026-09-02T10:00:00Z')).toISOString()).toBe(
            '2026-08-31T00:00:00.000Z',
        );
    });
});
