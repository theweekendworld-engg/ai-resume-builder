/**
 * The Dodo event → local state table (docs/impl/09-payments-dodo.md §3), as a
 * pure function. The webhook integration test drives the same table through
 * signed deliveries and real rows; this one pins every cell cheaply.
 */

import { describe, expect, test } from 'bun:test';
import { GRACE_PERIOD_DAYS } from '@/lib/entitlements';
import { DODO_SUBSCRIPTION_EVENTS, dodoLocalState } from './dodoSync';

const NOW = new Date('2026-11-08T12:00:00Z');
const NEXT = '2026-12-08T12:00:00Z';
const DAY = 86_400_000;

function sub(overrides: Partial<Parameters<typeof dodoLocalState>[1]> = {}): Parameters<typeof dodoLocalState>[1] {
    return { status: 'active', next_billing_date: NEXT, cancel_at_next_billing_date: false, ...overrides };
}

describe('dodoLocalState', () => {
    test.each(['subscription.active', 'subscription.renewed', 'subscription.plan_changed', 'subscription.updated', 'subscription.unpaused'])(
        '%s with an active subscription is active until next_billing_date',
        (type) => {
            expect(dodoLocalState(type, sub(), NOW, null)).toEqual({ status: 'active', currentPeriodEnd: new Date(NEXT) });
        },
    );

    test('active with cancel_at_next_billing_date is canceling until the period end', () => {
        expect(dodoLocalState('subscription.updated', sub({ cancel_at_next_billing_date: true }), NOW, null)).toEqual({
            status: 'canceling',
            currentPeriodEnd: new Date(NEXT),
        });
    });

    test('past_due uses the provider deadline when it sends one', () => {
        const state = dodoLocalState('subscription.past_due', sub({ status: 'past_due', past_due_ends_at: '2026-11-15T00:00:00Z' }), NOW, null);
        expect(state).toEqual({ status: 'past_due', currentPeriodEnd: new Date('2026-11-15T00:00:00Z') });
    });

    test('on_hold with no deadline opens the 14-day grace, the same as Stripe', () => {
        const state = dodoLocalState('subscription.on_hold', sub({ status: 'on_hold' }), NOW, null);
        expect(state.status).toBe('past_due');
        expect(state.currentPeriodEnd?.getTime()).toBe(NOW.getTime() + GRACE_PERIOD_DAYS * DAY);
    });

    test('a second failure never extends a grace window already parked', () => {
        const parked = new Date(NOW.getTime() + 3 * DAY);
        const state = dodoLocalState('subscription.on_hold', sub({ status: 'on_hold' }), NOW, { status: 'past_due', currentPeriodEnd: parked });
        expect(state).toEqual({ status: 'past_due', currentPeriodEnd: parked });
    });

    test('cancelled while the period is still ahead, at period end, is canceling', () => {
        const state = dodoLocalState('subscription.cancelled', sub({ status: 'cancelled', cancel_at_next_billing_date: true }), NOW, null);
        expect(state).toEqual({ status: 'canceling', currentPeriodEnd: new Date(NEXT) });
    });

    test('cancelled immediately ends access', () => {
        const state = dodoLocalState('subscription.cancelled', sub({ status: 'cancelled', cancelled_at: '2026-11-08T11:00:00Z' }), NOW, null);
        expect(state).toEqual({ status: 'canceled', currentPeriodEnd: new Date('2026-11-08T11:00:00Z') });
    });

    test('cancelled at period end once the period has passed ends access', () => {
        const state = dodoLocalState(
            'subscription.cancelled',
            sub({ status: 'cancelled', cancel_at_next_billing_date: true, next_billing_date: '2026-11-08T11:59:00Z' }),
            NOW,
            null,
        );
        expect(state.status).toBe('canceled');
    });

    test.each(['subscription.failed', 'subscription.expired'])('%s is terminal whatever the payload status says', (type) => {
        expect(dodoLocalState(type, sub({ status: 'active' }), NOW, null)).toEqual({ status: 'canceled', currentPeriodEnd: NOW });
    });

    test('paused grants nothing; pending is incomplete; an unknown status grants nothing', () => {
        expect(dodoLocalState('subscription.paused', sub({ status: 'paused' }), NOW, null).status).toBe('paused');
        expect(dodoLocalState('subscription.updated', sub({ status: 'pending' }), NOW, null).status).toBe('incomplete');
        const unknown = dodoLocalState('subscription.updated', sub({ status: 'mystery' as 'active' }), NOW, null);
        expect(['active', 'trialing', 'canceling', 'past_due']).not.toContain(unknown.status);
    });

    test('every handled event type exists in the SDK union (checked at compile time) and none is duplicated', () => {
        expect(new Set(DODO_SUBSCRIPTION_EVENTS).size).toBe(DODO_SUBSCRIPTION_EVENTS.length);
        expect(DODO_SUBSCRIPTION_EVENTS).toContain('subscription.on_hold');
    });
});
