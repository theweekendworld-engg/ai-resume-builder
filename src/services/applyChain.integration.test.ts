/**
 * Share and go, end to end against the local Postgres
 * (docs/impl/07-telegram-apply.md §5).
 *
 * Real: the run and its chain state, tailoring (per-job copy, the session,
 * the "skip all" path and its charge), the versioned draft, the focus, the
 * tracker and the generation notifier. Kept out: the posting parse (seeded in
 * `ParsedJDCache`), the generation pipeline (the enqueue seam; completion is
 * written by the test), the outreach model (the drafts seam) and Telegram
 * (the transport mock).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { ApplicationStatus, Channel, GenerationStatus, Prisma } from '@prisma/client';
import { installMocks } from '@/__mocks__';
import type { MockTelegram } from '@/__mocks__/telegram';
import { __testing as aiTesting } from '@/lib/ai/structured';
import { minimalPdf } from '@/lib/channels/telegramFiles.test-utils';
import { getFocus } from '@/lib/chat/focus';
import { storePdfArtifact } from '@/lib/pdfStorage';
import { prisma } from '@/lib/prisma';
import { readApplyChain } from '@/lib/scout/applyChain';
import { __testing as telegramTesting } from '@/lib/telegram';
import { __testing as generateTesting } from '@/services/channelGenerate';
import { appendAssistantMessage, listThread, routeChannelText } from '@/services/chat';
import { __testing as draftsTesting, getDraft } from '@/services/drafts';
import { quietApplications } from '@/services/journey';
import { getScoutRun } from '@/services/scout';
import { notifyTelegramGenerationSession } from '@/services/telegramGenerationNotifications';
import { __testing as chainTesting, advanceApplyChain, markApplicationSent, requestApply } from './applyChain';

const RUN = `itest-apply-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let n = 0;
const users: string[] = [];
const chats: string[] = [];

/** The skills this posting asks for that the fixture record does not show. */
const GAPS = ['MCP', 'Claude'];
const JD = `Forward Deployed AI Engineer at Acme. ${'We build agent systems for enterprise customers and ship them into production. '.repeat(3)}
Requirements: TypeScript, PostgreSQL, MCP and Claude. Send resumes to jobs@acme.com`;
const JD_NO_ADDRESS = `Forward Deployed AI Engineer at Globex. ${'We build agent systems for logistics customers and ship them into production. '.repeat(3)}
Requirements: TypeScript, PostgreSQL, MCP and Claude. Apply on our careers page.`;

const BASE_CONTENT = {
    personalInfo: { fullName: 'Test Person', email: 't@example.com', phone: '', location: '', linkedin: '', github: '', website: '', title: 'Engineer', summary: 'Engineer.' },
    experience: [{ id: 'e1', company: 'Plivo', role: 'Engineer', startDate: '2022', endDate: '', current: true, location: '', description: ['Built TypeScript services on PostgreSQL.'] }],
    education: [],
    projects: [],
    skills: [{ id: 's1', name: 'Languages', skills: ['TypeScript', 'PostgreSQL'] }],
} as unknown as Prisma.InputJsonValue;

async function seedParsedJD(jd: string) {
    const hash = createHash('sha256').update(jd.trim()).digest('hex');
    await prisma.parsedJDCache.upsert({
        where: { jdHash: hash },
        create: {
            jdHash: hash,
            parsedJD: { role: 'Forward Deployed AI Engineer', company: 'Acme', requiredSkills: ['TypeScript', 'PostgreSQL', ...GAPS], preferredSkills: [] },
            expiresAt: new Date(Date.now() + 3_600_000),
        },
        update: { expiresAt: new Date(Date.now() + 3_600_000) },
    });
}

const at = () => new Date().toISOString();
const ok = (data: unknown) => ({ status: 'ok', data, sources: [], finishedAt: at() });

type Seed = {
    jd?: string;
    company?: string;
    status?: 'succeeded' | 'awaiting_input';
    eligibilityConflict?: boolean;
    applyEmails?: string[];
    goal?: 'apply' | null;
    /** Where the share came from: the chain delivers there. */
    channel?: 'telegram' | 'web';
};

async function seed(options: Seed = {}) {
    n += 1;
    const userId = `${RUN}-u${n}`;
    const chatId = `${String(Date.now()).slice(-7)}${n}`;
    users.push(userId);
    chats.push(chatId);
    const jd = options.jd ?? JD;
    const company = options.company ?? 'Acme';
    await prisma.channelIdentity.create({ data: { userId, channel: Channel.telegram, externalId: chatId, verified: true } });
    await prisma.userExperience.create({
        data: { userId, company: 'Plivo', role: 'Engineer', startDate: '2022', description: 'Built TypeScript services on PostgreSQL.', current: true },
    });
    await prisma.resume.create({ data: { userId, title: 'My Resume', content: BASE_CONTENT } });
    const run = await prisma.agentRun.create({
        data: {
            userId,
            agent: 'scout',
            inputKey: `text:${RUN}-${n}`,
            input: { text: jd, source: options.channel === 'web' ? 'dashboard' : 'telegram', ...(options.goal === null ? {} : { goal: options.goal ?? 'apply' }) },
            kind: 'job_posting',
            status: options.status ?? 'succeeded',
            channel: options.channel === 'web' ? Channel.web : Channel.telegram,
            channelRef: options.channel === 'web' ? {} : { chatId },
            result: {
                ingest: ok({ text: jd, title: 'Forward Deployed AI Engineer', companyName: company, sourceUrl: null, linkKind: 'text', fetchVia: 'provided_text' }),
                jd: ok({
                    role: 'Forward Deployed AI Engineer', company, seniority: 'mid', domain: 'ai', location: 'Remote', workMode: 'remote',
                    employmentType: null, compensationText: null, experienceText: null, requirements: [], skills: [], responsibilities: [],
                    applyUrl: options.applyEmails?.length === 0 ? 'https://jobs.globex.example/apply/42' : null,
                    applyEmails: options.applyEmails ?? ['jobs@acme.com'],
                }),
                fit: ok({
                    score: 72, verdict: 'possible', matched: [], gaps: [], notFitReasons: [], summary: 'x', softRequirements: [],
                    preferenceChecks: options.eligibilityConflict
                        ? [{ key: 'eligibility', status: 'conflict', detail: 'You may not be eligible: requires US citizenship; you said "Indian citizen".' }]
                        : [],
                }),
            } as Prisma.InputJsonValue,
        },
    });
    const workspace = await prisma.applicationWorkspace.create({
        data: { userId, sourceUrl: `https://example.com/${RUN}/${n}`, scoutRunId: run.id, companyName: company, roleTitle: 'Forward Deployed AI Engineer', jobDescription: jd, applicationStatus: ApplicationStatus.analyzed },
    });
    await prisma.agentRun.update({
        where: { id: run.id },
        data: { result: { ...(run.result as object), track: ok({ workspaceId: workspace.id, status: 'analyzed', created: true }) } as Prisma.InputJsonValue },
    });
    return { userId, chatId, runId: run.id, workspaceId: workspace.id };
}

async function chainOf(runId: string) {
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    return readApplyChain(run.input);
}

/** What the generation pipeline would leave behind: a completed session and its PDF. */
async function completeGeneration(userId: string, sessionId: string) {
    const session = await prisma.generationSession.findUniqueOrThrow({ where: { id: sessionId } });
    const resumeId = session.sourceResumeId!;
    const stored = await storePdfArtifact({ userId, resumeId, sessionId, template: 'compact', pdfBuffer: minimalPdf(['Test Person', 'Forward Deployed AI Engineer']) });
    await prisma.generatedPdf.create({ data: { userId, resumeId, sessionId, blobKey: stored.blobKey, blobUrl: stored.blobUrl, fileSizeBytes: stored.fileSizeBytes } });
    await prisma.generationSession.update({ where: { id: sessionId }, data: { status: GenerationStatus.completed, resultResumeId: resumeId, completedAt: new Date() } });
}

let telegram: MockTelegram;
const enqueued: string[] = [];
const drafted: Array<{ target: string; format: string; note: string | null }> = [];

beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test-token';
    await seedParsedJD(JD);
    await seedParsedJD(JD_NO_ADDRESS);
    // "sent it" is decided in code; any other model call here would be a bug.
    aiTesting.setUsageLogger(async () => {});
    aiTesting.setBudgetGuard(async () => undefined);
    aiTesting.setObjectRunner(async () => {
        throw new Error('no model call expected in the apply chain test');
    });
    draftsTesting.setScout({
        getScoutRun,
        draftScoutOutreach: async (_userId, _runId, params) => {
            drafted.push({ target: params.target, format: params.format, note: params.note ?? null });
            return {
                success: true,
                data: {
                    id: `od-${drafted.length}`, target: params.target, format: params.format, recipientName: null,
                    subject: params.format === 'email' ? 'Forward Deployed AI Engineer application' : null,
                    body: 'Hi,\n\nI build TypeScript services on PostgreSQL at Plivo and would like to be considered. My resume is attached.\n\nTest',
                    createdAt: at(),
                },
            };
        },
    });
});

beforeEach(() => {
    telegram = installMocks({ only: ['telegram'] }).telegram;
    generateTesting.setEnqueuer(async (sessionId) => {
        enqueued.push(sessionId);
        return { runId: 'test' };
    });
});

afterEach(() => {
    enqueued.length = 0;
    drafted.length = 0;
    chainTesting.setDeps(null);
});

afterAll(async () => {
    aiTesting.reset();
    draftsTesting.setScout(null);
    generateTesting.setEnqueuer(null);
    telegramTesting.reset();
    const where = { userId: { in: users } };
    await prisma.applicationEvent.deleteMany({ where });
    await prisma.messageDraft.deleteMany({ where });
    await prisma.chatMessage.deleteMany({ where });
    await prisma.chatConversation.deleteMany({ where });
    await prisma.generatedPdf.deleteMany({ where });
    await prisma.generationSession.deleteMany({ where });
    await prisma.applicationWorkspace.deleteMany({ where });
    await prisma.agentRun.deleteMany({ where });
    await prisma.resume.deleteMany({ where });
    await prisma.userExperience.deleteMany({ where });
    await prisma.usageQuota.deleteMany({ where });
    await prisma.channelIdentity.deleteMany({ where });
});

const sent = (chatId: string) => telegram.toChat(chatId);

describe('a. scout finished', () => {
    test('a run without the apply goal is left alone', async () => {
        const { runId } = await seed({ goal: null });
        expect(await advanceApplyChain(runId)).toBeNull();
        expect(enqueued).toHaveLength(0);
    });

    test('b. it tailors at once, skipping every question, and remembers what they asked about', async () => {
        const { userId, runId, workspaceId } = await seed();
        const chain = await advanceApplyChain(runId);

        expect(chain?.stage).toBe('tailoring');
        expect(chain?.skipped).toEqual(GAPS);
        const session = await prisma.generationSession.findFirstOrThrow({ where: { userId, workspaceId } });
        expect(chain?.sessionId).toBe(session.id);
        // The "skip all" path: asked, declined, nothing claimed, generation started and charged once.
        expect(session.status).toBe(GenerationStatus.generating);
        const clarifications = session.clarifications as { questions: { gap: string }[]; answers: Record<string, string>; chain: { runId: string } };
        expect(clarifications.questions.map((q) => q.gap)).toEqual(GAPS);
        expect(Object.values(clarifications.answers)).toEqual(['', '']);
        expect(clarifications.chain).toEqual({ runId });
        expect(session.jobDescription).not.toContain('Candidate clarifications');
        expect(enqueued).toEqual([session.id]);

        // A retried finish step moves nothing.
        expect((await advanceApplyChain(runId))?.stage).toBe('tailoring');
        expect(await prisma.generationSession.count({ where: { userId } })).toBe(1);
    });

    test('a blocking eligibility conflict stops it and asks; "Apply anyway" carries on', async () => {
        const { userId, runId } = await seed({ eligibilityConflict: true });
        const held = await advanceApplyChain(runId);
        expect(held).toMatchObject({ stage: 'eligibility_hold', reason: 'You may not be eligible: requires US citizenship; you said "Indian citizen".' });
        expect(await prisma.generationSession.count({ where: { userId } })).toBe(0);

        const anyway = await requestApply(userId, runId, { channel: 'telegram', override: true });
        expect(anyway.success).toBe(true);
        if (!anyway.success) return;
        expect(anyway.data.chain).toMatchObject({ stage: 'tailoring', override: true });
        expect(await prisma.generationSession.count({ where: { userId } })).toBe(1);
    });

    test('a run paused on a blocking question waits, and goes on once it is answered', async () => {
        const { userId, runId } = await seed({ status: 'awaiting_input' });
        expect((await advanceApplyChain(runId))?.stage).toBe('pending');
        expect(await prisma.generationSession.count({ where: { userId } })).toBe(0);

        // The answer re-runs the analysis; its finish calls the chain again.
        await prisma.agentRun.update({ where: { id: runId }, data: { status: 'succeeded' } });
        expect((await advanceApplyChain(runId))?.stage).toBe('tailoring');
    });

    test('a refusal is stored with its reason and code, for the final message', async () => {
        const { runId } = await seed();
        chainTesting.setDeps({ tailor: async () => ({ success: false, error: 'Upload your resume first. Tailoring starts from the resume you already have.', code: 'no_base_resume' }) });
        expect(await advanceApplyChain(runId)).toMatchObject({ stage: 'stopped', code: 'no_base_resume' });
    });
});

describe('the hook: the analysis finishing', () => {
    test('finishScoutRun takes the chain a step before the final message, so the message says what is happening', async () => {
        const { userId, chatId, runId } = await seed();
        const { finishScoutRun } = await import('@/lib/scout/pipeline');
        telegram.reset();

        await finishScoutRun(runId, null);

        expect((await chainOf(runId))?.stage).toBe('tailoring');
        expect(await prisma.generationSession.count({ where: { userId } })).toBe(1);
        const final = sent(chatId).filter((c) => c.method === 'sendMessage').at(-1);
        expect(final?.text).toContain('🚀 Tailoring your resume for Forward Deployed AI Engineer at Acme now.');
    });

    test('an eligibility conflict: the final message is the analysis and one question', async () => {
        const { chatId, runId } = await seed({ eligibilityConflict: true });
        const { finishScoutRun } = await import('@/lib/scout/pipeline');
        telegram.reset();

        await finishScoutRun(runId, null);

        const final = sent(chatId).filter((c) => c.method === 'sendMessage').at(-1)!;
        expect(final.text).toContain('Apply anyway?');
        const buttons = (final.replyMarkup as { inline_keyboard: { text: string; callback_data?: string }[][] }).inline_keyboard.flat();
        expect(buttons.map((b) => b.text).slice(0, 2)).toEqual(['Yes, apply anyway', 'No, skip it']);
        expect(buttons[0].callback_data).toBe(`sc:g:${runId}:y`);
    });
});

describe('e. the Apply for me button', () => {
    test('starts the same chain on a run shared without a goal, and a second tap repeats nothing', async () => {
        const { userId, runId } = await seed({ goal: null });
        const first = await requestApply(userId, runId, { channel: 'telegram' });
        expect(first.success && first.data.chain?.stage).toBe('tailoring');
        const again = await requestApply(userId, runId, { channel: 'telegram' });
        expect(again.success && again.data.already).toBe(true);
        expect(await prisma.generationSession.count({ where: { userId } })).toBe(1);
    });

    test('someone else\'s run is not found', async () => {
        const { runId } = await seed({ goal: null });
        const forged = await requestApply(`${RUN}-intruder`, runId, { channel: 'telegram' });
        expect(forged).toMatchObject({ success: false, code: 'not_found' });
    });
});

describe('c. generation completed', () => {
    test('the PDF, named from the record, then the email draft: one result, the draft in focus', async () => {
        const { userId, chatId, runId } = await seed();
        await advanceApplyChain(runId);
        const { sessionId } = (await chainOf(runId))!;
        await completeGeneration(userId, sessionId!);
        telegram.reset();

        await notifyTelegramGenerationSession(sessionId!);

        const calls = sent(chatId);
        expect(calls.map((c) => c.method)).toEqual(['sendDocument', 'sendMessage']);
        const document = calls[0].body as { caption: string; document: { filename: string }; reply_markup: string };
        expect(document.document.filename).toBe('Test_Person_Resume_Acme.pdf');
        expect(document.caption).toBe('One page, tailored for Forward Deployed AI Engineer at Acme.');
        expect(JSON.parse(document.reply_markup).inline_keyboard[0].map((b: { text: string }) => b.text)).toEqual(['Open resume', 'Regenerate']);

        const draft = await prisma.messageDraft.findFirstOrThrow({ where: { userId, runId } });
        expect(draft).toMatchObject({ format: 'email', target: 'recruiter', toEmail: 'jobs@acme.com', version: 1 });
        const message = calls[1].text ?? '';
        expect(message).toContain('To: </b>jobs@acme.com');
        expect(message).toContain('Attach the PDF above and send.');
        expect(message).toContain("I didn't claim MCP or Claude experience. Reply with details to add them to the email.");
        expect(message).not.toContain('ATS');

        expect(await getFocus(userId, Channel.telegram)).toMatchObject({ kind: 'draft', draftId: draft.id, runId });
        expect(await chainOf(runId)).toMatchObject({ stage: 'drafted', draftId: draft.id });

        // The workflow's notify step can run twice: nothing more is sent, no second draft.
        await notifyTelegramGenerationSession(sessionId!);
        expect(sent(chatId)).toHaveLength(2);
        expect(await prisma.messageDraft.count({ where: { userId } })).toBe(1);
    });

    test('no apply address: a LinkedIn message to the recruiter, with "Open the application"', async () => {
        const { userId, chatId, runId } = await seed({ jd: JD_NO_ADDRESS, company: 'Globex', applyEmails: [] });
        await advanceApplyChain(runId);
        const { sessionId } = (await chainOf(runId))!;
        await completeGeneration(userId, sessionId!);
        telegram.reset();

        await notifyTelegramGenerationSession(sessionId!);

        expect(drafted.at(-1)).toMatchObject({ target: 'recruiter', format: 'linkedin_message' });
        const message = sent(chatId).find((c) => c.method === 'sendMessage')!;
        expect(message.text).toContain('LinkedIn message draft');
        expect(message.text).toContain('then send this to the recruiter on LinkedIn');
        const keyboard = message.replyMarkup as { inline_keyboard: { text: string; url?: string }[][] };
        expect(keyboard.inline_keyboard.flat()[0]).toEqual({ text: 'Open the application', url: 'https://jobs.globex.example/apply/42' });
    });

    test('a session the chain did not start gets the plain message: one document, no duplicate', async () => {
        const { userId, chatId, runId, workspaceId } = await seed({ goal: null });
        const resume = await prisma.resume.findFirstOrThrow({ where: { userId } });
        const session = await prisma.generationSession.create({
            data: { userId, workspaceId, sourceResumeId: resume.id, jobDescription: JD, channel: Channel.telegram, status: GenerationStatus.generating, atsScore: 37 },
        });
        await prisma.resume.update({ where: { id: resume.id }, data: { targetCompany: 'Acme', targetRole: 'Forward Deployed AI Engineer' } });
        await completeGeneration(userId, session.id);
        telegram.reset();

        await notifyTelegramGenerationSession(session.id);

        const calls = sent(chatId);
        expect(calls.map((c) => c.method)).toEqual(['sendDocument']);
        const body = calls[0].body as { caption: string; document: { filename: string } };
        expect(body.caption).toBe('One page, tailored for Forward Deployed AI Engineer at Acme.');
        expect(body.caption).not.toContain('37');
        expect(body.document.filename).toBe('Test_Person_Resume_Acme.pdf');
        expect(await prisma.messageDraft.count({ where: { userId, runId } })).toBe(0);
    });
});

describe('d. "sent it"', () => {
    test('marks the job Applied, clears the focus, and the follow-up reminder will find it', async () => {
        const { userId, chatId, runId, workspaceId } = await seed();
        await advanceApplyChain(runId);
        const { sessionId } = (await chainOf(runId))!;
        await completeGeneration(userId, sessionId!);
        await notifyTelegramGenerationSession(sessionId!);
        expect(chatId).toBeTruthy();

        const routed = await routeChannelText(userId, 'sent it', 'telegram');

        expect(routed).toEqual({ kind: 'reply', text: "Marked Applied. I'll remind you to follow up in a week." });
        const workspace = await prisma.applicationWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
        expect(workspace.applicationStatus).toBe(ApplicationStatus.applied);
        expect(await getFocus(userId, Channel.telegram)).toBeNull();
        expect((await chainOf(runId))?.stage).toBe('applied');

        // journey_daily's reminder: an applied job quiet for a week is due.
        const inEightDays = new Date(Date.now() + 8 * 86_400_000);
        expect((await quietApplications(userId, inEightDays)).map((job) => job.workspaceId)).toContain(workspaceId);
    });
});

describe('web chat parity: the chain\'s result lands in the thread', () => {
    async function webThread(userId: string) {
        const conversation = await prisma.chatConversation.findUnique({ where: { userId_channel: { userId, channel: Channel.web } } });
        return conversation ? prisma.chatMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' } }) : [];
    }

    async function settleOnWeb(options: Seed = {}) {
        const seeded = await seed({ ...options, channel: 'web' });
        await advanceApplyChain(seeded.runId);
        const { sessionId } = (await chainOf(seeded.runId))!;
        await completeGeneration(seeded.userId, sessionId!);
        telegram.reset();
        await notifyTelegramGenerationSession(sessionId!);
        return { ...seeded, sessionId: sessionId! };
    }

    test('the resume (completed, with its PDF) and the email draft, as one assistant message, once; nothing on Telegram', async () => {
        const { userId, chatId, runId, sessionId } = await settleOnWeb();

        expect(sent(chatId)).toHaveLength(0);
        const rows = await webThread(userId);
        expect(rows).toHaveLength(1);
        expect(rows[0].role).toBe('assistant');
        expect(rows[0].text).toContain('Your resume for Forward Deployed AI Engineer at Acme is ready, and so is the application email to jobs@acme.com.');
        expect(rows[0].text).toContain("I didn't claim MCP or Claude experience.");

        const pdf = await prisma.generatedPdf.findFirstOrThrow({ where: { userId, sessionId } });
        const session = await prisma.generationSession.findUniqueOrThrow({ where: { id: sessionId } });
        const draft = await prisma.messageDraft.findFirstOrThrow({ where: { userId, runId } });
        expect(rows[0].cards).toEqual([
            { type: 'generation', sessionId, resumeId: session.resultResumeId, status: 'completed', title: 'Forward Deployed AI Engineer at Acme', question: null, pdfUrl: `/api/pdfs/${pdf.id}` },
            {
                type: 'message_draft', draftId: draft.id, runId, format: 'email', target: 'recruiter', version: 1,
                toEmail: 'jobs@acme.com', subject: 'Forward Deployed AI Engineer application', body: draft.body,
                title: 'Forward Deployed AI Engineer at Acme', applyUrl: null, skipped: GAPS,
            },
        ]);
        expect(await chainOf(runId)).toMatchObject({ stage: 'drafted', draftId: draft.id });

        // The notify step can run twice: still one message.
        await notifyTelegramGenerationSession(sessionId);
        expect(await webThread(userId)).toHaveLength(1);
    });

    test('no apply address: the LinkedIn message, with the application link', async () => {
        const { userId } = await settleOnWeb({ jd: JD_NO_ADDRESS, company: 'Globex', applyEmails: [] });
        const [row] = await webThread(userId);
        expect(row.text).toContain('here is a LinkedIn message for the recruiter');
        const cards = row.cards as { type: string; format?: string; applyUrl?: string | null }[];
        expect(cards[1]).toMatchObject({ type: 'message_draft', format: 'linkedin_message', applyUrl: 'https://jobs.globex.example/apply/42' });
    });

    test('read back: the draft at its latest version, the progress card where the chain stands, and Mark as applied marks the job', async () => {
        const { userId, runId, workspaceId } = await settleOnWeb();
        // The "On it" turn's progress card, as it was stored when the chain started.
        await appendAssistantMessage(userId, { text: 'On it.', cards: [{ type: 'apply_chain', runId, stage: 'pending', title: null, reason: null, code: null }] });
        // Shorter, on the job page: version 2 of the same draft.
        const v1 = await prisma.messageDraft.findFirstOrThrow({ where: { userId, runId } });
        const v2 = await prisma.messageDraft.create({
            data: { userId, runId, workspaceId: v1.workspaceId, parentId: v1.id, version: 2, format: 'email', target: 'recruiter', toEmail: v1.toEmail, subject: v1.subject, body: 'Shorter body.', instruction: 'Make it shorter' },
        });

        const cardsOf = async () => (await listThread(userId)).flatMap((message) => message.cards);
        let cards = await cardsOf();
        const draftCard = cards.find((card) => card.type === 'message_draft');
        expect(draftCard).toMatchObject({ draftId: v2.id, version: 2, body: 'Shorter body.', applied: false });
        expect(cards.find((card) => card.type === 'apply_chain')).toMatchObject({ stage: 'drafted', title: 'Forward Deployed AI Engineer at Acme' });

        // The card's button calls markApplicationSent with the card's draft.
        const draft = await getDraft(userId, v2.id);
        expect(await markApplicationSent(userId, draft!)).toBe(true);
        expect((await prisma.applicationWorkspace.findUniqueOrThrow({ where: { id: workspaceId } })).applicationStatus).toBe(ApplicationStatus.applied);
        cards = await cardsOf();
        expect(cards.find((card) => card.type === 'message_draft')).toMatchObject({ applied: true });
        expect(cards.find((card) => card.type === 'apply_chain')).toMatchObject({ stage: 'applied' });
    });

    test('someone else\'s run never hydrates into a card', async () => {
        const { runId } = await settleOnWeb();
        const intruder = `${RUN}-intruder-web`;
        users.push(intruder);
        await appendAssistantMessage(intruder, { text: 'x', cards: [{ type: 'apply_chain', runId, stage: 'pending', title: null, reason: null, code: null }] });
        const [message] = await listThread(intruder);
        expect(message.cards[0]).toMatchObject({ stage: 'pending', title: null });
    });
});
