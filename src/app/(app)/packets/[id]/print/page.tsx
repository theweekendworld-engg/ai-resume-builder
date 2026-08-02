import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { getPacket, recordPdfExport } from '@/actions/packets';
import { PacketPrintDocument } from '@/components/packets/PacketPrintDocument';
import { PrintTrigger } from '@/components/packets/PrintTrigger';
import { isEnabled } from '@/lib/flags';

export const metadata = {
    title: 'Review packet · Patronus',
};

/**
 * `/packets/[id]/print` — the PDF.
 *
 * There is no PDF renderer here and that is the design. See the comment in
 * `PacketPrintDocument`: a packet can contain confidential wins, so it must
 * not be typeset by the third-party LaTeX service the resume path uses. The
 * browser's own print-to-PDF keeps the document on the user's machine.
 *
 * Same gate and same ownership check as the editor route — this renders the
 * full packet text, so it cannot be a laxer door into the same content.
 *
 * `?confidential=0` redacts. The default matches `exportPacket`: include for a
 * manager or committee, exclude when the packet is for the user themselves
 * (§3.3). Sending someone here without the parameter must not accidentally be
 * the permissive choice, which is why the default is derived from the
 * audience rather than hardcoded to `true`.
 */
export default async function PacketPrintPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ confidential?: string }>;
}) {
    const { userId } = await auth();
    if (!userId || !(await isEnabled(userId, 'review_packet'))) notFound();

    const [{ id }, query] = await Promise.all([params, searchParams]);

    const result = await getPacket(id);
    if (!result.success) notFound();
    const packet = result.data;

    // A packet still generating has nothing to print. Falling through would
    // render an empty sheet and auto-open a print dialog over it.
    if (!packet.content || packet.status === 'generating') notFound();

    const includeConfidential =
        query.confidential === undefined
            ? packet.audience !== 'self'
            : query.confidential === '1';

    // Opening this view IS the export; record it before painting so a user who
    // prints and closes the tab still shows up in the history.
    await recordPdfExport(packet.id, includeConfidential);

    return (
        <>
            <PrintTrigger />
            <PacketPrintDocument
                content={packet.content}
                wins={packet.wins}
                includeConfidential={includeConfidential}
            />
        </>
    );
}
