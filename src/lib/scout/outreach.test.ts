import { describe, expect, test } from 'bun:test';
import { LINKEDIN_NOTE_MAX } from '@/lib/scout/types';
import {
    EMAIL_BODY_MAX_WORDS,
    EMAIL_SUBJECT_MAX,
    checkDraft,
    enforceLimits,
    selectEvidence,
    trimToSentence,
    trimToWords,
    wordCount,
} from './outreach';

const longNote = 'I built the settlement service at Razorpay in Go on PostgreSQL. '.repeat(8).trim();

describe('checkDraft', () => {
    test('flags a connection note over LinkedIn\'s 300-character cap', () => {
        expect(checkDraft('linkedin_note', { subject: null, body: longNote }).map((v) => v.kind)).toContain('too_long');
        expect(checkDraft('linkedin_note', { subject: null, body: 'Hi, short and specific.' })).toEqual([]);
    });

    test('flags clichés', () => {
        const violations = checkDraft('linkedin_message', { subject: null, body: 'Hi, I hope this finds you well. I am passionate about payments.' });
        expect(violations.filter((v) => v.kind === 'cliche')).toHaveLength(2);
    });

    test('flags long emails and subjects', () => {
        const body = Array.from({ length: EMAIL_BODY_MAX_WORDS + 10 }, () => 'word').join(' ');
        const kinds = checkDraft('email', { subject: 'x'.repeat(EMAIL_SUBJECT_MAX + 1), body }).map((v) => v.kind);
        expect(kinds).toEqual(['too_long', 'subject_too_long']);
    });
});

describe('enforceLimits', () => {
    test('a note ends at or under the cap, on a sentence boundary', () => {
        const { body, subject } = enforceLimits('linkedin_note', { subject: 'ignored', body: longNote });
        expect(body.length).toBeLessThanOrEqual(LINKEDIN_NOTE_MAX);
        expect(body.endsWith('.')).toBe(true);
        expect(subject).toBeNull();
    });

    test('an email keeps its subject and is cut to the word limit', () => {
        const body = Array.from({ length: 200 }, (_, i) => (i % 20 === 19 ? 'end.' : 'word')).join(' ');
        const result = enforceLimits('email', { subject: 'Backend Engineer role at Acme', body });
        expect(wordCount(result.body)).toBeLessThanOrEqual(EMAIL_BODY_MAX_WORDS);
        expect(result.subject).toBe('Backend Engineer role at Acme');
    });

    test('drops a cliché sentence rather than shipping it', () => {
        const { body } = enforceLimits('linkedin_message', {
            subject: null,
            body: 'Hi Priya, I hope this finds you well. I built settlement at Razorpay in Go. Would you refer me for the SDE II role?',
        });
        expect(body.toLowerCase()).not.toContain('finds you well');
        expect(body).toContain('Would you refer me');
    });
});

describe('trimming helpers', () => {
    test('trimToSentence falls back to a word boundary with an ellipsis', () => {
        expect(trimToSentence('one two three four five six', 12)).toBe('one two…');
    });

    test('trimToWords keeps short text as-is', () => {
        expect(trimToWords('a b c', 5)).toBe('a b c');
    });
});

describe('selectEvidence', () => {
    test('puts the lines that overlap the role first', () => {
        const lines = [
            { text: 'Organised the office book club', source: 'x' },
            { text: 'Built the settlement service in Go on PostgreSQL', source: 'Razorpay' },
        ];
        const picked = selectEvidence(lines, {
            role: 'Backend Engineer', company: 'Acme', seniority: '', domain: 'payments', location: null, workMode: 'unknown',
            employmentType: null, compensationText: null, experienceText: null, applyUrl: null,
            requirements: [{ id: 'r1', text: 'Go and PostgreSQL', kind: 'must' }], skills: ['Go', 'PostgreSQL'], responsibilities: [],
        }, 1);
        expect(picked[0].source).toBe('Razorpay');
    });
});
