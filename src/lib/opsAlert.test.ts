import { beforeEach, describe, expect, test } from 'bun:test';

import { claimAlertSlot, resetAlertThrottle } from '@/lib/opsAlert';

describe('operator alert throttle', () => {
    beforeEach(() => resetAlertThrottle());

    test('one alert per key per 15 minutes, so a crash loop sends one message', () => {
        const t0 = 1_000_000;
        expect(claimAlertSlot('job_dead:job_watch', t0)).toBe(true);
        expect(claimAlertSlot('job_dead:job_watch', t0 + 60_000)).toBe(false);
        expect(claimAlertSlot('job_dead:job_watch', t0 + 15 * 60_000)).toBe(true);
    });

    test('different keys do not share a window', () => {
        expect(claimAlertSlot('a', 0)).toBe(true);
        expect(claimAlertSlot('b', 0)).toBe(true);
    });

    test('the key table is bounded', () => {
        for (let i = 0; i < 500; i += 1) claimAlertSlot(`k${i}`, 0);
        // The oldest keys were evicted, so they can alert again.
        expect(claimAlertSlot('k0', 1)).toBe(true);
    });
});
