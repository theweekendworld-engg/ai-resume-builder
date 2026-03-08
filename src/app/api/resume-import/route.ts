import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { parseResumeFromPdf } from '@/lib/resumeParser';

const MAX_FILE_SIZE = Number(process.env.RESUME_IMPORT_MAX_FILE_SIZE_KB ?? 5000) * 1024;

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
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

    if (!file || typeof file === 'string') {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json(
        { success: false, error: 'Only PDF files are supported' },
        { status: 400 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { success: false, error: 'File is empty. Please upload a valid PDF.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: `File exceeds ${MAX_FILE_SIZE / 1024}KB limit` },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const parsed = await parseResumeFromPdf(buffer, userId);
    return NextResponse.json({ success: true, data: parsed });
  } catch (error: unknown) {
    console.error('Resume import error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to parse resume',
      },
      { status: 500 }
    );
  }
}
