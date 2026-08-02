/**
 * Role normalisation.
 *
 * The regression these tests lock in was found by running real boards, not by
 * reasoning: defaulting an unrecognised seniority to "mid" swept Directors and
 * Engineering Managers into the mid-level IC bucket and published a
 * "Mid · Software Engineering" median ABOVE the Senior one. Every title below
 * marked "real" is one that actually caused it.
 */

import { describe, expect, test } from 'bun:test';
import { classifyFamily, classifySeniority, isBandableSeniority, normalizeRole } from './role';
import type { RoleFamily, Seniority } from './role';

describe('seniority — the management/IC split', () => {
    test.each([
        // Real titles from Databricks that broke the naive version.
        ['Director of Engineering', 'director_plus'],
        ['Director, Field Engineering - Financial Services', 'director_plus'],
        ['Engineering Manager - Backend', 'manager'],
        ['Engineering Manager, Serverless Compute Platform', 'manager'],
        ['VP of Product', 'director_plus'],
        ['Head of Design', 'director_plus'],
    ] as ReadonlyArray<readonly [string, Seniority]>)('%s -> %s', (title, expected) => {
        expect(classifySeniority(title)).toBe(expected);
    });

    test('"Engineering Manager" is management, not an engineer', () => {
        // The substring "Engineer" must not win over the word "Manager".
        expect(classifySeniority('Engineering Manager - Compute Infra')).toBe('manager');
    });

    test('"Director of Product" is management, not product IC', () => {
        expect(classifySeniority('Director of Product')).toBe('director_plus');
    });

    test('a Product Manager manages a product, not people', () => {
        // "Manager" names the craft here. Treating it as a people ladder puts
        // PMs on the wrong pay curve entirely.
        expect(classifySeniority('Product Manager, Payments')).not.toBe('manager');
        expect(classifySeniority('Senior Program Manager')).toBe('senior');
        expect(classifySeniority('Technical Program Manager')).not.toBe('manager');
    });

    test('an explicit rank still wins inside an IC manager title', () => {
        // The case that caught the ordering bug.
        expect(classifySeniority('Associate Product Manager')).toBe('junior');
        expect(classifySeniority('Senior Product Manager')).toBe('senior');
    });
});

describe('seniority — IC ladder', () => {
    test.each([
        ['Staff Software Engineer', 'staff_plus'],
        ['Principal Engineer, Platform', 'staff_plus'],
        ['Senior Backend Engineer', 'senior'],
        ['Sr. Data Scientist', 'senior'],
        ['Junior Frontend Engineer', 'junior'],
        ['Associate Product Manager', 'junior'],
        ['Software Engineering Intern', 'intern'],
        ['Mid-Level Software Engineer', 'mid'],
    ] as ReadonlyArray<readonly [string, Seniority]>)('%s -> %s', (title, expected) => {
        expect(classifySeniority(title)).toBe(expected);
    });
});

describe('seniority — the regression itself', () => {
    test('an unmarked title is unknown, NEVER mid', () => {
        // This single assertion is the whole point of the module.
        expect(classifySeniority('Software Engineer')).toBe('unknown');
        expect(classifySeniority('AI Engineer - FDE (Forward Deployed Engineer)')).toBe('unknown');
    });

    test('unknown is excluded from bands', () => {
        expect(isBandableSeniority('unknown')).toBe(false);
    });

    test('intern is excluded from bands — different pay instrument', () => {
        expect(isBandableSeniority('intern')).toBe(false);
    });

    test('every classified non-intern seniority is bandable', () => {
        (['junior', 'mid', 'senior', 'staff_plus', 'manager', 'director_plus'] as const).forEach((s) => {
            expect(isBandableSeniority(s)).toBe(true);
        });
    });
});

describe('family', () => {
    test.each([
        ['Senior Backend Engineer', 'software_engineering'],
        ['Machine Learning Engineer', 'data_ml'],
        ['Data Scientist, Growth', 'data_ml'],
        ['Product Manager, Payments', 'product'],
        ['Staff Product Designer', 'design'],
        ['Account Executive, Enterprise', 'sales'],
    ] as ReadonlyArray<readonly [string, RoleFamily]>)('%s -> %s', (title, expected) => {
        expect(classifyFamily(title)).toBe(expected);
    });

    test('ML engineer is data_ml, not generic software engineering', () => {
        // Ordering matters: the SWE pattern also matches "Engineer".
        expect(classifyFamily('Machine Learning Engineer, Inference')).toBe('data_ml');
    });

    test('an unrecognisable family is unknown', () => {
        expect(classifyFamily('Warehouse Associate')).toBe('unknown');
    });
});

describe('normalizeRole — the band key', () => {
    test('a fully classified posting gets a stable key', () => {
        const r = normalizeRole('Senior Backend Engineer', 'us_remote');
        expect(r.bandKey).toBe('software_engineering::senior::us_remote');
    });

    test('the same title and geo always produce the same key', () => {
        expect(normalizeRole('Staff Software Engineer', 'nyc').bandKey)
            .toBe(normalizeRole('Staff Software Engineer', 'nyc').bandKey);
    });

    test('an unknown seniority yields no key, so it cannot enter a band', () => {
        expect(normalizeRole('Software Engineer', 'us_remote').bandKey).toBeNull();
    });

    test('an unknown family yields no key', () => {
        expect(normalizeRole('Senior Warehouse Associate', 'us_remote').bandKey).toBeNull();
    });

    test('a missing geo yields no key — a band is always geo-scoped', () => {
        expect(normalizeRole('Senior Backend Engineer', '').bandKey).toBeNull();
    });

    test('managers and ICs of the same family land in different cells', () => {
        const ic = normalizeRole('Senior Software Engineer', 'nyc').bandKey;
        const mgr = normalizeRole('Engineering Manager, Backend', 'nyc').bandKey;
        expect(ic).not.toBe(mgr);
    });
});
