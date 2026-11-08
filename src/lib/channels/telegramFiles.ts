/**
 * Files sent to the Telegram bot (docs/impl/07-telegram-apply.md).
 *
 * A PDF or a text file is read and then continues as if the user had pasted
 * it: the caption, a blank line, the text. So a job description sent as a PDF
 * reaches Scout exactly like a pasted one, and a "/generate" caption on it
 * starts a resume. Photos and every other kind of file get one sentence
 * saying what can be read.
 *
 * The file itself is never stored. The bytes are downloaded, read in memory
 * and dropped; only the extracted text continues.
 */

import { z } from 'zod';
import { extractTextFromPdf } from '@/lib/pdfParser';
import { JOB_DESCRIPTION_MAX } from '@/lib/scout/sections/track';
import { downloadTelegramFile } from '@/lib/telegram';

/** The same cap the PDF parser enforces. */
export const TELEGRAM_FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The most extracted text that continues. Scout keeps this much of a posting
 * as the job description (it accepts more, and `/generate` takes 50,000), so
 * a longer file loses nothing Scout would have used. The chat router's own
 * 4,000 never applies: text this long is a share, and goes to Scout.
 */
export const TELEGRAM_FILE_TEXT_MAX = JOB_DESCRIPTION_MAX;

export const TelegramDocumentSchema = z.object({
    file_id: z.string(),
    file_name: z.string().optional(),
    mime_type: z.string().optional(),
    file_size: z.number().optional(),
});
export type TelegramDocument = z.infer<typeof TelegramDocumentSchema>;

/**
 * The attachment fields of a Telegram `message`, spread into
 * `TelegramUpdateSchema`. Media other than documents is only ever detected,
 * never read, so its shape does not matter.
 */
export const TELEGRAM_MEDIA_FIELDS = {
    caption: z.string().optional(),
    document: TelegramDocumentSchema.optional(),
    photo: z.array(z.unknown()).optional(),
    video: z.unknown().optional(),
    video_note: z.unknown().optional(),
    audio: z.unknown().optional(),
    voice: z.unknown().optional(),
};

export type TelegramMediaMessage = {
    caption?: string;
    document?: TelegramDocument;
    photo?: unknown[];
    video?: unknown;
    video_note?: unknown;
    audio?: unknown;
    voice?: unknown;
};

export type TelegramAttachment =
    /** No attachment: a text message, or a service message (a pin, a join). */
    | { kind: 'none' }
    | { kind: 'readable'; document: TelegramDocument; format: 'pdf' | 'text' }
    /** A photo, a voice note, a .docx: answered with UNREADABLE_FILE_TEXT. */
    | { kind: 'unreadable' };

// ───────────────────────────────────────────────────────────── copy

export const UNREADABLE_FILE_TEXT =
    'I can read PDFs and text files (.txt or .md), but not photos or other files yet. Paste the text here instead, or send it as a PDF.';
export const FILE_TOO_LARGE_TEXT = 'That file is over 5 MB, which is more than I can read. Paste the text here instead.';
const PDF_UNREADABLE_TEXT = 'I could not read that PDF. It may be password-protected or damaged. Paste the text here instead.';
const PDF_NO_TEXT = 'I could not find any text in that PDF. It may be a scanned image. Paste the text here instead.';
const TEXT_FILE_EMPTY = 'That file is empty. Paste the text here instead.';
const NOT_PLAIN_TEXT = 'That file does not look like plain text. Send it as a PDF, or paste the text here instead.';

export function truncatedFileNotice(): string {
    return `That file is long, so I read the first ${TELEGRAM_FILE_TEXT_MAX.toLocaleString('en-US')} characters.`;
}

// ───────────────────────────────────────────────────────────── reading

/**
 * A download that failed on Telegram's side or ours, not because of the file.
 * Thrown, so the agent reports it as our failure (the user is told to try
 * again, the operators are alerted) instead of blaming the file.
 */
export class TelegramFileError extends Error {
    constructor(detail: string) {
        super(`Could not download a Telegram file: ${detail}`);
        this.name = 'TelegramFileError';
    }
}

function documentFormat(document: TelegramDocument): 'pdf' | 'text' | null {
    const mime = (document.mime_type ?? '').toLowerCase();
    const name = (document.file_name ?? '').toLowerCase();
    if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (mime === 'text/plain' || mime === 'text/markdown' || mime === 'text/x-markdown') return 'text';
    if (/\.(txt|md|markdown)$/.test(name)) return 'text';
    return null;
}

export function classifyTelegramAttachment(message: TelegramMediaMessage): TelegramAttachment {
    if (message.document) {
        const format = documentFormat(message.document);
        return format ? { kind: 'readable', document: message.document, format } : { kind: 'unreadable' };
    }
    const media = [message.photo, message.video, message.video_note, message.audio, message.voice];
    return media.some((field) => field !== undefined) ? { kind: 'unreadable' } : { kind: 'none' };
}

export type FileRead =
    | { ok: true; text: string; truncated: boolean }
    /** A problem with the file itself; `reply` says what to do instead. */
    | { ok: false; reply: string };

/**
 * pdf.js names its errors; these mean the file, not our code, is the problem.
 * Anything else (the module failing to load, a TypeError) is ours and is
 * rethrown, so it reaches the operators instead of being blamed on the file.
 */
const UNREADABLE_PDF_ERRORS = new Set(['InvalidPDFException', 'PasswordException', 'MissingPDFException', 'FormatError']);

function isUnreadablePdf(error: unknown): boolean {
    return error instanceof Error && UNREADABLE_PDF_ERRORS.has(error.name);
}

function normalize(text: string): string {
    return text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Cut at the cap, back to the last whitespace when one is close, so no word is split. */
function cap(text: string): { text: string; truncated: boolean } {
    if (text.length <= TELEGRAM_FILE_TEXT_MAX) return { text, truncated: false };
    const cut = text.slice(0, TELEGRAM_FILE_TEXT_MAX);
    const space = cut.search(/\s\S*$/);
    return { text: (space > TELEGRAM_FILE_TEXT_MAX - 200 ? cut.slice(0, space) : cut).trimEnd(), truncated: true };
}

/**
 * Download a readable document and extract its text, capped at
 * TELEGRAM_FILE_TEXT_MAX. Throws TelegramFileError when the download fails,
 * and rethrows any parser error that is not about the file.
 */
export async function readTelegramDocument(attachment: { document: TelegramDocument; format: 'pdf' | 'text' }): Promise<FileRead> {
    const { document, format } = attachment;
    if ((document.file_size ?? 0) > TELEGRAM_FILE_MAX_BYTES) return { ok: false, reply: FILE_TOO_LARGE_TEXT };

    const downloaded = await downloadTelegramFile(document.file_id, TELEGRAM_FILE_MAX_BYTES);
    if (!downloaded.ok) {
        if (downloaded.reason === 'too_large') return { ok: false, reply: FILE_TOO_LARGE_TEXT };
        throw new TelegramFileError(downloaded.detail);
    }

    let raw: string;
    if (format === 'pdf') {
        try {
            raw = await extractTextFromPdf(downloaded.bytes);
        } catch (error: unknown) {
            if (isUnreadablePdf(error)) return { ok: false, reply: PDF_UNREADABLE_TEXT };
            throw error;
        }
    } else {
        // A NUL byte never appears in text; it does in a renamed binary.
        if (downloaded.bytes.includes(0)) return { ok: false, reply: NOT_PLAIN_TEXT };
        raw = new TextDecoder('utf-8').decode(downloaded.bytes);
    }

    const text = normalize(raw);
    if (!text) return { ok: false, reply: format === 'pdf' ? PDF_NO_TEXT : TEXT_FILE_EMPTY };
    return { ok: true, ...cap(text) };
}

/** What the user is taken to have sent: the caption, a blank line, the file's text. */
export function composeFileText(caption: string | undefined, text: string): string {
    return [caption?.trim(), text].filter(Boolean).join('\n\n');
}
