import { describe, expect, test } from 'bun:test';
import { decodeScoutAction, encodeScoutAction, executeScoutAction, renderWhyNotFit, type ScoutActionDeps } from './scoutActions';
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
    });

    test('an unknown status code or a malformed win id decodes to null', () => {
        for (const data of [`sc:s:${RUN_ID}:z`, `sc:s:${RUN_ID}`, 'sc:c:../x', 'sc:x:', 'sc:c:short']) {
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

    test('a draft returns subject and body lines', async () => {
        const d = deps();
        const reply = await executeScoutAction('u', { kind: 'draft', runId: RUN_ID, target: 'referral', format: 'email' }, d);
        expect(d.calls).toEqual(['draft:referral:email']);
        const text = reply.lines.map((line) => line.map((s) => s.text).join('')).join('\n');
        expect(text).toContain('Subject: Hi');
        expect(text).toContain('Hello\nThere');
    });

    test('a service error is relayed, not thrown', async () => {
        const d = deps({ draftScoutOutreach: async () => ({ success: false, error: 'Upgrade to draft more', code: 'entitlement_required' }) });
        const reply = await executeScoutAction('u', { kind: 'draft', runId: RUN_ID, target: 'referral', format: 'email' }, d);
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
        expect(again.lines[0][0].text).toBe('Already in your Work Log ✓');
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
});
