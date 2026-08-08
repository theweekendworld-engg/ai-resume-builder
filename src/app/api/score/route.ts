import { NextRequest, NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';
import { checkAnonScoreRateLimit } from '@/lib/rateLimit';
import { scoreResumeText } from '@/lib/anonScore';
import { extractDocxText } from '@/lib/docxParser';

export const runtime = 'nodejs';
/*
 * The measured p95 is what sets this, not a round number.
 *
 * A live run of a two-page resume against a full posting took 53 seconds
 * against a 60-second ceiling. A slightly longer resume times out, and a
 * stranger's first impression of the product is a 504 — on the one surface
 * the whole funnel depends on.
 */
export const maxDuration = 120;

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_JD_CHARS = 6000;
const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ACCEPTED_MIMES = new Set<string>([PDF_MIME, DOCX_MIME]);

function getClientIp(req: NextRequest): string {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) {
        const firstHop = forwarded.split(',')[0]?.trim();
        if (firstHop) return firstHop;
    }
    return req.headers.get('x-real-ip')?.trim() || 'anonymous';
}

async function extractPdfText(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer });
    try {
        const result = await parser.getText();
        return result.text ?? '';
    } finally {
        // Free pdfjs resources; the buffer is never persisted.
        await parser.destroy();
    }
}

export async function POST(req: NextRequest) {
    try {
        const ip = getClientIp(req);
        const rate = await checkAnonScoreRateLimit(ip);
        if (!rate.allowed) {
            return NextResponse.json({ success: false, error: rate.error }, { status: 429 });
        }

        const contentType = req.headers.get('content-type') ?? '';
        if (!contentType.includes('multipart/form-data')) {
            return NextResponse.json(
                { success: false, error: 'Expected multipart/form-data' },
                { status: 400 }
            );
        }

        const formData = await req.formData();
        const file = formData.get('file');
        const jobDescriptionRaw = formData.get('jobDescription');
        const jobDescription =
            typeof jobDescriptionRaw === 'string' && jobDescriptionRaw.trim()
                ? jobDescriptionRaw.slice(0, MAX_JD_CHARS)
                : undefined;

        if (!file || typeof file === 'string') {
            return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
        }

        if (!ACCEPTED_MIMES.has(file.type)) {
            return NextResponse.json(
                { success: false, error: 'Only PDF and DOCX files are supported' },
                { status: 400 }
            );
        }

        if (file.size === 0) {
            return NextResponse.json(
                { success: false, error: 'File is empty. Please upload a valid PDF or DOCX.' },
                { status: 400 }
            );
        }

        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json(
                { success: false, error: 'File exceeds the 2MB limit.' },
                { status: 400 }
            );
        }

        // Parse in memory, score, return, discard. Nothing is persisted.
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const isPdf = file.type === PDF_MIME;
        const fileLabel = isPdf ? 'PDF' : 'DOCX';

        let extractedText: string;
        try {
            extractedText = isPdf
                ? await extractPdfText(buffer)
                : await extractDocxText(buffer);
        } catch (err) {
            console.error(`Anon score ${fileLabel} parse error:`, err);
            return NextResponse.json(
                { success: false, error: `Could not read that ${fileLabel}. Please try a different file.` },
                { status: 422 }
            );
        }

        if (!extractedText || extractedText.trim().length < 30) {
            const hint = isPdf
                ? 'We could not extract text from that PDF. It may be a scanned image. Try a text-based PDF.'
                : 'We could not extract text from that DOCX. The file may be empty or password-protected.';
            return NextResponse.json(
                { success: false, error: hint },
                { status: 422 }
            );
        }

        const report = await scoreResumeText(extractedText, jobDescription);

        return NextResponse.json({
            success: true,
            report,
            extractedText,
        });
    } catch (error: unknown) {
        console.error('Anon score error:', error);
        const message =
            error instanceof Error && error.message
                ? error.message
                : 'Something went wrong while scoring your resume.';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
