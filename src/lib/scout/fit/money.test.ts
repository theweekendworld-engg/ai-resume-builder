import { describe, expect, test } from 'bun:test';
import { comparePay, parseMoney } from './money';

describe('parseMoney', () => {
    test('Indian formats', () => {
        expect(parseMoney('₹25-40 LPA')).toEqual({ currency: 'INR', min: 2_500_000, max: 4_000_000, period: 'year' });
        expect(parseMoney('INR 30,00,000')).toEqual({ currency: 'INR', min: 3_000_000, max: 3_000_000, period: 'year' });
        expect(parseMoney('40 lakhs')).toEqual({ currency: 'INR', min: 4_000_000, max: 4_000_000, period: 'year' });
        expect(parseMoney('1.2 Cr')).toMatchObject({ currency: 'INR', min: 12_000_000 });
    });

    test('dollar formats', () => {
        expect(parseMoney('$180k - $220k')).toEqual({ currency: 'USD', min: 180_000, max: 220_000, period: 'year' });
        expect(parseMoney('$60/hour')).toEqual({ currency: 'USD', min: 60, max: 60, period: 'hour' });
    });

    test('refuses what it cannot read without guessing', () => {
        expect(parseMoney('₹40')).toBeNull(); // forty rupees, or forty lakh?
        expect(parseMoney('competitive')).toBeNull();
        expect(parseMoney('25-40')).toBeNull();
    });
});

describe('comparePay', () => {
    test('meets when the top of the range reaches the floor', () => {
        expect(comparePay(parseMoney('₹25-40 LPA'), parseMoney('₹35 LPA'))).toBe('meets');
        expect(comparePay(parseMoney('₹15-20 LPA'), parseMoney('₹35 LPA'))).toBe('below');
    });

    test('never converts currencies or periods', () => {
        expect(comparePay(parseMoney('$180k'), parseMoney('₹40 LPA'))).toBe('incomparable');
        expect(comparePay(parseMoney('$60/hour'), parseMoney('$150k'))).toBe('incomparable');
    });
});
