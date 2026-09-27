/**
 * The plan page tells the truth about whether anything can be bought.
 * Production on 27 Sep 2026 had no payment provider: every purchase button
 * rendered silently disabled, and "Add Search" was offered to free users
 * that checkout always rejected.
 */

import { describe, expect, test } from 'bun:test';
import { Tier } from '@prisma/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlanPageData, SubscriptionView } from '@/actions/billing.types';
import { BILLING_UNAVAILABLE_COPY } from '@/lib/billing/provider';
import { PlanScreen } from './PlanScreen';

function data(overrides: Partial<PlanPageData> = {}): PlanPageData {
    return {
        tier: Tier.free,
        planName: 'Free',
        planBlurb: 'Free forever',
        priceLabel: null,
        usage: [],
        career: null,
        search: null,
        enforced: true,
        billingConfigured: false,
        portalAvailable: false,
        downgradeOffer: null,
        refundEligibleUntil: null,
        canAddSearch: false,
        ...overrides,
    };
}

const activeCareer: SubscriptionView = {
    slot: 'career',
    planName: 'Career',
    priceLabel: '$5/month',
    status: 'active',
    currentPeriodEnd: null,
    active: true,
    cancelAtPeriodEnd: false,
    pastDue: false,
} as unknown as SubscriptionView;

describe('PlanScreen', () => {
    test('with no provider it says paid plans open soon and renders no purchase button', () => {
        const html = renderToStaticMarkup(<PlanScreen data={data()} />);
        expect(html).toContain(BILLING_UNAVAILABLE_COPY.replace(/—/g, '—'));
        expect(html).not.toMatch(/Career · \$/);
        expect(html).not.toContain('Add Search');
        expect(html).not.toContain('Update payment and invoices');
    });

    test('with checkout available, a free user sees Career and never Search', () => {
        const html = renderToStaticMarkup(<PlanScreen data={data({ billingConfigured: true })} />);
        expect(html).toMatch(/Career · \$/);
        expect(html).not.toContain('Add Search');
    });

    test('a Career subscriber can add Search and manage billing', () => {
        const html = renderToStaticMarkup(
            <PlanScreen data={data({ billingConfigured: true, canAddSearch: true, portalAvailable: true, career: activeCareer })} />,
        );
        expect(html).toContain('Add Search');
        expect(html).toContain('Update payment and invoices');
    });

    test('the checkout return notice is shown', () => {
        const html = renderToStaticMarkup(<PlanScreen data={data()} checkoutNotice="Checkout cancelled. Nothing was charged." />);
        expect(html).toContain('Checkout cancelled. Nothing was charged.');
    });
});
