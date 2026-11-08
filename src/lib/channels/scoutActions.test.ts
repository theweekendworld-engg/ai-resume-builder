import { describe, expect, test } from 'bun:test';
import { decodeScoutAction, encodeScoutAction, executeScoutAction, renderWhyNotFit, type DraftActionDeps, type ScoutActionDeps } from './scoutActions';
import { renderDraftMessage } from './scoutRender';
import { REVISION_INSTRUCTIONS } from '@/lib/drafts/revisions';
import type { DraftView } from '@/lib/drafts/types';
import { inertInboxDeps, JOB_SECTIONS, RUN_ID, view } from './testViews.test-utils';

describe('wire format', () => {
    test('every action round-trips and fits in Telegram\'s 64 bytes', () => {
        const cases = [
            { kind: 'answer' as const, index: 12, label: '' },
            { kind: 'draft' as const, target: 'h' as const, format: 'e' as const, label: '' },
            { kind: 'why' as const, label: '' },
            { kind: 'refresh' as const, label: '' },
            { kind: 'status' as const, status: 'n' as const, label: '' },
            { kind: 'confirm_win' as const, winId: 'cmwin0000000000000000000abcdefghij', label: '' },
            { kind: 'dismiss_win' as const, winId: 'cmwin0000000000000000000abcdefghij', label: '' },
            { kind: 'revise_draft' as const, draftId: 'cmdraft000000000000000000abcdefghij', revision: 'g' as const, label: '' },
        ];
        for (const action of cases) {
            const data = encodeScoutAction(RUN_ID, action);
            expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
            expect(decodeScoutAction(data)?.kind).toBe(action.kind);
        }
        expect(decodeScoutAction(`sc:d:${RUN_ID}:h:e`)).toEqual({ kind: 'draft', runId: RUN_ID, target: 'hiring_manager', format: 'email' });
        expect(decodeScoutAction(`sc:s:${RUN_ID}:i`)).toEqual({ kind: 'status', runId: RUN_ID, status: 'interviewing' });
        expect(decodeScoutAction('sc:c:cmwin000000000000000000a')).toEqual({ kind: 'confirm_win', winId: 'cmwin000000000000000000a' });
        expect(decodeScoutAction('sc:x:cmwin000000000000000000a')).toEqual({ kind: 'dismiss_win', winId: 'cmwin000000000000000000a' });
        expect(decodeScoutAction('sc:v:cmdraft00000000000000000a:s')).toEqual({ kind: 'revise_draft', draftId: 'cmdraft00000000000000000a', revision: 'shorter' });
    });

    test('an unknown status code or a malformed win id decodes to null', () => {
        for (const data of [`sc:s:${RUN_ID}:z`, `sc:s:${RUN_ID}`, 'sc:c:../x', 'sc:x:', 'sc:c:short', 'sc:v:cmdraft00000000000000000a:x', 'sc:v:cmdraft00000000000000000a', 'sc:v:../x:s']) {
            expect(decodeScoutAction(data)).toBeNull();
        }
    });

    test('garbage and other namespaces decode to null', () => {
        for (const data of ['d:win:1', 'status:abc', 'sc:x:abc', `sc:a:${RUN_ID}:-1`, `sc:d:${RUN_ID}:z:n`, 'sc:a:../../x:0', 'sc:r']) {
            expect(decodeScoutAction(data)).toBeNull();
        }
    });
});

function deps(overrides: Partial<ScoutActionDeps> = {}): ScoutActionDeps & { calls: string[] } {
    const calls: string[] = [];
    const v = view({
        status: 'awaiting_input',
        pendingQuestion: { id: 'q', step: 'fit', prompt: '?', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    });
    return {
        calls,
        getScoutRun: async () => ({ success: true, data: v }),
        answerScoutQuestion: async (_u, _r, value) => {
            calls.push(`answer:${value}`);
            return { success: true, data: v };
        },
        draftScoutOutreach: async (_u, _r, params) => {
            calls.push(`draft:${params.target}:${params.format}`);
            return { success: true, data: { id: 'd', target: params.target, format: params.format, recipientName: null, subject: 'Hi', body: 'Hello\nThere', createdAt: '' } };
        },
        refreshScoutRun: async () => {
            calls.push('refresh');
            return { success: true, data: v };
        },
        ...inertInboxDeps(),
        ...overrides,
    };
}

describe('execution', () => {
    test('an answer button sends the option VALUE, not its label', async () => {
        const d = deps();
        const reply = await executeScoutAction('u', { kind: 'answer', runId: RUN_ID, index: 1 }, d);
        expect(d.calls).toEqual(['answer:no']);
        expect(reply.lines[0][0].text).toContain('No');
    });

    test('a stale answer button does nothing', async () => {
        const d = deps({ getScoutRun: async () => ({ success: true, data: view() }) });
        const reply = await executeScoutAction('u', { kind: 'answer', runId: RUN_ID, index: 0 }, d);
        expect(d.calls).toEqual([]);
        expect(reply.lines[0][0].text).toContain('already been answered');
    });

    test('a LinkedIn draft returns its body lines, as before', async () => {
        const d = deps();
        const reply = await executeScoutAction('u', { kind: 'draft', runId: RUN_ID, target: 'referral', format: 'linkedin_note' }, d);
        expect(d.calls).toEqual(['draft:referral:linkedin_note']);
        const text = reply.lines.map((line) => line.map((s) => s.text).join('')).join('\n');
        expect(text).toContain('Hello\nThere');
    });

    test('a service error is relayed, not thrown', async () => {
        const d = deps({ draftScoutOutreach: async () => ({ success: false, error: 'Upgrade to draft more', code: 'entitlement_required' }) });
        const reply = await executeScoutAction('u', { kind: 'draft', runId: RUN_ID, target: 'referral', format: 'linkedin_message' }, d);
        expect(reply.lines[0][0].text).toBe('Upgrade to draft more');
    });

    // Live run 2026-09-25: every blocking gap appeared twice, once from
    // notFitReasons ("No evidence in your record for: X") and again as
    // "Missing: X". notFitReasons is authoritative; gaps are only a fallback.
    test('why-not-fit says each reason once', () => {
        const fit = JOB_SECTIONS.fit!;
        if (fit.status !== 'ok') throw new Error('fixture');
        const sections = {
            ...JOB_SECTIONS,
            fit: {
                ...fit,
                data: {
                    ...fit.data,
                    notFitReasons: ['Onsite in Chennai; you prefer remote', 'No evidence in your record for: "Distributed systems at scale"'],
                    matched: [{ requirementId: 'r2', text: 'Go services in production', evidence: 'Built X in Go', strength: 'direct' as const }],
                },
            },
        };
        const text = renderWhyNotFit(view({ sections })).map((line) => line.map((s) => s.text).join('')).join('\n');
        expect(text.match(/Onsite in Chennai/g)).toHaveLength(1);
        expect(text.match(/Distributed systems at scale/g)).toHaveLength(1);
        expect(text).not.toContain('Missing:');
        expect(text).toContain('What you already have');
        expect(text).toContain('Go services in production');
    });

    test('why-not-fit falls back to gaps and conflicts for runs stored without reasons', () => {
        const text = renderWhyNotFit(view({ sections: JOB_SECTIONS })).map((line) => line.map((s) => s.text).join('')).join('\n');
        expect(text).toContain('Onsite in Chennai; you prefer remote');
    });

    test('a status tap reports the move and offers the next steps', async () => {
        const d = deps({
            setJobStatus: async () => ({ success: true, data: {
                workspaceId: 'w', runId: RUN_ID, company: 'Apple', role: 'CMS Engineer', location: null, workMode: null,
                fitScore: 26, verdict: 'not_a_fit', status: 'archived', column: 'closed', sourceUrl: null,
                compHint: null, topStrength: null, topConcern: null, createdAt: '', updatedAt: '',
            } }),
        });
        const archived = await executeScoutAction('u', { kind: 'status', runId: RUN_ID, status: 'not_interested' }, d);
        expect(archived.lines[0][0].text).toBe('Marked Not interested · Apple CMS Engineer. It stays in your tracker under Closed.');
        expect(archived.actions).toBeUndefined();

        const applied = await executeScoutAction('u', { kind: 'status', runId: RUN_ID, status: 'applied' }, d);
        expect(applied.actions?.map((action) => action.label)).toEqual(['🎤 Interviewing', '🏁 Offer', 'Rejected']);
        expect(applied.runId).toBe(RUN_ID);
    });

    test('confirm and dismiss settle the tapped message; failures do not', async () => {
        const ok = deps({ confirmWinForUser: async () => ({ success: true, data: { winId: 'w', title: 'Retry queue' } }) });
        expect(await executeScoutAction('u', { kind: 'confirm_win', winId: 'w' }, ok)).toMatchObject({ settled: true });
        const already = deps({ confirmWinForUser: async () => ({ success: false, error: 'Win is already confirmed' }) });
        const again = await executeScoutAction('u', { kind: 'confirm_win', winId: 'w' }, already);
        expect(again).toMatchObject({ settled: true });
        expect(again.lines[0][0].text).toBe('Already in My work ✓');
        const missing = deps({ confirmWinForUser: async () => ({ success: false, error: 'Win not found', code: 'not_found' }) });
        expect((await executeScoutAction('u', { kind: 'confirm_win', winId: 'w' }, missing)).settled).toBeUndefined();
        const dismissed = deps({ dismissWinForUser: async () => ({ success: true, data: undefined }) });
        expect(await executeScoutAction('u', { kind: 'dismiss_win', winId: 'w' }, dismissed)).toMatchObject({ settled: true });
    });
});

describe('tailor', () => {
    test('the tailor action round-trips and fits in 64 bytes', () => {
        const data = encodeScoutAction(RUN_ID, { kind: 'tailor', label: '' });
        expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
        expect(decodeScoutAction(data)).toEqual({ kind: 'tailor', runId: RUN_ID });
    });

    test('generating: says it is on its way', async () => {
        const calls: string[] = [];
        const d = deps({
            tailorResumeForRun: async (_u, runId, channel) => {
                calls.push(`${runId}:${channel}`);
                return { success: true, data: { sessionId: 's1', workspaceId: 'w1', resumeId: 'r1', status: 'generating' } };
            },
        });
        const reply = await executeScoutAction('u', { kind: 'tailor', runId: RUN_ID }, d, { channel: 'telegram' });
        expect(calls).toEqual([`${RUN_ID}:telegram`]);
        expect(reply.lines.map((l) => l.map((s) => s.text).join('')).join(' ')).toContain('Tailoring your resume');
    });

    test('awaiting a clarification: asks the question right here', async () => {
        const d = deps({
            tailorResumeForRun: async () => ({ success: true, data: { sessionId: 's1', workspaceId: 'w1', resumeId: null, status: 'awaiting_clarification' } }),
            nextGenerationQuestion: async () => 'Have you run Kafka in production?',
        });
        const text = (await executeScoutAction('u', { kind: 'tailor', runId: RUN_ID }, d)).lines.map((l) => l.map((s) => s.text).join('')).join('\n');
        expect(text).toContain('Have you run Kafka in production?');
        expect(text).toContain('skip all');
    });

    test('a plan limit is relayed as the service worded it', async () => {
        const d = deps({ tailorResumeForRun: async () => ({ success: false, error: "You've used all 10 Tailored resumes on Free", code: 'entitlement_required' }) });
        const reply = await executeScoutAction('u', { kind: 'tailor', runId: RUN_ID }, d);
        expect(reply.lines[0][0].text).toContain('Tailored resumes');
    });

    // Live test 2026-11-08: "One detail first:" with three questions waiting.
    test('three questions: says how many, numbers the first, in the /generate wording', async () => {
        const d = deps({
            tailorResumeForRun: async () => ({
                success: true,
                data: {
                    sessionId: 's1', workspaceId: 'w1', resumeId: null, status: 'awaiting_clarification',
                    nextQuestion: { id: 'q1', question: 'Do you have hands-on experience with MCP?', gap: 'MCP' },
                    progress: { current: 1, total: 3 },
                },
            }),
        });
        const text = (await executeScoutAction('u', { kind: 'tailor', runId: RUN_ID }, d)).lines.map((l) => l.map((s) => s.text).join('')).join('\n');
        expect(text).not.toContain('One detail first');
        expect(text).toContain('Before I write it, 3 quick questions about things the job asks for that your record does not show yet.');
        expect(text).toContain('Question 1 of 3: Do you have hands-on experience with MCP?');
        expect(text).toContain('Answer it, or say "skip", "skip all" or "cancel".');
    });

    test('one question: "one quick question", not numbered', async () => {
        const d = deps({
            tailorResumeForRun: async () => ({
                success: true,
                data: { sessionId: 's1', workspaceId: 'w1', resumeId: null, status: 'awaiting_clarification', progress: { current: 1, total: 1 } },
            }),
            nextGenerationQuestion: async () => 'Have you run Kafka in production?',
        });
        const text = (await executeScoutAction('u', { kind: 'tailor', runId: RUN_ID }, d)).lines.map((l) => l.map((s) => s.text).join('')).join('\n');
        expect(text).toContain('one quick question about something the job asks for');
        expect(text).not.toContain('Question 1 of');
    });
});

describe('apply for me', () => {
    test('the button and both answers round-trip in 64 bytes', () => {
        for (const confirm of [undefined, 'y' as const, 'n' as const]) {
            const data = encodeScoutAction(RUN_ID, { kind: 'apply', label: '', ...(confirm ? { confirm } : {}) });
            expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
            expect(decodeScoutAction(data)).toEqual({ kind: 'apply', runId: RUN_ID, ...(confirm ? { confirm } : {}) });
        }
        expect(decodeScoutAction(`sc:g:${RUN_ID}:x`)).toBeNull();
    });

    function applyDeps(chain: { stage: string; reason?: string } | null, status: 'succeeded' | 'awaiting_input' = 'succeeded') {
        const calls: string[] = [];
        const v = view({ status, sections: JOB_SECTIONS, input: { url: 'https://www.linkedin.com/jobs/view/1', source: 'telegram', goal: 'apply', apply: chain ? { at: '', ...chain } as never : null } });
        const d = deps({
            apply: {
                requestApply: async (_u, runId, opts) => {
                    calls.push(`apply:${runId}:${opts.channel}:${opts.override ? 'override' : 'plain'}`);
                    return { success: true, data: { view: v, chain: (chain as never) ?? null, already: false } };
                },
                declineApply: async (_u, runId) => {
                    calls.push(`decline:${runId}`);
                    return { success: true, data: undefined };
                },
            },
        });
        return { d, calls };
    }

    test('tailoring started: says so, and the tapped button is spent', async () => {
        const { d, calls } = applyDeps({ stage: 'tailoring' });
        const reply = await executeScoutAction('u', { kind: 'apply', runId: RUN_ID }, d, { channel: 'telegram' });
        expect(calls).toEqual([`apply:${RUN_ID}:telegram:plain`]);
        expect(reply.lines[0][0].text).toContain('Tailoring your resume for Software Dev Engineer II at Amazon');
        expect(reply.settled).toBe(true);
    });

    test('an eligibility conflict comes back as the one question, with Yes and No', async () => {
        const { d } = applyDeps({ stage: 'eligibility_hold', reason: 'You may not be eligible: requires US citizenship.' });
        const reply = await executeScoutAction('u', { kind: 'apply', runId: RUN_ID }, d, { channel: 'telegram' });
        expect(reply.lines[0][0].text).toBe('You may not be eligible: requires US citizenship. Apply anyway?');
        expect(reply.actions?.map((a) => a.kind === 'apply' ? a.confirm : null)).toEqual(['y', 'n']);
    });

    test('"Yes, apply anyway" passes the override; "No" stops it', async () => {
        const { d, calls } = applyDeps({ stage: 'tailoring' });
        await executeScoutAction('u', { kind: 'apply', runId: RUN_ID, confirm: 'y' }, d, { channel: 'telegram' });
        const no = await executeScoutAction('u', { kind: 'apply', runId: RUN_ID, confirm: 'n' }, d, { channel: 'telegram' });
        expect(calls).toEqual([`apply:${RUN_ID}:telegram:override`, `decline:${RUN_ID}`]);
        expect(no.lines[0][0].text).toContain('I will not apply');
        expect(no.settled).toBe(true);
    });

    test('a blocking question first: asks it, and says the application follows', async () => {
        const { d } = applyDeps({ stage: 'pending' }, 'awaiting_input');
        const v = await d.getScoutRun('u', RUN_ID);
        const reply = await executeScoutAction('u', { kind: 'apply', runId: RUN_ID }, { ...d, apply: { ...d.apply!, requestApply: async () => ({ success: true, data: { view: { ...(v.success ? v.data : view()), input: { source: 'telegram', goal: 'apply' } }, chain: { stage: 'pending', at: '' }, already: false } }) } }, { channel: 'telegram' });
        expect(reply.lines[0][0].text).toContain('as soon as you answer');
        expect(reply.actions?.map((a) => a.kind)).toEqual(['answer', 'answer']);
    });

    test('a refusal keeps its way forward', async () => {
        const d = deps({
            apply: {
                requestApply: async () => ({ success: false, error: 'Upload your resume first.', code: 'no_base_resume' }),
                declineApply: async () => ({ success: true, data: undefined }),
            },
        });
        const reply = await executeScoutAction('u', { kind: 'apply', runId: RUN_ID }, d, { channel: 'telegram' });
        expect(reply.lines[0][0].text).toBe('Upload your resume first.');
        expect(reply.actions?.[0]).toMatchObject({ kind: 'open', label: 'Add your resume' });
    });
});

// ─── versioned email drafts

function draftView(overrides: Partial<DraftView> = {}): DraftView {
    return {
        id: 'cmdraft0000000000000000v1', version: 1, runId: RUN_ID, workspaceId: 'cmws00000000000000000000a',
        format: 'email', target: 'recruiter', toEmail: 'jobs@x.com', subject: 'FDE application',
        body: 'Hi,\n\nResume attached.\n\nJai', createdAt: '', ...overrides,
    };
}

function draftDeps(overrides: Partial<DraftActionDeps> = {}): DraftActionDeps & { calls: string[]; focused: string[] } {
    const calls: string[] = [];
    const focused: string[] = [];
    return {
        calls,
        focused,
        createDraftForRun: async (_u, runId, params) => {
            calls.push(`create:${runId}:${params.target}:${params.format}`);
            return { success: true, data: draftView() };
        },
        reviseDraft: async (_u, draftId, instruction) => {
            calls.push(`revise:${draftId}:${instruction}`);
            return { success: true, data: draftView({ id: 'cmdraft0000000000000000v2', version: 2, body: 'Resume attached. Jai' }) };
        },
        focusDraft: async (_u, channel, draft) => {
            focused.push(`${channel}:${draft.id}`);
        },
        render: (draft) => renderDraftMessage(draft, { gmail: 'https://mail.google.com/mail/?view=cm', mailApp: null }),
        ...overrides,
    };
}

function textOf(reply: { lines: { text: string }[][] }): string {
    return reply.lines.map((line) => line.map((s) => s.text).join('')).join('\n');
}

describe('email drafts on Telegram', () => {
    test('"✉️ Email jobs@x.com" writes v1 through the drafts service, focuses it, and shows To/Subject/Body with buttons', async () => {
        const drafts = draftDeps();
        const d = deps({ drafts });
        const reply = await executeScoutAction('u', { kind: 'draft', runId: RUN_ID, target: 'recruiter', format: 'email' }, d, { channel: 'telegram' });
        expect(drafts.calls).toEqual([`create:${RUN_ID}:recruiter:email`]);
        expect(d.calls).toEqual([]); // not the one-off outreach path
        expect(drafts.focused).toEqual(['telegram:cmdraft0000000000000000v1']);
        expect(textOf(reply)).toContain('To: jobs@x.com');
        expect(textOf(reply)).toContain('Subject: FDE application');
        expect(reply.actions?.map((a) => a.label)).toEqual(['📨 Open in Gmail to send', '✂️ Shorter', '💪 Stronger']);
        expect(reply.runId).toBe(RUN_ID);
    });

    test('a refused draft is relayed with the way forward, and nothing is focused', async () => {
        const drafts = draftDeps({ createDraftForRun: async () => ({ success: false, error: 'You have used your drafts on Free', code: 'entitlement_required' }) });
        const reply = await executeScoutAction('u', { kind: 'draft', runId: RUN_ID, target: 'recruiter', format: 'email' }, deps({ drafts }));
        expect(textOf(reply)).toBe('You have used your drafts on Free');
        // Was "See plans"; during the launch the page shows usage, not prices.
        expect(reply.actions?.[0]).toMatchObject({ kind: 'open', label: 'See your usage' });
        expect(drafts.focused).toEqual([]);
    });

    test('a focus write that fails does not lose the draft', async () => {
        const drafts = draftDeps({ focusDraft: async () => { throw new Error('db down'); } });
        const reply = await executeScoutAction('u', { kind: 'draft', runId: RUN_ID, target: 'recruiter', format: 'email' }, deps({ drafts }));
        expect(textOf(reply)).toContain('To: jobs@x.com');
    });

    test('Shorter and Stronger revise the tapped version with their fixed instruction and move the focus', async () => {
        const drafts = draftDeps();
        const shorter = await executeScoutAction('u', { kind: 'revise_draft', draftId: 'cmdraft0000000000000000v1', revision: 'shorter' }, deps({ drafts }));
        expect(drafts.calls).toEqual([`revise:cmdraft0000000000000000v1:${REVISION_INSTRUCTIONS.shorter}`]);
        expect(drafts.focused).toEqual(['telegram:cmdraft0000000000000000v2']);
        expect(textOf(shorter)).toContain('· v2');
        expect(shorter.actions?.find((a) => a.kind === 'revise_draft')).toMatchObject({ draftId: 'cmdraft0000000000000000v2' });

        await executeScoutAction('u', { kind: 'revise_draft', draftId: 'cmdraft0000000000000000v2', revision: 'stronger' }, deps({ drafts }), { channel: 'whatsapp' });
        expect(drafts.calls[1]).toBe(`revise:cmdraft0000000000000000v2:${REVISION_INSTRUCTIONS.stronger}`);
        expect(drafts.focused[1]).toBe('whatsapp:cmdraft0000000000000000v2');
    });

    test('a refused revision (the numeric guard) says why and keeps the focus where it was', async () => {
        const drafts = draftDeps({ reviseDraft: async () => ({ success: false, error: 'I kept the last version.', code: 'guard_rejected' }) });
        const reply = await executeScoutAction('u', { kind: 'revise_draft', draftId: 'cmdraft0000000000000000v1', revision: 'stronger' }, deps({ drafts }));
        expect(textOf(reply)).toBe('I kept the last version.');
        expect(drafts.focused).toEqual([]);
    });
});
