/**
 * The "Mail app" button's route: a signed token is the whole authorisation
 * (the phone's browser has no Patronus session), it names one draft version,
 * and the only write is marking that version opened.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { signComposeToken } from '@/lib/drafts/composeToken';
import { GET } from './route';

const SECRET = process.env.WIN_MAGIC_LINK_SECRET;
const userId = `test-compose-${randomUUID()}`;
let emailId = '';
let noteId = '';

beforeAll(async () => {
    process.env.WIN_MAGIC_LINK_SECRET = 'compose-route-test-secret';
    const email = await prisma.messageDraft.create({
        data: {
            userId, format: 'email', target: 'recruiter', toEmail: 'jobs@x.com',
            subject: 'Forward Deployed AI Engineer', body: 'Hi,\n\nMy resume is attached.\n\nJai',
        },
    });
    const note = await prisma.messageDraft.create({
        data: { userId, format: 'linkedin_note', target: 'referral', body: 'Hi, would you refer me?' },
    });
    emailId = email.id;
    noteId = note.id;
});

afterAll(async () => {
    await prisma.messageDraft.deleteMany({ where: { userId } });
    if (SECRET === undefined) delete process.env.WIN_MAGIC_LINK_SECRET;
    else process.env.WIN_MAGIC_LINK_SECRET = SECRET;
});

function get(id: string, query: string): Promise<Response> {
    return GET(new Request(`https://www.patronus.cv/api/compose/${id}${query}`), { params: Promise.resolve({ id }) });
}

describe('/api/compose/[id]', () => {
    test('a valid token redirects to the mailto link and marks the draft opened, once', async () => {
        const token = signComposeToken(emailId)!;
        const first = await get(emailId, `?t=${encodeURIComponent(token)}`);
        expect(first.status).toBe(302);
        const location = first.headers.get('location')!;
        expect(location.startsWith('mailto:jobs@x.com?subject=Forward%20Deployed%20AI%20Engineer&body=')).toBe(true);
        expect(new URL(location).searchParams.get('body')).toBe('Hi,\r\n\r\nMy resume is attached.\r\n\r\nJai');
        expect(first.headers.get('cache-control')).toBe('no-store');
        expect((await prisma.messageDraft.findUnique({ where: { id: emailId } }))?.status).toBe('opened');

        // A second tap still opens the mail app; the state does not move again.
        const second = await get(emailId, `?t=${encodeURIComponent(token)}`);
        expect(second.status).toBe(302);
        expect((await prisma.messageDraft.findUnique({ where: { id: emailId } }))?.status).toBe('opened');
    });

    test('via=gmail redirects to Gmail web compose instead', async () => {
        const token = signComposeToken(emailId)!;
        const response = await get(emailId, `?t=${encodeURIComponent(token)}&via=gmail`);
        expect(response.status).toBe(302);
        const location = new URL(response.headers.get('location')!);
        expect(location.origin).toBe('https://mail.google.com');
        expect(location.searchParams.get('to')).toBe('jobs@x.com');
    });

    test('no token, a token for another draft, an expired token: 403, and nothing is read', async () => {
        expect((await get(emailId, '')).status).toBe(403);
        expect((await get(emailId, `?t=${encodeURIComponent(signComposeToken(noteId)!)}`)).status).toBe(403);
        const old = signComposeToken(emailId, { now: new Date(Date.now() - 40 * 86_400_000) })!;
        expect((await get(emailId, `?t=${encodeURIComponent(old)}`)).status).toBe(403);
        expect((await get('../etc', `?t=${encodeURIComponent(signComposeToken('../etc')!)}`)).status).toBe(403);
    });

    test('a LinkedIn draft has no mail link; an unknown draft is not found', async () => {
        expect((await get(noteId, `?t=${encodeURIComponent(signComposeToken(noteId)!)}`)).status).toBe(404);
        const ghost = 'cmghostdraft0000000000001';
        expect((await get(ghost, `?t=${encodeURIComponent(signComposeToken(ghost)!)}`)).status).toBe(404);
        expect((await prisma.messageDraft.findUnique({ where: { id: noteId } }))?.status).toBe('draft');
    });
});
