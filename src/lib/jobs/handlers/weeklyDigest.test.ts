/**
 * The weekly digest's decision logic, tested without a database.
 *
 * Everything the handler decides — who might be due, whether the frequency
 * guardrails allow a send, whether this is the third quiet week, what the
 * subject line says — is a pure function, so all of it is testable here and the
 * integration suite is left to prove only the things that need Postgres.
 */

import { describe, expect, test } from 'bun:test';
import {
    BIWEEKLY_GAP_DAYS,
    MIN_DIGEST_GAP_DAYS,
    UNOPENED_BEFORE_DEGRADE,
    candidateDigestDays,
    decideFrequency,
    describeWinProvenance,
    digestDedupeKey,
    digestDispatchDedupeKey,
    formatDateRange,
    formatSendDate,
    hourKey,
    isUnopened,
    nudgeIsDue,
    preDigestSyncDedupeKey,
    quietWeekCount,
    shouldDegradeToBiweekly,
    unopenedStreak,
    type DigestHistoryRow,
} from './weeklyDigest';
import {
    digestFooterSummary,
    digestPreheader,
    digestSubject,
    digestInlineKeyboard,
    itemMarker,
    parseDigestCallbackData,
    renderTelegramDigest,
    type TelegramDigestView,
} from '@/lib/email/templates/weeklyDigest';
import { WinSource } from '@prisma/client';

const DAY = 86_400_000;

function row(overrides: Partial<DigestHistoryRow> = {}): DigestHistoryRow {
    return {
        weekStart: new Date('2026-07-27T00:00:00Z'),
        sentAt: new Date('2026-07-31T16:00:00Z'),
        openedAt: null,
        firstActionAt: null,
        skipped: false,
        ...overrides,
    };
}

// ───────────────────────────────────────────────────────── who might be due

describe('candidateDigestDays', () => {
    test('returns yesterday, today and tomorrow in ISO weekday terms', () => {
        // 2026-07-31 is a Friday → ISO 5.
        expect(candidateDigestDays(new Date('2026-07-31T12:00:00Z'))).toEqual([4, 5, 6]);
    });

    test('wraps across the week boundary in both directions', () => {
        // Monday → Sun, Mon, Tue.
        expect(candidateDigestDays(new Date('2026-08-03T00:30:00Z'))).toEqual([7, 1, 2]);
        // Sunday → Sat, Sun, Mon.
        expect(candidateDigestDays(new Date('2026-08-02T23:30:00Z'))).toEqual([6, 7, 1]);
    });

    test('three days is enough to cover every real timezone offset', () => {
        // −12:00 through +14:00 can only ever shift the local day by one.
        for (let hour = 0; hour < 24; hour += 1) {
            const now = new Date(Date.UTC(2026, 6, 31, hour));
            expect(new Set(candidateDigestDays(now)).size).toBe(3);
        }
    });
});

// ───────────────────────────────────────────────────────── engagement

describe('unopened streak', () => {
    test('an opened digest counts as engagement', () => {
        expect(isUnopened(row({ openedAt: new Date() }))).toBe(false);
    });

    test('so does an action, even with no open recorded', () => {
        // Images-off clients never fire the open pixel. A click is the stronger
        // signal and must not be thrown away.
        expect(isUnopened(row({ firstActionAt: new Date() }))).toBe(false);
    });

    test('a skipped week is transparent — it sent nothing, so it proves nothing', () => {
        const history = [row(), row({ sentAt: null, skipped: true }), row(), row(), row()];
        expect(unopenedStreak(history)).toBe(4);
    });

    test('the streak stops at the most recent engaged digest', () => {
        const history = [row(), row(), row({ openedAt: new Date() }), row(), row()];
        expect(unopenedStreak(history)).toBe(2);
    });

    test(`degrades at exactly ${UNOPENED_BEFORE_DEGRADE}, not before`, () => {
        expect(shouldDegradeToBiweekly([row(), row(), row()])).toBe(false);
        expect(shouldDegradeToBiweekly([row(), row(), row(), row()])).toBe(true);
    });

    test('one open puts the user straight back on weekly', () => {
        const history = [row({ openedAt: new Date() }), row(), row(), row(), row()];
        expect(shouldDegradeToBiweekly(history)).toBe(false);
    });
});

// ───────────────────────────────────────────────────────── frequency

describe('decideFrequency', () => {
    const now = new Date('2026-07-31T16:00:00Z');
    const ago = (days: number): Date => new Date(now.getTime() - days * DAY);

    test('a first-ever digest sends', () => {
        expect(decideFrequency([], now)).toEqual({ send: true });
    });

    test(`never more than one digest per ${MIN_DIGEST_GAP_DAYS} days`, () => {
        expect(decideFrequency([row({ sentAt: ago(5) })], now)).toEqual({ send: false, reason: 'too_soon' });
        expect(decideFrequency([row({ sentAt: ago(7), openedAt: ago(7) })], now).send).toBe(true);
    });

    test('skipped weeks do not count as a recent send', () => {
        const history = [row({ sentAt: null, skipped: true }), row({ sentAt: ago(14), openedAt: ago(14) })];
        expect(decideFrequency(history, now).send).toBe(true);
    });

    test('four unopened digests pause the next weekly slot', () => {
        const history = [row({ sentAt: ago(7) }), row({ sentAt: ago(14) }), row({ sentAt: ago(21) }), row({ sentAt: ago(28) })];
        expect(decideFrequency(history, now)).toEqual({ send: false, reason: 'biweekly_pause' });
    });

    test(`and send again after ${BIWEEKLY_GAP_DAYS} days, with a note that says so`, () => {
        const history = [row({ sentAt: ago(14) }), row({ sentAt: ago(21) }), row({ sentAt: ago(28) }), row({ sentAt: ago(35) })];
        const decision = decideFrequency(history, now);
        expect(decision.send).toBe(true);
        // PRD 01 §5.2: auto-degrade beats unsubscribe, but only if we say so.
        expect(decision.send && decision.cadenceNote).toContain('every other week');
    });
});

// ───────────────────────────────────────────────────────── quiet weeks

describe('quiet weeks', () => {
    const quiet = (): DigestHistoryRow => row({ sentAt: null, skipped: true });
    const nudged = (): DigestHistoryRow => row({ skipped: true, sentAt: new Date() });

    test('counts the current week', () => {
        expect(quietWeekCount([])).toBe(1);
    });

    test('nudges on the third consecutive empty week, not the first or second', () => {
        expect(nudgeIsDue([])).toBe(false);
        expect(nudgeIsDue([quiet()])).toBe(false);
        expect(nudgeIsDue([quiet(), quiet()])).toBe(true);
    });

    test('a real digest resets the run', () => {
        expect(quietWeekCount([quiet(), quiet(), row(), quiet(), quiet()])).toBe(3);
        expect(quietWeekCount([row(), quiet(), quiet()])).toBe(1);
    });

    test('a nudge restarts the counter, so it fires every three weeks and not weekly', () => {
        expect(quietWeekCount([nudged(), quiet(), quiet()])).toBe(1);
        expect(quietWeekCount([quiet(), nudged(), quiet()])).toBe(2);
        expect(nudgeIsDue([quiet(), nudged()])).toBe(false);
        expect(nudgeIsDue([quiet(), quiet(), nudged()])).toBe(true);
    });
});

// ───────────────────────────────────────────────────────── dedupe keys

describe('dedupe keys', () => {
    test('the send key is per user per week', () => {
        const week = new Date('2026-07-27T00:00:00Z');
        expect(digestDedupeKey('u1', week)).toBe(digestDedupeKey('u1', week));
        expect(digestDedupeKey('u1', week)).not.toBe(digestDedupeKey('u2', week));
        expect(digestDedupeKey('u1', week)).not.toBe(digestDedupeKey('u1', new Date('2026-08-03T00:00:00Z')));
    });

    test('the dispatch keys are per hour, so a cron firing twice in an hour is a no-op', () => {
        const a = new Date('2026-07-31T16:04:00Z');
        const b = new Date('2026-07-31T16:59:59Z');
        const c = new Date('2026-07-31T17:00:00Z');
        expect(hourKey(a)).toBe('2026-07-31T16');
        expect(digestDispatchDedupeKey(a)).toBe(digestDispatchDedupeKey(b));
        expect(digestDispatchDedupeKey(a)).not.toBe(digestDispatchDedupeKey(c));
        expect(preDigestSyncDedupeKey(a)).toBe(preDigestSyncDedupeKey(b));
    });

    test('the digest and pre-sync keys cannot collide', () => {
        const now = new Date('2026-07-31T16:00:00Z');
        expect(digestDispatchDedupeKey(now)).not.toBe(preDigestSyncDedupeKey(now));
    });
});

// ───────────────────────────────────────────────────────── copy

describe('copy', () => {
    test('the subject is the count and nothing else (design/02 §K1)', () => {
        expect(digestSubject(3)).toBe('3 things you did this week');
        expect(digestSubject(1)).toBe('1 thing you did this week');
        expect(digestSubject(5)).not.toContain('digest');
    });

    test('the preheader is the 20-second promise plus the date', () => {
        expect(digestPreheader('Friday, Jul 31')).toBe('Confirm in 20 seconds — Friday, Jul 31');
        expect(digestPreheader('')).toBe('Confirm in 20 seconds');
    });

    test('the footer summary drops the streak at zero and pluralises', () => {
        expect(digestFooterSummary(14, 6)).toBe('14 wins logged · 6 weeks running');
        expect(digestFooterSummary(1, 1)).toBe('1 win logged · 1 week running');
        expect(digestFooterSummary(3, 0)).toBe('3 wins logged');
    });

    test('date ranges collapse a shared month and keep both when it changes', () => {
        expect(formatDateRange(new Date('2026-07-25T00:00:00Z'), new Date('2026-07-31T00:00:00Z'), 'Etc/UTC')).toBe(
            'Jul 25 – 31',
        );
        expect(formatDateRange(new Date('2026-07-27T00:00:00Z'), new Date('2026-08-02T00:00:00Z'), 'Etc/UTC')).toBe(
            'Jul 27 – Aug 2',
        );
    });

    test('the send date renders in the user timezone, including +05:30', () => {
        // 16:00 UTC on Friday is already Saturday 01:30 in Tokyo.
        expect(formatSendDate(new Date('2026-07-31T16:30:00Z'), 'Asia/Tokyo')).toBe('Saturday, Aug 1');
        expect(formatSendDate(new Date('2026-07-31T10:30:00Z'), 'Asia/Kolkata')).toBe('Friday, Jul 31');
    });

    test('markers are the §K1 glyphs, then a fallback', () => {
        expect(itemMarker(0)).toBe('①');
        expect(itemMarker(4)).toBe('⑤');
        expect(itemMarker(5)).toBe('6.');
    });
});

describe('describeWinProvenance', () => {
    test('renders a GitHub PR as "PR #482 · owner/repo"', () => {
        expect(
            describeWinProvenance({
                source: WinSource.github,
                sourceRef: 'https://github.com/patronus/api/pull/482',
            }),
        ).toBe('PR #482 · patronus/api');
    });

    test('is null for a Win with no addressable source', () => {
        expect(describeWinProvenance({ source: WinSource.manual, sourceRef: null })).toBeNull();
        expect(describeWinProvenance({ source: WinSource.manual, sourceRef: '   ' })).toBeNull();
        expect(describeWinProvenance({ source: WinSource.manual, sourceRef: 'win:abc' })).toBeNull();
    });
});

// ───────────────────────────────────────────────────────── telegram

describe('telegram callbacks', () => {
    test('round-trip through the 64-byte callback_data budget', () => {
        const digestId = 'clw1n0a2b0000x3f8h7k9q1z4';
        const keyboard = digestInlineKeyboard(view(3), digestId);
        for (const row of keyboard.inline_keyboard) {
            for (const button of row) {
                expect(Buffer.byteLength(button.callback_data, 'utf8')).toBeLessThanOrEqual(64);
                expect(parseDigestCallbackData(button.callback_data)?.digestId).toBe(digestId);
            }
        }
    });

    test('rejects anything that is not ours, including injection attempts', () => {
        expect(parseDigestCallbackData(undefined)).toBeNull();
        expect(parseDigestCallbackData('gen:123')).toBeNull();
        expect(parseDigestCallbackData('d:x0:abc')).toBeNull();
        expect(parseDigestCallbackData("d:c0:abc' OR 1=1")).toBeNull();
        expect(parseDigestCallbackData('d:c0:')).toBeNull();
    });

    test('actioned items lose their button and gain a glyph', () => {
        const v = view(2);
        v.items[0].state = 'confirmed';
        const text = renderTelegramDigest(v);
        expect(text).toContain('① ✓ Win one');
        expect(text).toContain('② *Win two*');
        expect(digestInlineKeyboard(v, 'dig1').inline_keyboard).toHaveLength(1);
    });

    test('every button gone once the week is cleared', () => {
        const v = view(2);
        v.items.forEach((item) => {
            item.state = 'dismissed';
        });
        expect(digestInlineKeyboard(v, 'dig1').inline_keyboard).toHaveLength(0);
    });
});

function view(count: number): TelegramDigestView {
    return {
        headline: digestSubject(count),
        items: Array.from({ length: count }, (_, index) => ({
            winId: `win_${index}`,
            title: `Win ${['one', 'two', 'three', 'four', 'five'][index]}`,
            narrative: 'Some narrative.',
            provenance: 'PR #1 · a/b',
            state: 'draft' as const,
        })),
        overflow: 0,
        footer: digestFooterSummary(count, 1),
    };
}
