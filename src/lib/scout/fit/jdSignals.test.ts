import { describe, expect, test } from 'bun:test';
import {
    detectEmploymentType,
    detectSponsorship,
    detectWorkMode,
    extractApplyUrl,
    extractCompensationText,
    extractExperienceText,
    minYearsFrom,
} from './jdSignals';

describe('detectWorkMode', () => {
    test("LinkedIn's workplace label beside the location wins over the body", () => {
        expect(detectWorkMode({ location: 'Bengaluru, Karnataka, India (Hybrid)', text: 'fully remote team culture' })).toBe('hybrid');
        expect(detectWorkMode({ location: 'India (Remote)', text: 'come to our office' })).toBe('remote');
    });

    test('hybrid outranks remote in body text', () => {
        expect(detectWorkMode({ text: 'Remote two days a week, hybrid otherwise.' })).toBe('hybrid');
    });

    test('negated remote reads as onsite', () => {
        expect(detectWorkMode({ text: 'This is not a remote role. You will work from our Pune office.' })).toBe('onsite');
    });

    test('silence is unknown, not a guess', () => {
        expect(detectWorkMode({ text: 'We build payments infrastructure.' })).toBe('unknown');
    });
});

describe('extractCompensationText', () => {
    test('quotes an Indian LPA range exactly', () => {
        expect(extractCompensationText('Compensation: ₹25-40 LPA plus ESOPs')).toBe('₹25-40 LPA');
        expect(extractCompensationText('CTC of 18 LPA for freshers')).toBe('18 LPA');
    });

    test('quotes a dollar range', () => {
        expect(extractCompensationText('The base salary range is $180,000 - $220,000 per year.')).toBe('$180,000 - $220,000 per year');
    });

    test('does not read funding or revenue as pay', () => {
        expect(extractCompensationText('We raised $40M in our Series B and serve 2,000 customers.')).toBeNull();
    });

    test('a bare number with no currency is not pay', () => {
        expect(extractCompensationText('Salary: 25-40, depending on experience')).toBeNull();
    });
});

describe('experience', () => {
    test('quotes the phrase and reads the floor', () => {
        const text = extractExperienceText('You have 3+ years of professional software engineering experience.');
        expect(text).toBe('3+ years');
        expect(minYearsFrom(text)).toBe(3);
        expect(minYearsFrom(extractExperienceText('5-8 years experience'))).toBe(5);
        expect(extractExperienceText('5-8 years experience')).toBe('5-8 years experience');
        expect(extractExperienceText('at least 4 years of experience in Go')).toBe('4 years of experience');
    });

    test('never quotes a dangling "of" (regression: run cmue7pqf7000065wvgw2qkkoe)', () => {
        expect(extractExperienceText('3+ years of non-internship professional software development experience')).toBe('3+ years');
    });
});

describe('employment type, sponsorship, apply url', () => {
    test("LinkedIn's criteria block is read first", () => {
        expect(detectEmploymentType('Seniority level Mid-Senior level Employment type Full-time Job function Engineering')).toBe('Full-time');
        expect(detectEmploymentType('Summer internship for students')).toBe('Internship');
    });

    test('sponsorship stance', () => {
        expect(detectSponsorship('We are unable to sponsor visas for this role.')).toBe('not_offered');
        expect(detectSponsorship('Visa sponsorship is available.')).toBe('offered');
        expect(detectSponsorship('Great team.')).toBe('unstated');
    });

    test('the job link itself is the apply url for a job page', () => {
        expect(extractApplyUrl({ sourceUrl: 'https://www.linkedin.com/jobs/view/123456789', linkKind: 'linkedin_job', text: '' }))
            .toBe('https://www.linkedin.com/jobs/view/123456789');
        expect(extractApplyUrl({ sourceUrl: null, linkKind: 'linkedin_post', text: 'Apply here: https://boards.greenhouse.io/acme/jobs/42.' }))
            .toBe('https://boards.greenhouse.io/acme/jobs/42');
    });
});
