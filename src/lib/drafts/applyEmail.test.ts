import { describe, expect, test } from 'bun:test';
import { applyEmailsOf, extractApplyEmails, extractTypedEmail, MAX_APPLY_EMAILS } from './applyEmail';
import type { ScoutSections } from '@/lib/scout/types';

const at = '2026-11-07T10:00:00.000Z';

describe('extractApplyEmails', () => {
    // The post this feature exists for (docs/impl/07-telegram-apply.md §1).
    test('the recruiter post from the brief', () => {
        const post = `Forward Deployed AI Engineer | Claude

We're hiring Forward Deployed Engineers to work hands-on with enterprise customers building on Claude. You'll scope, prototype and ship production agents with their teams.

What you'll do
- Embed with customer engineering teams for 4-8 week engagements
- Build evals, tool integrations and deployment pipelines
- Feed what you learn back to product and research

Bengaluru or remote (IST overlap). 5+ years shipping software, strong Python or TypeScript.

Interested? send resumes to jobs@x.com`;
        expect(extractApplyEmails(post)).toEqual(['jobs@x.com']);
    });

    test('a LinkedIn recruiter post: the CV address, not privacy@ or noreply@', () => {
        const post = `🚀 We're Hiring: Senior Backend Engineer (Go) at Razorpay
📍 Bengaluru | 4-7 yrs | Hybrid

Interested candidates can share their CV at Priya.Sharma@Razorpay.com with the subject "SBE - Go".
For questions about how we handle your data, write to privacy@razorpay.com.
Please do not reply to noreply@razorpay.com.
#hiring #golang #backend`;
        expect(extractApplyEmails(post)).toEqual(['priya.sharma@razorpay.com']);
    });

    test('a careers page read as text: image names, trackers and accommodations are skipped, [at]/[dot] is read', () => {
        const page = `Acme Robotics — Careers
logo@2x.png icon@3x.webp hero@2x.jpg
Staff Platform Engineer, Remote (EU)
How to apply: write to careers [at] acme [dot] io with a short note and your CV.
If you need an accommodation during the process, contact accommodations@acme.io.
Report a vulnerability to security@acme.io.
1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d@o12345.ingest.sentry.io`;
        expect(extractApplyEmails(page)).toEqual(['careers@acme.io']);
    });

    test('an address beside "send your resume" ranks before one that merely appears', () => {
        const post = 'Founded by Asha Rao (asha@startup.in), we build payroll for India. Hiring a founding engineer. Send your resume and GitHub to hiring@startup.in.';
        expect(extractApplyEmails(post)).toEqual(['hiring@startup.in', 'asha@startup.in']);
    });

    test('placeholders and documentation domains are not addresses', () => {
        const post = 'Use the format yourname@example.com in the form. Questions? you@domain.com, name@company.com, firstname.lastname@yourcompany.com';
        expect(extractApplyEmails(post)).toEqual([]);
    });

    test('lowercased, deduped, no trailing punctuation, mailto: links read', () => {
        const post = 'Mail Jobs@X.com or jobs@x.com (JOBS@X.COM). Send CVs to hr@acme.in. <a href="mailto:talent@acme.co.uk">Apply</a>';
        expect(extractApplyEmails(post)).toEqual(['jobs@x.com', 'hr@acme.in', 'talent@acme.co.uk']);
    });

    test('a directory of addresses is capped', () => {
        const text = Array.from({ length: 8 }, (_, i) => `team${String.fromCharCode(97 + i)}@acme.io`).join(' ');
        expect(extractApplyEmails(text)).toHaveLength(MAX_APPLY_EMAILS);
    });

    test('no text, no addresses', () => {
        expect(extractApplyEmails(null)).toEqual([]);
        expect(extractApplyEmails('Apply on our website.')).toEqual([]);
    });
});

describe('extractTypedEmail', () => {
    test('reads the address a user typed, lowercased', () => {
        expect(extractTypedEmail('send it to HR@Acme.in instead')).toBe('hr@acme.in');
        expect(extractTypedEmail('make it shorter')).toBeNull();
    });
});

describe('applyEmailsOf', () => {
    const jd = (extra: Record<string, unknown>) => ({
        status: 'ok' as const, sources: [], finishedAt: at,
        data: {
            role: 'FDE', company: 'X', seniority: '', domain: '', location: null, workMode: 'unknown' as const,
            employmentType: null, compensationText: null, experienceText: null, requirements: [], skills: [], responsibilities: [], applyUrl: null,
            ...extra,
        },
    });
    const ingest = (text: string) => ({
        status: 'ok' as const, sources: [], finishedAt: at,
        data: {
            sourceUrl: null, linkKind: 'text' as const, fetchVia: 'provided_text' as const, title: null, author: null, authorUrl: null,
            companyName: null, location: null, postedAt: null, applicantsText: null, text, truncated: false,
        },
    });

    test('stored addresses win, including an empty list', () => {
        expect(applyEmailsOf({ jd: jd({ applyEmails: ['careers@x.com'] }), ingest: ingest('send to jobs@x.com') } as ScoutSections)).toEqual(['careers@x.com']);
        expect(applyEmailsOf({ jd: jd({ applyEmails: [] }), ingest: ingest('send to jobs@x.com') } as ScoutSections)).toEqual([]);
    });

    test('runs stored before the field, and posts too short for a JD, read the posting text', () => {
        expect(applyEmailsOf({ jd: jd({}), ingest: ingest('Send your CV to jobs@x.com') } as ScoutSections)).toEqual(['jobs@x.com']);
        const short: ScoutSections = {
            jd: { status: 'unavailable', reason: 'too short', sources: [], finishedAt: at },
            ingest: ingest('Hiring an FDE, send CVs to jobs@x.com'),
        } as ScoutSections;
        expect(applyEmailsOf(short)).toEqual(['jobs@x.com']);
        expect(applyEmailsOf({})).toEqual([]);
    });
});
