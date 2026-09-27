import { describe, expect, test } from 'bun:test';
import { billingProvider, checkoutAvailable, razorpayConfigured, stripeCheckoutReady } from './provider';

describe('billing provider seam', () => {
    test('nothing configured (production, 27 Sep 2026): no provider, no checkout', () => {
        expect(billingProvider({})).toBeNull();
        expect(checkoutAvailable({})).toBe(false);
    });

    test('a Stripe key without the Career price is not a working checkout', () => {
        expect(stripeCheckoutReady({ STRIPE_SECRET_KEY: 'sk' })).toBe(false);
        expect(checkoutAvailable({ STRIPE_SECRET_KEY: 'sk' })).toBe(false);
    });

    test('Stripe key and Career price make checkout available', () => {
        const env = { STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_CAREER_MONTHLY: 'price_1' };
        expect(billingProvider(env)).toBe('stripe');
        expect(checkoutAvailable(env)).toBe(true);
    });

    test('Razorpay keys are recognised but never make buttons live until its checkout ships', () => {
        const env = { RAZORPAY_KEY_ID: 'rzp_test', RAZORPAY_KEY_SECRET: 'secret' };
        expect(razorpayConfigured(env)).toBe(true);
        expect(billingProvider(env)).toBe('razorpay');
        expect(checkoutAvailable(env)).toBe(false);
    });

    test('whitespace-only values do not count', () => {
        expect(billingProvider({ STRIPE_SECRET_KEY: '  ', STRIPE_PRICE_CAREER_MONTHLY: ' ' })).toBeNull();
    });
});
