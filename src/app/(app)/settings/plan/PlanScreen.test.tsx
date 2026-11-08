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
        adminCheckoutPreview: false,
        checkoutTestMode: false,
        portalAvailable: false,
        downgradeOffer: null,
        refundEligibleUntil: null,
        canAddSearch: false,
        // The paid-plan behaviour below is what returns after the launch.
        launchOpen: false,
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
    test('with no provider it says nothing can be bought yet and renders no purchase button', () => {
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

    // Launch (2026-11-07): everything is included and nothing can be bought, so
    // the page says that and shows no paid columns, prices or "Change plan".
    test('during the launch it says free with every feature, and shows no prices', () => {
        const html = renderToStaticMarkup(<PlanScreen data={data({ launchOpen: true })} />);
        expect(html).toContain('Free while we launch');
        expect(html).toContain(BILLING_UNAVAILABLE_COPY);
        expect(html).not.toContain('Change plan');
        expect(html).not.toMatch(/\$\d+\/month/);
        expect(html).not.toMatch(/open soon/i);
        // The 90-day hidden-history line is not true during the launch.
        expect(html).not.toContain('hidden on Free');
    });

    // Dodo, 2026-11-08: the owner tests a real (test-mode) purchase while the
    // launch is still open for everyone else.
    test('an admin during the launch sees the paid plans with a banner saying nobody else does', () => {
        const html = renderToStaticMarkup(
            <PlanScreen data={data({ launchOpen: true, billingConfigured: true, adminCheckoutPreview: true, checkoutTestMode: true })} />,
        );
        expect(html).toContain('Admin preview');
        expect(html).toContain('Test mode: no real card is charged');
        expect(html).toMatch(/Career · \$/);
        expect(html).toContain('Free while we launch');
    });

    test('the admin banner warns when checkout is live', () => {
        const html = renderToStaticMarkup(
            <PlanScreen data={data({ launchOpen: true, billingConfigured: true, adminCheckoutPreview: true, checkoutTestMode: false })} />,
        );
        expect(html).toContain('Live mode: a real card will be charged.');
    });

    test('a member during the launch never sees the admin banner or a purchase button', () => {
        const html = renderToStaticMarkup(<PlanScreen data={data({ launchOpen: true, billingConfigured: false })} />);
        expect(html).not.toContain('Admin preview');
        expect(html).not.toMatch(/Career · \$/);
    });

    test('the checkout return notice is shown', () => {
        const html = renderToStaticMarkup(<PlanScreen data={data()} checkoutNotice="Checkout cancelled. Nothing was charged." />);
        expect(html).toContain('Checkout cancelled. Nothing was charged.');
    });
});
