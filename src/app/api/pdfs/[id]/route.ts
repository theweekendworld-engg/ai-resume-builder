import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readStoredPdf } from '@/lib/pdfStorage';
import { config } from '@/lib/config';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'PDF id required' }, { status: 400 });
    }

    const pdf = await prisma.generatedPdf.findFirst({
      where: { id, userId },
      select: { blobKey: true, blobUrl: true },
    });

    if (!pdf) {
      return NextResponse.json({ error: 'PDF not found' }, { status: 404 });
    }

    if (config.pdfStorage.mode === 'local') {
      const buffer = await readStoredPdf(pdf.blobKey);
      if (!buffer) {
        return NextResponse.json({ error: 'PDF file not found' }, { status: 404 });
      }
      const filename = `resume.pdf`;
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(buffer.byteLength),
        },
      });
    }

    if (pdf.blobUrl.startsWith('http://') || pdf.blobUrl.startsWith('https://')) {
      return NextResponse.redirect(pdf.blobUrl);
    }

    return NextResponse.json({ error: 'Download not available' }, { status: 501 });
  } catch (error) {
    console.error('PDF download error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Download failed' },
      { status: 500 }
    );
  }
}
