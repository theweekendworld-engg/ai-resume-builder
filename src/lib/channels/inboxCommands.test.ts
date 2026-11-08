import { describe, expect, test } from 'bun:test';
import { classifyInbound, NOTE_MIN } from './inbound';
import { formatForTelegram, formatForWhatsApp, toTelegramKeyboard } from './format';
import {
    parseInboxCommand,
    renderApplied,
    renderHelp,
    renderInboxCommand,
    renderInsights,
    renderJobs,
    renderMemory,
    renderNotes,
    MEMORY_LIST_LIMIT,
    type MemoryListItem,
} from './inboxCommands';
import { withoutSpentButtons } from './telegramInbound';
import type { JobBoardItem, NoteItem } from '@/lib/inbox/types';

const APP = 'https://aicv.example.com';

function plain(lines: { text: string }[][]): string {
    return lines.map((line) => line.map((segment) => segment.text).join('')).join('\n');
}

function job(overrides: Partial<JobBoardItem> = {}): JobBoardItem {
    return {
        workspaceId: 'w1', runId: 'cmue6z09b000965hljys7gv7l', company: 'Nightfall AI', role: 'Backend Engineer',
        location: 'Bengaluru, Karnataka, India', workMode: null, fitScore: 72, verdict: 'possible', status: 'analyzed',
        column: 'to_review', sourceUrl: 'https://www.linkedin.com/jobs/view/1', compHint: null, topStrength: null,
        topConcern: null, createdAt: '', updatedAt: '', ...overrides,
    };
}

describe('routing rules', () => {
    test('links and long posts are shares; notes are replies; chatter is tiny', () => {
        expect(classifyInbound('https://www.linkedin.com/jobs/view/1')).toBe('share');
        expect(classifyInbound('x'.repeat(200))).toBe('share');
        expect(classifyInbound('shipped retry queue, p99 down 40%')).toBe('reply');
        expect(classifyInbound('fixed flaky CI!')).toBe('reply');
        expect(classifyInbound('ok thanks')).toBe('tiny');
        expect(classifyInbound('x'.repeat(NOTE_MIN - 1))).toBe('tiny');
        expect(classifyInbound('/jobs')).toBe('command');
    });
});

describe('parseInboxCommand', () => {
    test('slash commands everywhere, bare words only where allowed', () => {
        expect(parseInboxCommand('/jobs', { allowBare: false })).toBe('jobs');
        expect(parseInboxCommand('/notes@Patronus_resume_bot', { allowBare: false })).toBe('notes');
        expect(parseInboxCommand('jobs', { allowBare: false })).toBeNull();
        expect(parseInboxCommand('Jobs', { allowBare: true })).toBe('jobs');
        expect(parseInboxCommand('help', { allowBare: true })).toBe('help');
    });

    test('a sentence that starts with a command word is a note, not a command', () => {
        expect(parseInboxCommand('jobs I applied to last week', { allowBare: true })).toBeNull();
        expect(parseInboxCommand('/scout', { allowBare: false })).toBeNull();
    });
});

describe('empty states explain what to send', () => {
    test.each([
        ['jobs', renderJobs([], APP), 'Send me any LinkedIn job link'],
        ['applied', renderApplied([], APP), 'tap 📨 Applied'],
        ['insights', renderInsights([], APP), 'Send me a LinkedIn post worth keeping'],
        ['notes', renderNotes([], APP), 'Tell me what you worked on'],
    ])('%s', (_name, message, expected) => {
        expect(plain(message.lines)).toContain(expected);
        expect(message.actions).toHaveLength(0);
    });
});

describe('lists', () => {
    test('/jobs: verdict emoji, role @ company, score, city, linked to the analysis', () => {
        const message = renderJobs([job(), job({ runId: null, verdict: null, fitScore: null, role: 'SRE', company: 'Acme', location: null })], APP);
        const text = plain(message.lines);
        expect(text).toContain('🟡 Backend Engineer @ Nightfall AI · 72 · Bengaluru');
        expect(text).toContain('⚪ SRE @ Acme');
        expect(formatForTelegram(message, 'none').text).toContain(`href="${APP}/scout/cmue6z09b000965hljys7gv7l"`);
    });

    test('/applied groups by where each job stands', () => {
        const text = plain(renderApplied([
            job({ column: 'applied', status: 'applied', company: 'A' }),
            job({ column: 'interviewing', status: 'interview', company: 'B' }),
        ], APP).lines);
        expect(text.indexOf('Interviewing (1)')).toBeLessThan(text.indexOf('Applied (1)'));
    });

    test('/insights: title and first takeaway', () => {
        const text = plain(renderInsights([{ id: 'i', runId: null, title: 'System design', takeaways: ['Clarify first'], tags: [], url: null, author: null, createdAt: '' }], APP).lines);
        expect(text).toContain('📚 System design');
        expect(text).toContain('Clarify first');
    });

    test('/notes: drafts get Confirm buttons, capped at five', () => {
        const notes: NoteItem[] = [
            ...Array.from({ length: 7 }, (_, i) => ({ winId: `cmwin00000000000000000${i}a`, title: `Draft ${i}`, status: 'draft' as const, source: 'chat', createdAt: '' })),
            { winId: 'cmwinconfirmed0000000000', title: 'Done', status: 'confirmed', source: 'chat', createdAt: '' },
        ];
        const message = renderNotes(notes, APP);
        expect(message.actions).toHaveLength(5);
        expect(message.actions.every((action) => action.kind === 'confirm_win')).toBe(true);
        // Telegram keeps all five; WhatsApp sends them as a list (more than 3).
        expect(formatForTelegram(message, 'none').buttons).toHaveLength(5);
    });

    test('/help lists every command, bare on WhatsApp', () => {
        expect(plain(renderHelp(APP, { bare: false }).lines)).toContain('/applied:');
        const bare = formatForWhatsApp(renderHelp(APP, { bare: true }), 'none').text;
        expect(bare).toContain('applied:');
        expect(bare).not.toContain('/applied');
    });

    test('renderInboxCommand reads through the deps it is given', async () => {
        const seen: string[] = [];
        const deps = {
            topFits: async () => { seen.push('topFits'); return [job()]; },
            listJobBoard: async (_u: string, filters?: { columns?: string[] }) => { seen.push(`board:${filters?.columns?.join(',')}`); return []; },
            listInsights: async () => { seen.push('insights'); return []; },
            listChatNotes: async () => { seen.push('notes'); return []; },
        };
        await renderInboxCommand('jobs', 'u', deps, APP, { bare: false });
        await renderInboxCommand('applied', 'u', deps, APP, { bare: false });
        expect(seen).toEqual(['topFits', 'board:applied,interviewing,offer']);
    });
});

describe('spent buttons', () => {
    test('confirming a Win removes its Confirm and Dismiss, nothing else', () => {
        const rows = [
            [{ text: 'Confirm', callback_data: 'sc:c:cmwina' }, { text: 'Edit', url: 'https://x' }, { text: 'Dismiss', callback_data: 'sc:x:cmwina' }],
            [{ text: 'Other', callback_data: 'sc:c:cmwinb' }],
        ];
        expect(withoutSpentButtons(rows, 'sc:c:cmwina')).toEqual([[{ text: 'Edit', url: 'https://x' }], [{ text: 'Other', callback_data: 'sc:c:cmwinb' }]]);
        expect(withoutSpentButtons([[{ text: 'Confirm', callback_data: 'sc:c:cmwina' }]], 'sc:x:cmwina')).toEqual([]);
    });
});

describe('keyboard packing', () => {
    test('short labels share rows of three; a long label gets its own row', () => {
        const keyboard = toTelegramKeyboard([
            { kind: 'callback', label: '💾 Save', data: '1' },
            { kind: 'callback', label: '📨 Applied', data: '2' },
            { kind: 'callback', label: '❌ Not interested', data: '3' },
            { kind: 'callback', label: 'Draft referral note', data: '4' },
            { kind: 'callback', label: 'Why', data: '5' },
        ]) as { inline_keyboard: { text: string }[][] };
        expect(keyboard.inline_keyboard.map((row) => row.map((button) => button.text))).toEqual([
            ['💾 Save', '📨 Applied', '❌ Not interested'],
            ['Draft referral note'],
            ['Why'],
        ]);
    });
});

describe('/memory', () => {
    const memory = (overrides: Partial<MemoryListItem> = {}): MemoryListItem => ({
        label: 'Claude', key: 'skill:claude', text: 'Voice agent on Claude Sonnet at Plivo', sensitivity: 'shareable', createdAt: '2026-11-08T09:00:00.000Z', ...overrides,
    });

    test('is a command, with a slash on Telegram and bare on WhatsApp', () => {
        expect(parseInboxCommand('/memory', { allowBare: false })).toBe('memory');
        expect(parseInboxCommand('/memory@Patronus_resume_bot', { allowBare: false })).toBe('memory');
        expect(parseInboxCommand('memory', { allowBare: true })).toBe('memory');
        expect(parseInboxCommand('memory of my last job', { allowBare: true })).toBeNull();
    });

    test('lists what the user told us, topic first, with the date, and links to settings', () => {
        const message = renderMemory([memory(), memory({ label: 'Work mode', key: 'pref:work_mode', text: 'remote', createdAt: '2026-11-01T00:00:00.000Z' })], APP);
        const text = plain(message.lines);
        expect(text).toContain('What I remember you told me');
        expect(text).toContain('• Claude: Voice agent on Claude Sonnet at Plivo · Nov 8');
        expect(text).toContain('• Work mode: remote · Nov 1');
        expect(plain([message.footer ?? []])).toContain(`${APP}/settings/memory`);
        expect(message.actions).toEqual([]);
    });

    test('private lines are marked, and the mark is explained', () => {
        const text = plain(renderMemory([memory({ label: 'Minimum pay', key: 'pref:min_comp', text: '₹45 LPA', sensitivity: 'private' })], APP).lines);
        expect(text).toContain('🔒 Minimum pay: ₹45 LPA');
        expect(text).toContain('never put in a resume or message');
    });

    test('a long memory is capped, and says where the rest is', () => {
        const many = Array.from({ length: MEMORY_LIST_LIMIT + 3 }, (_, i) => memory({ label: `Skill ${i}`, key: `skill:s${i}` }));
        const text = plain(renderMemory(many, APP).lines);
        expect(text).toContain(`Skill ${MEMORY_LIST_LIMIT - 1}:`);
        expect(text).not.toContain(`Skill ${MEMORY_LIST_LIMIT}:`);
        expect(text).toContain('And 3 more on the settings page.');
    });

    test('the empty state says what fills it', () => {
        const text = plain(renderMemory([], APP).lines);
        expect(text).toContain('Nothing remembered yet');
        expect(text).toContain('never ask it twice');
    });

    test('renders for Telegram as HTML, with user text escaped', () => {
        const html = formatForTelegram(renderMemory([memory({ text: 'Built <script> tools & more' })], APP), 'none');
        expect(html.text).toContain('&lt;script&gt;');
        expect(html.text).toContain('<b>Claude</b>');
    });

    test('reads through the deps it is given, and help lists it', async () => {
        const deps = {
            topFits: async () => [], listJobBoard: async () => [], listInsights: async () => [], listChatNotes: async () => [],
            listMemories: async () => [memory()],
        };
        const message = await renderInboxCommand('memory', 'u', deps, APP, { bare: false });
        expect(plain(message.lines)).toContain('Voice agent on Claude Sonnet at Plivo');
        expect(plain(renderHelp(APP, { bare: false }).lines)).toContain('/memory: what I remember you told me');
        expect(plain(renderHelp(APP, { bare: true }).lines)).toContain('memory: what I remember you told me');
    });
});
