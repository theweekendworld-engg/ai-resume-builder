import { describe, expect, test } from 'bun:test';
import { buildQuestionFingerprint } from './questionIdentity';

describe('buildQuestionFingerprint', () => {
  test('stays stable when helper text is missing for general questions', () => {
    const fromSuggest = buildQuestionFingerprint({
      questionText: 'Why are you a fit for this role?',
      helperText: ['Focus on backend systems and ownership.'],
      type: 'why_role',
    });

    const fromSave = buildQuestionFingerprint({
      questionText: 'Why are you a fit for this role?',
      type: 'why_role',
    });

    expect(fromSuggest).toBe(fromSave);
  });

  test('keeps eligibility subtypes grounded in helper text when needed', () => {
    const sponsorship = buildQuestionFingerprint({
      questionText: 'Are you legally authorized to work in the United States?',
      helperText: ['Please mention whether you require visa sponsorship.'],
      type: 'eligibility',
    });

    expect(sponsorship).toBe('eligibility:sponsorship');
  });

  test('distinguishes compensation questions by subtype', () => {
    const noticePeriod = buildQuestionFingerprint({
      questionText: 'When can you start?',
      helperText: ['Tell us your notice period.'],
      type: 'compensation',
    });

    expect(noticePeriod).toBe('compensation:notice_period');
  });
});
