/**
 * The job page as a first-time user sees it (QA 2026-11-07, findings 4, 5,
 * 7 and 10): eligibility leads the fit card, the fit is shown before (never
 * instead of) the pay question, a posting with an apply address offers the
 * email, and a job uses the width in two columns.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { installClerkMock } from '@/__mocks__/clerk';
import type { ApplyEmailState } from '@/actions/drafts';
import type { FitData, ScoutRunView } from '@/lib/scout/types';
import type { StoredSection } from '@/lib/agent/run';

installClerkMock();
const { ApplyEmailPanel, ATTACH_NOTE, MESSAGE_NOTE } = await import('./ApplyEmailPanel');
const { EntitlementNotice } = await import('./EntitlementNotice');
const { FitBody, SectionCard } = await import('./SectionCards');
const { QuestionCard } = await import('./QuestionCard');
const { ScoutRunScreen, followUpOf } = await import('./ScoutRunScreen');

const AT = '2026-11-07T10:00:00.000Z';
const ELIGIBILITY = 'You may not be eligible: requires HHS Public Trust, which generally needs US citizenship or residency. Your profile puts you in Bengaluru, India.';

function fit(overrides: Partial<FitData> = {}): FitData {
    return {
        score: 74,
        verdict: 'not_a_fit',
        matched: [{ requirementId: 'r3', text: 'Client-facing delivery', evidence: 'Delivered client-facing deployments', strength: 'direct' }],
        gaps: [{ requirementId: 'r1', text: '3+ years in engineering', severity: 'minor' }],
        preferenceChecks: [
            { key: 'eligibility', status: 'conflict', detail: ELIGIBILITY },
            { key: 'seniority', status: 'conflict', detail: 'Asks for 3+ years; you have about 2 years full-time (plus internships)' },
            { key: 'location', status: 'conflict', detail: 'Remote within the US (DMV preferred); you are based in Bengaluru, India' },
        ],
        notFitReasons: [ELIGIBILITY, 'Remote within the US (DMV preferred); you are based in Bengaluru, India'],
        summary: 'Forward Deployed AI Engineer does not look like a fit.',
        softRequirements: [],
        ...overrides,
    };
}

const ok = <T,>(data: T): StoredSection<T> => ({ status: 'ok', data, sources: [], finishedAt: AT });

function view(overrides: Partial<ScoutRunView> = {}): ScoutRunView {
    return {
        id: 'run_1',
        status: 'succeeded',
        kind: 'job_posting',
        input: { text: 'post', source: 'dashboard' },
        channel: 'web',
        sections: {},
        plan: ['ingest', 'classify', 'jd', 'fit', 'company', 'comp', 'interviews', 'network', 'talent', 'track'],
        pendingQuestion: null,
        drafts: [],
        headline: 'Forward Deployed AI Engineer · Not a fit (74)',
        createdAt: AT,
        finishedAt: AT,
        error: null,
        ...overrides,
    };
}

const PAY = { id: 'pref.minComp', step: 'fit', prompt: 'This posting states $90/hr. What is the lowest compensation you would take?' };

describe('the fit card', () => {
    test('eligibility leads, prominently, and is not repeated in the reasons', () => {
        const html = renderToStaticMarkup(<FitBody data={fit()} />);
        expect(html).toContain('You may not be eligible');
        expect(html).toContain('Requires HHS Public Trust, which generally needs US citizenship or residency');
        expect(html.indexOf('You may not be eligible')).toBeLessThan(html.indexOf('Not a fit'));
        expect(html.split('HHS Public Trust').length - 1).toBe(1);
        expect(html).toContain('Remote within the US (DMV preferred); you are based in Bengaluru, India');
        expect(html).toContain('about 2 years full-time (plus internships)');
    });

    test('while a blocking question is open the computed fit is still shown, not "Waiting on your answer"', () => {
        const section: StoredSection<FitData> = { status: 'needs_input', question: { id: 'pref.relocate', step: 'fit', prompt: 'Would you relocate?' }, data: fit({ verdict: 'possible', preferenceChecks: [], notFitReasons: [] }), finishedAt: AT };
        const html = renderToStaticMarkup(<SectionCard name="fit" sections={{ fit: section }} live={false} onDraft={() => {}} pendingDraftKey={null} draftsDisabled={false} />);
        expect(html).toContain('Possible fit');
        expect(html).toContain('Client-facing delivery');
        expect(html).toContain('One answer below can change this');
        expect(html).not.toContain('Waiting on your answer above');
    });
});

describe('the pay question is a follow-up', () => {
    test('a finished run with an unanswered follow-up shows the fit first, then the question', () => {
        const run = view({ sections: { fit: ok(fit({ verdict: 'strong', preferenceChecks: [], notFitReasons: [], followUp: PAY })) } });
        expect(followUpOf(run)?.id).toBe('pref.minComp');
        const html = renderToStaticMarkup(<ScoutRunScreen initialRun={run} initialSteps={[]} />);
        expect(html).toContain('Strong fit');
        expect(html.indexOf('Strong fit')).toBeLessThan(html.indexOf(PAY.prompt));
        expect(html).toContain('data-variant="followUp"');
    });

    test('no follow-up while the run is still updating', () => {
        expect(followUpOf(view({ status: 'running', sections: { fit: ok(fit({ followUp: PAY })) } }))).toBeNull();
    });

    test('the follow-up card says it is optional', () => {
        const html = renderToStaticMarkup(<QuestionCard question={PAY} variant="followUp" pending={false} error={null} onAnswer={() => {}} />);
        expect(html).toContain('Optional. Your fit above stands');
    });
});

describe('layout', () => {
    test('a job uses two columns on wide screens: job and fit left, company and people right', () => {
        const html = renderToStaticMarkup(<ScoutRunScreen initialRun={view({ sections: { fit: ok(fit()) } })} initialSteps={[]} />);
        expect(html).toContain('lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]');
        expect(html).toContain('max-w-6xl');
        expect(html.indexOf('Your fit')).toBeLessThan(html.indexOf('The company'));
    });

    test('anything else keeps one reading column', () => {
        const html = renderToStaticMarkup(<ScoutRunScreen initialRun={view({ kind: 'knowledge', plan: ['ingest', 'classify', 'digest'] })} initialSteps={[]} />);
        expect(html).toContain('max-w-[760px]');
        expect(html).not.toContain('lg:grid-cols-');
    });
});

describe('apply by email', () => {
    const empty: ApplyEmailState = { applyEmails: ['jobs@iserveworld.com', 'chris.d@iserveworld.com'], versions: [], messageVersions: [], applyUrl: null, applied: false, attachment: null };

    test('before a draft: one primary action naming the posting\'s address', () => {
        const html = renderToStaticMarkup(<ApplyEmailPanel runId="run_1" initial={empty} />);
        expect(html).toContain('Email jobs@iserveworld.com');
        expect(html).toContain(ATTACH_NOTE);
        expect(html).toContain('No tailored resume for this job yet');
    });

    test('with versions: To, Subject, Body, compose links, Shorter, Stronger, the edit box and v1/v2', () => {
        const version = (n: number, body: string) => ({
            id: `d${n}`, version: n, runId: 'run_1', workspaceId: 'ws', format: 'email' as const, target: 'recruiter' as const,
            toEmail: 'jobs@iserveworld.com', subject: 'Application: Forward Deployed AI Engineer', body, createdAt: AT,
            parentId: n === 1 ? null : `d${n - 1}`, instruction: null,
            links: { gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=jobs%40iserveworld.com&body=v${n}`, mailto: `mailto:jobs@iserveworld.com?body=v${n}` },
        });
        const state: ApplyEmailState = {
            ...empty,
            versions: [version(1, 'First body'), version(2, 'Second body')],
            attachment: { resumeId: 'res_1', title: 'FDE — iServeWorld', pdfUrl: '/api/pdfs/pdf_1', editorUrl: '/editor/res_1' },
        };
        const html = renderToStaticMarkup(<ApplyEmailPanel runId="run_1" initial={state} />);
        expect(html).toContain('jobs@iserveworld.com');
        expect(html).toContain('Application: Forward Deployed AI Engineer');
        expect(html).toContain('Second body');
        expect(html).not.toContain('First body');
        expect(html).toContain('href="https://mail.google.com/mail/?view=cm&amp;fs=1&amp;to=jobs%40iserveworld.com&amp;body=v2"');
        expect(html).toContain('href="mailto:jobs@iserveworld.com?body=v2"');
        for (const label of ['Open in Gmail', 'Mail app', 'Shorter', 'Stronger', 'Tell me what to change', '>v1<', '>v2<']) expect(html).toContain(label);
        expect(html).toContain('href="/api/pdfs/pdf_1"');
        expect(html).toContain('The posting also lists chris.d@iserveworld.com');
    });

    test('no address and no draft: nothing to show', () => {
        expect(renderToStaticMarkup(<ApplyEmailPanel runId="run_1" initial={{ ...empty, applyEmails: [] }} />)).toBe('');
    });

    test('no address: the chain\'s LinkedIn message, with Copy and Open the application instead of Gmail', () => {
        const message = {
            id: 'm1', version: 1, runId: 'run_1', workspaceId: 'ws', format: 'linkedin_message' as const, target: 'recruiter' as const,
            toEmail: null, subject: null, body: 'Hi, I applied for the Forward Deployed AI Engineer role.', createdAt: AT,
            parentId: null, instruction: null, links: { gmail: null, mailto: null },
        };
        const html = renderToStaticMarkup(<ApplyEmailPanel runId="run_1" initial={{
            ...empty, applyEmails: [], messageVersions: [message], applyUrl: 'https://jobs.globex.example/apply/42',
        }} />);
        expect(html).toContain('Apply with a LinkedIn message');
        expect(html).toContain('Hi, I applied for the Forward Deployed AI Engineer role.');
        expect(html).toContain('href="https://jobs.globex.example/apply/42"');
        for (const label of ['Open the application', 'Copy', 'Mark as applied', 'Shorter', 'Stronger', MESSAGE_NOTE]) expect(html).toContain(label);
        expect(html).not.toContain('Open in Gmail');
        expect(html).not.toContain('Mail app');
    });

    test('an applied job says so instead of offering Mark as applied', () => {
        const version = {
            id: 'd1', version: 1, runId: 'run_1', workspaceId: 'ws', format: 'email' as const, target: 'recruiter' as const,
            toEmail: 'jobs@iserveworld.com', subject: 'Application', body: 'Body', createdAt: AT, parentId: null, instruction: null,
            links: { gmail: 'https://mail.google.com/mail/?view=cm', mailto: 'mailto:jobs@iserveworld.com' },
        };
        const html = renderToStaticMarkup(<ApplyEmailPanel runId="run_1" initial={{ ...empty, versions: [version], applied: true }} />);
        expect(html).toContain('Applied');
        expect(html).not.toContain('Mark as applied');
    });
});

describe('refusals during the launch', () => {
    test('no lock and no "See plans" while every feature is open', () => {
        const html = renderToStaticMarkup(<EntitlementNotice message="You've reached this month's limit for AI features." entitlement launchOpen />);
        expect(html).not.toContain('See plans');
        expect(html).toContain("reached this month");
        expect(renderToStaticMarkup(<EntitlementNotice message="Needs Career." entitlement launchOpen={false} />)).toContain('See plans');
    });
});
