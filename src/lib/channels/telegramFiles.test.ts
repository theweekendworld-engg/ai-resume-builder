/**
 * Files sent to the bot: which are read, how they are downloaded, and what
 * comes out. Telegram is replaced at the transport (`fetch`), so the real
 * `downloadTelegramFile` and the real PDF parser run.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { __testing as telegramTesting } from '@/lib/telegram';
import {
    FILE_TOO_LARGE_TEXT,
    TELEGRAM_FILE_MAX_BYTES,
    TELEGRAM_FILE_TEXT_MAX,
    TelegramFileError,
    classifyTelegramAttachment,
    composeFileText,
    readTelegramDocument,
    type TelegramDocument,
} from './telegramFiles';
import { minimalPdf, serveTelegramFile, type ServedFile } from './telegramFiles.test-utils';

const TOKEN = 'test-token-files';
const previousToken = process.env.TELEGRAM_BOT_TOKEN;

const serve = (served: ServedFile) => serveTelegramFile(served);

const pdfDoc = (over: Partial<TelegramDocument> = {}): TelegramDocument => ({ file_id: 'f1', file_name: 'jd.pdf', mime_type: 'application/pdf', ...over });
const textDoc = (over: Partial<TelegramDocument> = {}): TelegramDocument => ({ file_id: 'f2', file_name: 'jd.txt', mime_type: 'text/plain', ...over });

beforeAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
});

afterEach(() => telegramTesting.reset());

afterAll(() => {
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
});

describe('what counts as readable', () => {
    test('PDFs and text files are read; the type comes from the MIME type or the name', () => {
        expect(classifyTelegramAttachment({ document: pdfDoc() })).toMatchObject({ kind: 'readable', format: 'pdf' });
        expect(classifyTelegramAttachment({ document: pdfDoc({ mime_type: undefined }) })).toMatchObject({ kind: 'readable', format: 'pdf' });
        expect(classifyTelegramAttachment({ document: textDoc() })).toMatchObject({ kind: 'readable', format: 'text' });
        expect(classifyTelegramAttachment({ document: textDoc({ file_name: 'notes.md', mime_type: 'application/octet-stream' }) })).toMatchObject({ kind: 'readable', format: 'text' });
        expect(classifyTelegramAttachment({ document: textDoc({ file_name: 'post.markdown', mime_type: 'text/markdown' }) })).toMatchObject({ kind: 'readable', format: 'text' });
    });

    test('photos, voice notes and other documents are not', () => {
        expect(classifyTelegramAttachment({ photo: [{ file_id: 'p' }] })).toEqual({ kind: 'unreadable' });
        expect(classifyTelegramAttachment({ voice: { file_id: 'v' } })).toEqual({ kind: 'unreadable' });
        expect(classifyTelegramAttachment({ document: { file_id: 'd', file_name: 'cv.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } })).toEqual({ kind: 'unreadable' });
        expect(classifyTelegramAttachment({ document: { file_id: 'g', file_name: 'funny.mp4', mime_type: 'video/mp4' } })).toEqual({ kind: 'unreadable' });
    });

    test('a message with no attachment has nothing to read', () => {
        expect(classifyTelegramAttachment({})).toEqual({ kind: 'none' });
        expect(classifyTelegramAttachment({ caption: 'orphan caption' })).toEqual({ kind: 'none' });
    });
});

describe('reading a file', () => {
    test('a PDF is downloaded through getFile and its text extracted', async () => {
        const bytes = minimalPdf(['Senior Backend Engineer', 'Send resumes to jobs@example.com']);
        const urls = serve({ bytes });
        const read = await readTelegramDocument({ document: pdfDoc({ file_size: bytes.length }), format: 'pdf' });
        expect(read).toEqual({ ok: true, text: 'Senior Backend Engineer Send resumes to jobs@example.com', truncated: false });
        expect(urls).toEqual([
            `https://api.telegram.org/bot${TOKEN}/getFile`,
            `https://api.telegram.org/file/bot${TOKEN}/documents/file_1.pdf`,
        ]);
    });

    test('a text file is decoded as UTF-8, with Windows line endings and blank runs tidied', async () => {
        serve({ bytes: new TextEncoder().encode('Staff Engineer – Bengaluru\r\n\r\n\r\n\r\nWe use Kafka.  \r\n') });
        const read = await readTelegramDocument({ document: textDoc(), format: 'text' });
        expect(read).toEqual({ ok: true, text: 'Staff Engineer – Bengaluru\n\nWe use Kafka.', truncated: false });
    });

    test('text past the cap is cut at a word boundary and marked truncated', async () => {
        const word = 'kubernetes ';
        serve({ bytes: new TextEncoder().encode(word.repeat(Math.ceil((TELEGRAM_FILE_TEXT_MAX * 1.5) / word.length))) });
        const read = await readTelegramDocument({ document: textDoc(), format: 'text' });
        if (!read.ok) throw new Error('expected a read');
        expect(read.truncated).toBe(true);
        expect(read.text.length).toBeLessThanOrEqual(TELEGRAM_FILE_TEXT_MAX);
        expect(read.text.length).toBeGreaterThan(TELEGRAM_FILE_TEXT_MAX - 200);
        expect(read.text.endsWith('kubernetes')).toBe(true);
    });

    test('over 5 MB by the size Telegram reports: refused without downloading anything', async () => {
        const urls = serve({});
        const read = await readTelegramDocument({ document: pdfDoc({ file_size: TELEGRAM_FILE_MAX_BYTES + 1 }), format: 'pdf' });
        expect(read).toEqual({ ok: false, reply: FILE_TOO_LARGE_TEXT });
        expect(urls).toHaveLength(0);
    });

    test('over 5 MB by the download itself, when the update did not say', async () => {
        serve({
            getFile: { ok: true, result: { file_id: 'f1', file_path: 'documents/big.pdf' } },
            bytes: new Uint8Array(TELEGRAM_FILE_MAX_BYTES + 10),
        });
        expect(await readTelegramDocument({ document: pdfDoc(), format: 'pdf' })).toEqual({ ok: false, reply: FILE_TOO_LARGE_TEXT });
    });

    test('Telegram\'s own "file is too big" is the size reply, not a failure', async () => {
        serve({ getFile: { ok: false, description: 'Bad Request: file is too big' } });
        expect(await readTelegramDocument({ document: pdfDoc(), format: 'pdf' })).toEqual({ ok: false, reply: FILE_TOO_LARGE_TEXT });
    });

    test('a damaged PDF is answered with what to do instead', async () => {
        serve({ bytes: new TextEncoder().encode('this is not a pdf at all') });
        const read = await readTelegramDocument({ document: pdfDoc(), format: 'pdf' });
        expect(read.ok).toBe(false);
        if (!read.ok) expect(read.reply).toContain('could not read that PDF');
    });

    test('a PDF with no text (a scan) says so', async () => {
        serve({ bytes: minimalPdf([]) });
        const read = await readTelegramDocument({ document: pdfDoc(), format: 'pdf' });
        expect(read.ok).toBe(false);
        if (!read.ok) expect(read.reply).toContain('could not find any text');
    });

    test('a binary file named .txt is not passed on as text', async () => {
        serve({ bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08]) });
        const read = await readTelegramDocument({ document: textDoc(), format: 'text' });
        expect(read.ok).toBe(false);
        if (!read.ok) expect(read.reply).toContain('does not look like plain text');
    });

    test('a failed download is our failure: it throws, and never with the bot token in it', async () => {
        for (const served of [
            { throwOn: 'getFile' as const },
            { throwOn: 'file' as const, bytes: new Uint8Array([1]) },
            { fileStatus: 502, bytes: new Uint8Array([1]) },
            { getFile: { ok: false, description: 'Bad Request: wrong file_id' } },
        ]) {
            serve(served);
            const error = await readTelegramDocument({ document: pdfDoc(), format: 'pdf' }).then(() => null, (e: unknown) => e);
            expect(error).toBeInstanceOf(TelegramFileError);
            expect((error as Error).message).not.toContain(TOKEN);
        }
    });
});

describe('what continues', () => {
    test('caption, a blank line, then the text; no caption means just the text', () => {
        expect(composeFileText('/generate', 'Senior Backend Engineer')).toBe('/generate\n\nSenior Backend Engineer');
        expect(composeFileText('  ', 'Senior Backend Engineer')).toBe('Senior Backend Engineer');
        expect(composeFileText(undefined, 'Senior Backend Engineer')).toBe('Senior Backend Engineer');
    });
});
