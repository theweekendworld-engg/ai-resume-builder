import { describe, expect, test } from 'bun:test';
import { computeTenure, describeFullTime, describeMonths, isInternshipRole, parseRoleDate, type DatedRole } from './tenure';

const NOW = new Date('2026-11-07T10:00:00Z');

/** The record from QA 2026-11-07: two internships, then two full-time roles back to back. */
const OBSERVED: DatedRole[] = [
    { company: 'Swachh.io', role: 'SDE Intern', startDate: 'May 2023', endDate: 'Jul 2023', current: false },
    { company: '2Sigma School', role: 'SDE Intern', startDate: 'Mar 2024', endDate: 'May 2024', current: false },
    { company: 'Hyperbots', role: 'Software Engineer I', startDate: 'Jun 2024', endDate: 'Aug 2025', current: false },
    { company: 'Plivo', role: 'Software Engineer I', startDate: 'Sep 2025', endDate: '', current: true },
];

describe('parseRoleDate', () => {
    test('the formats profiles and imports actually hold', () => {
        expect(parseRoleDate('Jun 2024', 'start')).toEqual({ year: 2024, month: 5 });
        expect(parseRoleDate('Sept 2025', 'start')).toEqual({ year: 2025, month: 8 });
        expect(parseRoleDate('June 2024', 'start')).toEqual({ year: 2024, month: 5 });
        expect(parseRoleDate('2021-06', 'start')).toEqual({ year: 2021, month: 5 });
        expect(parseRoleDate('06/2021', 'start')).toEqual({ year: 2021, month: 5 });
        expect(parseRoleDate("Mar '24", 'start')).toEqual({ year: 2024, month: 2 });
        expect(parseRoleDate('Present', 'end')).toBe('present');
        expect(parseRoleDate('', 'end')).toBeNull();
        expect(parseRoleDate('soon', 'end')).toBeNull();
    });

    test('a bare year is read from mid-year, so it overstates neither way by more than six months', () => {
        expect(parseRoleDate('2019', 'start')).toEqual({ year: 2019, month: 6 });
        expect(parseRoleDate('2021', 'end')).toEqual({ year: 2021, month: 5 });
    });
});

describe('isInternshipRole', () => {
    test.each(['SDE Intern', 'Software Engineering Internship', 'Graduate Trainee', 'Co-op Software Developer', 'Apprentice Engineer', 'Summer Analyst'])(
        '"%s" is not full-time experience',
        (role) => expect(isInternshipRole({ role, company: 'Acme' })).toBe(true),
    );
    test.each(['Software Engineer I', 'International Sales Lead', 'Internal Tools Engineer', 'Senior Engineer'])(
        '"%s" is',
        (role) => expect(isInternshipRole({ role, company: 'Acme' })).toBe(false),
    );
    test('the company line can say it too', () => {
        expect(isInternshipRole({ role: 'Software Engineer', company: 'Google (Internship)' })).toBe(true);
    });
});

describe('computeTenure', () => {
    test('the QA record: about two years full-time, internships counted apart', () => {
        const tenure = computeTenure(OBSERVED, NOW);
        // Jun 2024–Aug 2025 is 15 months; Sep 2025 to 7 Nov 2026 is just over 14.
        expect(tenure.fullTimeMonths!).toBeGreaterThan(29);
        expect(tenure.fullTimeMonths!).toBeLessThan(30);
        expect(tenure.internshipMonths).toBeCloseTo(6, 0);
        expect(describeFullTime(tenure.fullTimeMonths!, tenure.internshipMonths)).toBe('about 2 years full-time (plus internships)');
        expect(tenure.spans['Software Engineer I at Hyperbots']).toMatchObject({ internship: false, current: false });
        expect(tenure.spans['Software Engineer I at Hyperbots'].months).toBeCloseTo(15, 0);
        expect(tenure.spans['Software Engineer I at Plivo'].current).toBe(true);
        expect(tenure.spans['SDE Intern at Swachh.io'].internship).toBe(true);
    });

    test('overlapping roles are merged, not double-counted', () => {
        const tenure = computeTenure([
            { company: 'A', role: 'Engineer', startDate: 'Jan 2022', endDate: 'Dec 2023', current: false },
            { company: 'B', role: 'Contract Engineer', startDate: 'Jun 2023', endDate: 'Dec 2024', current: false },
        ], NOW);
        expect(tenure.fullTimeMonths!).toBeCloseTo(36, 0);
    });

    test('a past role with no end date ends where the next one starts', () => {
        const tenure = computeTenure([
            { company: 'A', role: 'Engineer', startDate: 'Jan 2020', endDate: '', current: false },
            { company: 'B', role: 'Engineer', startDate: 'Jan 2022', endDate: '', current: true },
        ], NOW);
        expect(tenure.spans['Engineer at A'].months).toBeCloseTo(24, 0);
        // Jan 2020–Jan 2022, then Jan 2022 to 7 Nov 2026.
        expect(tenure.fullTimeMonths!).toBeCloseTo(82.2, 0);
    });

    test('internships only: no full-time experience, and it says so', () => {
        const tenure = computeTenure(OBSERVED.slice(0, 2), NOW);
        expect(tenure.fullTimeMonths).toBe(0);
        expect(describeFullTime(tenure.fullTimeMonths!, tenure.internshipMonths)).toBe('no full-time experience yet (internships only)');
    });

    test('no usable dates at all is unknown, not zero', () => {
        expect(computeTenure([{ company: 'A', role: 'Engineer', startDate: '', endDate: '', current: true }], NOW).fullTimeMonths).toBeNull();
        expect(computeTenure([], NOW).fullTimeMonths).toBeNull();
    });
});

describe('describeMonths', () => {
    test('rounds down to the half year: the words never claim more than the dates', () => {
        expect(describeMonths(29.2)).toBe('about 2 years');
        expect(describeMonths(30)).toBe('about 2.5 years');
        expect(describeMonths(35.9)).toBe('about 2.5 years');
        expect(describeMonths(12)).toBe('about 1 year');
        expect(describeMonths(8.7)).toBe('about 8 months');
        expect(describeMonths(0.4)).toBe('less than a month');
    });
});
