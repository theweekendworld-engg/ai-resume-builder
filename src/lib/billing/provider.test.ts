import { describe, expect, test } from 'bun:test';
import {
    billingProvider,
    checkoutAvailable,
    dodoApiKey,
    dodoConfigured,
    dodoEnvironment,
    dodoKeyConfigured,
    dodoMissingEnv,
    razorpayConfigured,
    stripeCheckoutReady,
} from './provider';

const DODO = {
    DODO_PAYMENTS_API_KEY: 'dodo_test_key',
    DODO_PAYMENTS_WEBHOOK_KEY: 'whsec_x',
    DODO_PRODUCT_CAREER: 'pdt_career',
    DODO_PRODUCT_SEARCH: 'pdt_search',
};
const STRIPE = { STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_CAREER_MONTHLY: 'price_1' };

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

    // Dodo Payments (owner decision 2026-11-08) is the chosen provider.
    test('a full Dodo configuration is the provider, and wins over Stripe', () => {
        expect(billingProvider(DODO)).toBe('dodo');
        expect(checkoutAvailable(DODO)).toBe(true);
        expect(billingProvider({ ...STRIPE, ...DODO })).toBe('dodo');
        expect(billingProvider(STRIPE)).toBe('stripe');
    });

    test('half a Dodo configuration never makes buttons live, and names what is missing', () => {
        const noWebhook = { ...DODO, DODO_PAYMENTS_WEBHOOK_KEY: '' };
        expect(dodoConfigured(noWebhook)).toBe(false);
        expect(billingProvider(noWebhook)).toBeNull();
        expect(checkoutAvailable(noWebhook)).toBe(false);
        expect(dodoMissingEnv({ DODO_PAYMENTS_API_KEY: 'k' })).toEqual([
            'DODO_PAYMENTS_WEBHOOK_KEY',
            'DODO_PRODUCT_CAREER',
            'DODO_PRODUCT_SEARCH',
        ]);
        // The key alone still manages an existing subscription.
        expect(dodoKeyConfigured({ DODO_PAYMENTS_API_KEY: 'k' })).toBe(true);
    });

    test('test mode unless live_mode is named exactly (the SDK itself defaults to live)', () => {
        expect(dodoEnvironment({})).toBe('test_mode');
        expect(dodoEnvironment({ DODO_PAYMENTS_ENVIRONMENT: 'live' })).toBe('test_mode');
        expect(dodoEnvironment({ DODO_PAYMENTS_ENVIRONMENT: 'LIVE_MODE' })).toBe('test_mode');
        expect(dodoEnvironment({ DODO_PAYMENTS_ENVIRONMENT: ' live_mode ' })).toBe('live_mode');
    });

    test("the owner's test-key name is a fallback in test mode only", () => {
        const env = { ...DODO, DODO_PAYMENTS_API_KEY: '', DODO_PAYMENT_TEST_API_KEY: 'test_key' };
        expect(dodoApiKey(env)).toBe('test_key');
        expect(dodoConfigured(env)).toBe(true);
        expect(dodoApiKey({ ...env, DODO_PAYMENTS_ENVIRONMENT: 'live_mode' })).toBeUndefined();
        expect(billingProvider({ ...env, DODO_PAYMENTS_ENVIRONMENT: 'live_mode' })).toBeNull();
        // The primary name wins when both are set.
        expect(dodoApiKey({ ...env, DODO_PAYMENTS_API_KEY: 'primary' })).toBe('primary');
    });
});
