import { auth } from '@clerk/nextjs/server';
import { isEnabled } from '@/lib/flags';
import { deleteTranscriptTool, exportTranscriptTool } from '@/agents/tools/backfill';

/**
 * Transcript export and deletion — PRD 07 §5.4.
 *
 * Interview transcripts are the most sensitive rows in the product: people
 * disclose conflicts, failures and confidential work in them. Two obligations
 * follow, and this route is both of them.
 *
 * `GET` downloads the conversation. `DELETE` removes it *without* touching the
 * Wins it produced — deleting a conversation is not retracting the record it
 * built, and conflating the two would make people think twice before talking.
 */

async function gate(): Promise<{ userId: string } | Response> {
    const { userId } = await auth();
    if (!userId) return new Response('Unauthorized', { status: 401 });
    if (!(await isEnabled(userId, 'backfill'))) return new Response('Not found', { status: 404 });
    return { userId };
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ sessionId: string }> },
) {
    const gated = await gate();
    if (gated instanceof Response) return gated;

    const { sessionId } = await params;
    const result = await exportTranscriptTool({ userId: gated.userId, sessionId });
    if (!result.success) {
        return Response.json({ error: result.error }, { status: result.code === 'not_found' ? 404 : 400 });
    }

    const filename = `backfill-${result.data.subjectLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
    return new Response(JSON.stringify(result.data, null, 2), {
        headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
        },
    });
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ sessionId: string }> },
) {
    const gated = await gate();
    if (gated instanceof Response) return gated;

    const { sessionId } = await params;
    const result = await deleteTranscriptTool({ userId: gated.userId, sessionId });
    if (!result.success) {
        return Response.json({ error: result.error }, { status: result.code === 'not_found' ? 404 : 400 });
    }
    return Response.json(result.data);
}
