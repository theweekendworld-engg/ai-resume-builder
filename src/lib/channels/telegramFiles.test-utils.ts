/**
 * Test helpers for files sent to the Telegram bot: a real PDF to parse, and a
 * transport that serves Telegram's `getFile` and file download.
 */

import { __testing as telegramTesting } from '@/lib/telegram';

/** A one-page PDF with real text objects, so pdf.js has something to extract. */
export function minimalPdf(lines: string[]): Buffer {
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const stream = ['BT', '/F1 12 Tf', '72 720 Td', ...lines.map((line, i) => `${i ? '0 -16 Td ' : ''}(${esc(line)}) Tj`), 'ET'].join('\n');
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
        offsets.push(Buffer.byteLength(out));
        out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out);
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}

export type ServedFile = {
    bytes?: Uint8Array;
    /** The whole `getFile` response, when the default (ok, with a path) is not wanted. */
    getFile?: Record<string, unknown>;
    fileStatus?: number;
    headers?: Record<string, string>;
    throwOn?: 'getFile' | 'file';
};

type Fetch = NonNullable<Parameters<typeof telegramTesting.setFetch>[0]>;

/**
 * Install a transport serving `getFile` and the download. Any other Bot API
 * call goes to `fallback` (the MockTelegram transport, in agent tests).
 * Returns the URLs asked for, in order.
 */
export function serveTelegramFile(served: ServedFile, fallback?: Fetch): string[] {
    const urls: string[] = [];
    telegramTesting.setFetch(async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/getFile')) {
            urls.push(url);
            if (served.throwOn === 'getFile') throw new Error(`connect ECONNREFUSED ${url}`);
            return Response.json(served.getFile ?? { ok: true, result: { file_id: 'f1', file_path: 'documents/file_1.pdf', file_size: served.bytes?.length } });
        }
        if (url.includes('/file/bot')) {
            urls.push(url);
            if (served.throwOn === 'file') throw new Error(`socket hang up at ${url}`);
            return new Response(new Uint8Array(served.bytes ?? []), { status: served.fileStatus ?? 200, headers: served.headers });
        }
        if (fallback) return fallback(input, init);
        throw new Error(`unexpected fetch ${url}`);
    });
    return urls;
}
