import { describe, expect, test } from 'bun:test';
import { formatForTelegram, formatForWhatsApp, toTelegramKeyboard } from './format';
import { markFor, renderScoutFinal, renderScoutProgress, MAX_KEY_LINES } from './scoutRender';
import type { FitData } from '@/lib/scout/types';
import { APP, JOB_SECTIONS, ok, RUN_ID, view } from './testViews.test-utils';

function plain(lines: { text: string }[][]): string {
    return lines.map((line) => line.map((segment) => segment.text).join('')).join('\n');
}

describe('progress', () => {
    test('marks: done ✓, pending …, degraded —, asking ?', () => {
        expect(markFor(ok(1), true)).toBe('✓');
        expect(markFor(undefined, true)).toBe('…');
        expect(markFor(undefined, false)).toBe('—');
        expect(markFor({ status: 'unavailable', reason: 'x', sources: [], finishedAt: '' }, true)).toBe('—');
        expect(markFor({ status: 'needs_input', question: { id: 'q', step: 'fit', prompt: '?' }, finishedAt: '' }, true)).toBe('?');
    });

    test('one line per planned section, with the dashboard link', () => {
        const v = view({ status: 'running', sections: { ingest: ok({}) as never } });
        const message = renderScoutProgress(v, APP);
        const text = plain(message.lines);
        expect(text).toContain('✓ Reading the link');
        expect(text).toContain('… Checking fit against your record and preferences');
        expect(message.lines.length).toBe(2 + v.plan.length);
        expect(plain([message.footer!])).toContain(`${APP}/scout/${RUN_ID}`);
        expect(message.actions).toHaveLength(0);
    });
});

describe('final: job', () => {
    const v = view({ sections: JOB_SECTIONS });
    const message = renderScoutFinal(v, APP);
    const text = plain(message.lines);

    test('headline, then location, comp with source domain, company, the not-fit reason, interviews', () => {
        expect(text.split('\n')[0]).toBe(v.headline);
        expect(text).toContain('📍 Chennai, Tamil Nadu, India · onsite');
        expect(text).toContain('₹45–60 LPA SDE II total comp, India (levels.fyi)');
        expect(text).toContain('🏢 Amazon: ~1,500,000 employees · Public');
        expect(text).toContain('⚠️ Onsite in Chennai; you prefer remote');
        expect(text).toContain('🎤 2 interview experiences found');
    });

    test('never more than five key lines', () => {
        // headline + blank + key lines
        expect(message.lines.length - 2).toBeLessThanOrEqual(MAX_KEY_LINES);
    });

    test('a stretch offers the tracker, then draft, why-not-fit, email and open', () => {
        expect(message.actions.map((action) => action.kind)).toEqual(['status', 'status', 'status', 'apply', 'tailor', 'draft', 'why', 'draft', 'open']);
        expect(message.actions.slice(0, 3).map((action) => action.label)).toEqual(['💾 Save', '📨 Applied', '❌ Not interested']);
    });

    test('a strong fit does not offer "why not a fit"', () => {
        const base = JOB_SECTIONS.fit as { data: FitData };
        const strong = view({ sections: { ...JOB_SECTIONS, fit: ok<FitData>({ ...base.data, verdict: 'strong', notFitReasons: [] }) } });
        expect(renderScoutFinal(strong, APP).actions.map((action) => action.kind)).toEqual(['status', 'status', 'status', 'apply', 'tailor', 'draft', 'draft', 'open']);
    });

    test('an unavailable section simply has no line', () => {
        const sparse = view({ sections: { jd: JOB_SECTIONS.jd, comp: { status: 'unavailable', reason: 'no key', sources: [], finishedAt: '' } } });
        const lines = plain(renderScoutFinal(sparse, APP).lines);
        expect(lines).not.toContain('💰');
    });

    test('formats cleanly for both channels', () => {
        expect(formatForTelegram(message, RUN_ID).text).toContain('<b>₹45–60 LPA</b>');
        expect(formatForWhatsApp(message, RUN_ID).text).toContain('*₹45–60 LPA*');
    });
});

describe('final: question', () => {
    test('options become answer buttons, in order', () => {
        const v = view({
            status: 'awaiting_input',
            pendingQuestion: {
                id: 'pref.relocate', step: 'fit', prompt: 'This role is onsite in Chennai. Would you relocate?',
                options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'case_by_case', label: 'Depends' }],
            },
        });
        const message = renderScoutFinal(v, APP);
        expect(plain(message.lines)).toContain('Would you relocate?');
        expect(message.actions).toEqual([
            { kind: 'answer', index: 0, label: 'Yes' },
            { kind: 'answer', index: 1, label: 'No' },
            { kind: 'answer', index: 2, label: 'Depends' },
        ]);
    });

    test('a free-text question asks for a reply', () => {
        const v = view({ status: 'awaiting_input', pendingQuestion: { id: 'pref.location', step: 'fit', prompt: 'Where are you based?' } });
        expect(plain(renderScoutFinal(v, APP).lines)).toContain('Reply here with your answer.');
    });
});

describe('final: other kinds', () => {
    test('a failed run says why and suggests pasting', () => {
        const v = view({ status: 'failed', headline: 'Reading your link…', error: 'LinkedIn would not show this post without a login', sections: {} });
        const text = plain(renderScoutFinal(v, APP).lines);
        expect(text).toContain('without a login');
        expect(text).toContain('paste the post text');
    });

    test('knowledge shows up to three takeaways', () => {
        const v = view({
            kind: 'knowledge',
            sections: { digest: ok({ title: 't', takeaways: ['a', 'b', 'c', 'd'], tags: [], savedInsightId: null }) },
        });
        const message = renderScoutFinal(v, APP);
        expect(plain(message.lines).match(/• /g)).toHaveLength(3);
        expect(message.actions).toHaveLength(0);
    });

    test('knowledge says where it was saved', () => {
        const v = view({
            kind: 'knowledge',
            sections: { digest: ok({ title: 't', takeaways: ['a'], tags: [], savedInsightId: 'ins1' }) },
        });
        expect(plain(renderScoutFinal(v, APP).lines)).toContain('Saved to your Insights shelf');
    });

    test('company news says where it was recorded', () => {
        const v = view({ kind: 'company_signal', sections: {} });
        expect(plain(renderScoutFinal(v, APP).lines)).toContain('Recorded under Companies');
    });
});

describe('final: work note', () => {
    const capture = {
        winId: 'cmwin000000000000000000a', title: 'Shipped the retry queue', narrative: 'Moved payment retries onto a queue.\nMore detail.',
        category: 'shipped', skills: ['Go', 'Kafka'], status: 'draft' as const, duplicateOfWinId: null, degraded: false,
    };

    test('shows the draft with Confirm, Edit and Dismiss, and points at the Work Log', () => {
        const v = view({ kind: 'work_note', headline: 'Work Log draft: Shipped the retry queue', sections: { capture: ok(capture) } });
        const message = renderScoutFinal(v, APP);
        const text = plain(message.lines);
        expect(text).toContain('📝 Shipped the retry queue');
        expect(text).toContain('shipped · Go, Kafka');
        expect(text).toContain('Moved payment retries onto a queue.');
        expect(text).not.toContain('More detail.');
        expect(message.actions).toEqual([
            { kind: 'confirm_win', winId: capture.winId, label: '✅ Confirm' },
            { kind: 'open', label: '✏️ Edit', url: `${APP}/log?win=${capture.winId}` },
            { kind: 'dismiss_win', winId: capture.winId, label: '🗑 Dismiss' },
        ]);
        expect(plain([message.footer!])).toContain(`${APP}/log`);
    });

    test('a near-duplicate offers Open instead of a second draft', () => {
        const v = view({ kind: 'work_note', sections: { capture: ok({ ...capture, status: 'merge_proposed', duplicateOfWinId: 'cmwinexisting0000000000a' }) } });
        const message = renderScoutFinal(v, APP);
        expect(plain(message.lines)).toContain('already logged');
        expect(message.actions).toEqual([{ kind: 'open', label: 'Open in Work Log', url: `${APP}/log?win=cmwinexisting0000000000a` }]);
    });

    test('Confirm / Dismiss share one Telegram row with Edit', () => {
        const v = view({ kind: 'work_note', sections: { capture: ok(capture) } });
        const keyboard = toTelegramKeyboard(formatForTelegram(renderScoutFinal(v, 'https://aicv.example.com'), RUN_ID).buttons) as { inline_keyboard: unknown[][] };
        expect(keyboard.inline_keyboard).toHaveLength(1);
        expect(keyboard.inline_keyboard[0]).toHaveLength(3);
    });
});

describe('final: job tracker line', () => {
    test('a newly tracked job says so, and one already applied says where it stands', () => {
        const fresh = view({ sections: { ...JOB_SECTIONS, track: ok({ workspaceId: 'w', status: 'analyzed' as const, created: true }) } });
        expect(plain(renderScoutFinal(fresh, APP).lines)).toContain('📋 Saved to your job tracker');
        const applied = view({ sections: { ...JOB_SECTIONS, track: ok({ workspaceId: 'w', status: 'applied' as const, created: false }) } });
        expect(plain(renderScoutFinal(applied, APP).lines)).toContain('📋 Already in your tracker: Applied');
    });

    test('the job status buttons sit on one Telegram row', () => {
        const message = renderScoutFinal(view({ sections: JOB_SECTIONS }), 'https://aicv.example.com');
        const keyboard = toTelegramKeyboard(formatForTelegram(message, RUN_ID).buttons) as { inline_keyboard: { text: string }[][] };
        expect(keyboard.inline_keyboard[0].map((button) => button.text)).toEqual(['💾 Save', '📨 Applied', '❌ Not interested']);
    });

    test('on WhatsApp the choices overflow three buttons, so they travel as a list', () => {
        const message = renderScoutFinal(view({ sections: JOB_SECTIONS }), APP);
        const callbacks = message.actions.filter((action) => action.kind !== 'open');
        expect(callbacks.length).toBeGreaterThan(3);
    });
});

describe('the pay follow-up on a finished job', () => {
    test('is asked under the result, as a typed reply, without holding the fit back', () => {
        const fit = (JOB_SECTIONS.fit as { data: FitData }).data;
        const withFollowUp = view({
            status: 'succeeded',
            sections: {
                ...JOB_SECTIONS,
                fit: ok<FitData>({ ...fit, followUp: { id: 'pref.compFloor', step: 'fit', prompt: 'This posting states $90/hr. What is the lowest pay you would take?' } }),
            },
        });
        const message = renderScoutFinal(withFollowUp, APP);
        const text = message.lines.map((line) => line.map((span) => span.text).join('')).join('\n');
        expect(text).toContain('What is the lowest pay you would take?');
        expect(text).toContain('Reply here with your answer');
        // The job's own buttons stay; the follow-up does not replace them.
        expect(message.actions.some((action) => action.kind === 'tailor')).toBe(true);
    });

    test('nothing extra when there is no follow-up', () => {
        const message = renderScoutFinal(view({ status: 'succeeded', sections: JOB_SECTIONS }), APP);
        const text = message.lines.map((line) => line.map((span) => span.text).join('')).join('\n');
        expect(text).not.toContain('Reply here with your answer');
    });
});

describe('share and go: the final message follows the goal', () => {
    const fit = (JOB_SECTIONS.fit as { data: FitData }).data;
    const input = (extra: Record<string, unknown>) => ({ url: 'https://www.linkedin.com/jobs/view/4455902670', source: 'telegram' as const, ...extra });
    const text = (message: { lines: { text: string }[][] }) => plain(message.lines);

    test('a blocking eligibility conflict: the analysis, then "Apply anyway?" with Yes and No', () => {
        const held = view({
            sections: JOB_SECTIONS,
            input: input({ goal: 'apply', apply: { stage: 'eligibility_hold', at: '', reason: 'You may not be eligible: requires US citizenship.' } }),
        });
        const message = renderScoutFinal(held, APP);
        expect(text(message)).toContain('📍 Chennai');
        expect(text(message)).toContain('You may not be eligible: requires US citizenship. Apply anyway?');
        expect(message.actions.map((a) => a.label)).toEqual(['Yes, apply anyway', 'No, skip it', 'Open in Patronus']);
    });

    test('tailoring: the analysis, then what is happening, and no buttons to repeat it', () => {
        const working = view({ sections: JOB_SECTIONS, input: input({ goal: 'apply', apply: { stage: 'tailoring', at: '' } }) });
        const message = renderScoutFinal(working, APP);
        expect(text(message)).toContain('🚀 Tailoring your resume for Software Dev Engineer II at Amazon now.');
        expect(message.actions.map((a) => a.kind)).toEqual(['open']);
    });

    test('a blocking preference question: asked as before, with a word that the application follows', () => {
        const asking = view({
            status: 'awaiting_input',
            sections: JOB_SECTIONS,
            pendingQuestion: { id: 'pref.relocate', step: 'fit', prompt: 'Would you relocate to Chennai?', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
            input: input({ goal: 'apply' }),
        });
        const message = renderScoutFinal(asking, APP);
        expect(text(message)).toContain('Would you relocate to Chennai?');
        expect(text(message)).toContain('Once you answer, I will tailor your resume and draft the application.');
        expect(message.actions.map((a) => a.kind)).toEqual(['answer', 'answer']);
    });

    test('a stopped chain says why and keeps the buttons, Apply for me included', () => {
        const stopped = view({ sections: JOB_SECTIONS, input: input({ goal: 'apply', apply: { stage: 'stopped', at: '', reason: 'Upload your resume first.', code: 'no_base_resume' } }) });
        const message = renderScoutFinal(stopped, APP);
        expect(text(message)).toContain('⚠️ Upload your resume first.');
        expect(message.actions.some((a) => a.kind === 'apply')).toBe(true);
    });

    test('Apply for me is not offered once applied or while the chain works', () => {
        const applied = view({ sections: { ...JOB_SECTIONS, track: ok({ workspaceId: 'w', status: 'applied' as const, created: false }) } });
        expect(renderScoutFinal(applied, APP).actions.some((a) => a.kind === 'apply')).toBe(false);
        const drafted = view({ sections: JOB_SECTIONS, input: input({ goal: 'apply', apply: { stage: 'drafted', at: '' } }) });
        expect(renderScoutFinal(drafted, APP).actions.some((a) => a.kind === 'apply')).toBe(false);
    });

    test('"who should I talk to": the people by name, and the message to them leads', () => {
        const people = view({
            sections: {
                ...JOB_SECTIONS,
                fit: ok<FitData>({ ...fit, verdict: 'strong', notFitReasons: [] }),
                network: ok({
                    targets: [{ contactId: 'c1', fullName: 'Priya Raman', position: 'Engineering Manager', company: 'Amazon', profileUrl: null, tier: 'first_degree' as const, why: '1st-degree connection' }],
                    searchLinks: [],
                    hasContactsImported: true,
                }),
            },
            input: input({ goal: 'people' }),
        });
        const message = renderScoutFinal(people, APP);
        expect(text(message)).toContain('🤝 Who to talk to');
        expect(text(message)).toContain('• Priya Raman, Engineering Manager · 1st-degree connection');
        expect(message.actions[0]).toMatchObject({ kind: 'draft', target: 'f', format: 'n' });
    });

    test('"save for later": says it is saved', () => {
        const saved = view({ sections: { ...JOB_SECTIONS, track: ok({ workspaceId: 'w', status: 'analyzed' as const, created: true }) }, input: input({ goal: 'save' }) });
        expect(text(renderScoutFinal(saved, APP))).toContain('💾 Saved for later');
    });
});
