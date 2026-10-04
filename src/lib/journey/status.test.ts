import { describe, expect, test } from 'bun:test';
import { nextStatusFor } from './status';

describe('nextStatusFor', () => {
    test('an email moves a job forward', () => {
        expect(nextStatusFor('application_received', 'analyzed')).toBe('applied');
        expect(nextStatusFor('interview_request', 'applied')).toBe('interview');
        expect(nextStatusFor('offer', 'interview')).toBe('offer');
        expect(nextStatusFor('assessment', 'applied')).toBe('in_review');
    });

    test('never backwards: a late confirmation leaves an interviewing job alone', () => {
        expect(nextStatusFor('application_received', 'interview')).toBeNull();
        expect(nextStatusFor('assessment', 'interview')).toBeNull();
        expect(nextStatusFor('interview_request', 'interview')).toBeNull();
    });

    test('a rejection closes any open job, but never an offer, and nothing reopens a closed one', () => {
        expect(nextStatusFor('rejection', 'interview')).toBe('rejected');
        expect(nextStatusFor('rejection', 'applied')).toBe('rejected');
        expect(nextStatusFor('rejection', 'offer')).toBeNull();
        expect(nextStatusFor('interview_request', 'rejected')).toBeNull();
        expect(nextStatusFor('offer', 'archived')).toBeNull();
    });

    test('outreach and unrelated mail move nothing', () => {
        expect(nextStatusFor('recruiter_outreach', 'discovered')).toBeNull();
        expect(nextStatusFor('not_job', 'applied')).toBeNull();
    });
});
