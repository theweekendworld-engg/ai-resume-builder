import { describe, expect, test } from 'bun:test';
import { LINK_POLL_MS, linkStage, minutesLeft, shouldPollLink, telegramStartUrl } from './linkUi';
import { channelsAvailable, chatAppsLabel } from './availability';
import { nextClarificationQuestion, routeClarificationReply } from './clarification';
import { accountLabel, maskEmail } from './accountLabel';
import { conflictText, linkedText } from './linkCopy';

const NOW = Date.parse('2026-09-27T10:00:00Z');

describe('link UI state', () => {
    test('stages: linked beats everything; a live token waits; a spent one expires', () => {
        expect(linkStage({ linked: true, tokenExpiresAt: '2026-09-27T10:10:00Z', now: NOW })).toBe('linked');
        expect(linkStage({ linked: false, tokenExpiresAt: '2026-09-27T10:10:00Z', now: NOW })).toBe('waiting');
        expect(linkStage({ linked: false, tokenExpiresAt: '2026-09-27T09:59:00Z', now: NOW })).toBe('expired');
        expect(linkStage({ linked: false, tokenExpiresAt: null, now: NOW })).toBe('idle');
    });

    test('polls only while waiting, every few seconds', () => {
        expect(shouldPollLink('waiting')).toBe(true);
        for (const stage of ['linked', 'expired', 'idle'] as const) expect(shouldPollLink(stage)).toBe(false);
        expect(LINK_POLL_MS).toBeLessThanOrEqual(5_000);
    });

    test('the one-tap URL uses the server deep link, or builds it from the bot name', () => {
        expect(telegramStartUrl({ deepLink: 'https://t.me/Bot?start=link_abc', botUsername: 'Other', token: 'abc' })).toBe('https://t.me/Bot?start=link_abc');
        expect(telegramStartUrl({ deepLink: null, botUsername: 'Patronus_resume_bot', token: 'abc' })).toBe('https://t.me/Patronus_resume_bot?start=link_abc');
        expect(telegramStartUrl({ deepLink: null, botUsername: null, token: 'abc' })).toBeNull();
    });

    test('minutes left rounds up and floors at zero', () => {
        expect(minutesLeft('2026-09-27T10:14:01Z', NOW)).toBe(15);
        expect(minutesLeft('2026-09-27T09:00:00Z', NOW)).toBe(0);
    });
});

describe('WhatsApp is only named when configured', () => {
    test('no WHATSAPP_* variables → not available, and labels say Telegram only', () => {
        const available = channelsAvailable({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_BOT_USERNAME: '@Patronus_resume_bot' });
        expect(available).toEqual({ telegram: true, whatsapp: false, telegramBotUsername: 'Patronus_resume_bot' });
        expect(chatAppsLabel(available)).toBe('Telegram');
    });

    test('configured → both named', () => {
        const available = channelsAvailable({ TELEGRAM_BOT_TOKEN: 't', WHATSAPP_ACCESS_TOKEN: 'a', WHATSAPP_PHONE_NUMBER_ID: '1' });
        expect(available.whatsapp).toBe(true);
        expect(chatAppsLabel(available)).toBe('Telegram or WhatsApp');
    });
});

describe('resume clarification routing', () => {
    const asked = new Date('2026-09-27T09:50:00Z');
    const now = new Date(NOW);

    test('a recent short reply answers', () => {
        expect(routeClarificationReply({ text: '2 years of Kafka at Plivo', askedAt: asked, now })).toBe('answer');
    });

    test('a link, a pasted post, or a stale question pass through to Scout', () => {
        expect(routeClarificationReply({ text: 'https://www.linkedin.com/jobs/view/1', askedAt: asked, now })).toBe('pass');
        expect(routeClarificationReply({ text: 'x'.repeat(800), askedAt: asked, now })).toBe('pass');
        expect(routeClarificationReply({ text: 'yes', askedAt: new Date('2026-09-26T10:00:00Z'), now })).toBe('pass');
    });

    test('"skip" and "skip all" always skip, even on a stale question', () => {
        expect(routeClarificationReply({ text: 'Skip', askedAt: new Date('2026-09-20T00:00:00Z'), now })).toBe('skip');
        expect(routeClarificationReply({ text: 'skip all.', askedAt: asked, now })).toBe('skip_all');
    });

    test('the next unanswered question is read from the session payload', () => {
        const payload = { questions: [{ id: 'a', question: 'First?' }, { id: 'b', question: 'Second?' }], answers: { a: '' } };
        expect(nextClarificationQuestion(payload)).toBe('Second?');
        expect(nextClarificationQuestion({ questions: [], answers: {} })).toBeNull();
        expect(nextClarificationQuestion(null)).toBeNull();
    });
});

describe('account labels and conflict copy', () => {
    test('emails are masked to the first letter and domain', () => {
        expect(maskEmail('jaimauryatech@gmail.com')).toBe('j•••@gmail.com');
        expect(maskEmail('')).toBeNull();
        expect(accountLabel({ fullName: 'Jai Shankar', email: 'jaimauryatech@gmail.com' })).toBe('Jai Shankar · j•••@gmail.com');
        expect(accountLabel(null)).toBe('another account');
    });

    test('the conflict message names the other account and both ways out', () => {
        const text = conflictText({ otherAccount: 'j•••@gmail.com', app: 'Telegram', unlinkCommand: '/unlink' });
        expect(text).toContain('linked to another Patronus account (j•••@gmail.com)');
        expect(text).toContain('tap Unlink');
        expect(text).toContain('/unlink');
    });

    test('linked copy describes what the bot does now, not only /generate', () => {
        const text = linkedText('Jai · j•••@gmail.com', { bare: false });
        expect(text).toContain('job or post link');
        expect(text).toContain('Work Log');
        expect(text).toContain('/jobs');
    });
});
