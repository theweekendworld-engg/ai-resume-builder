import { notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { getPacket } from '@/actions/packets';
import { PacketEditor } from '@/components/packets/PacketEditor';
import { PacketProgressView } from '@/components/packets/PacketProgressView';
import { isEnabled } from '@/lib/flags';

export const metadata = {
    title: 'Review packet · Patronus',
};

/**
 * One route for the whole lifecycle (§F2 → §F3). The status lives in the
 * database, so a refresh mid-generation lands back on the progress screen with
 * the stages exactly where the workflow left them.
 */
export default async function PacketPage({ params }: { params: Promise<{ id: string }> }) {
    const { userId } = await auth();
    if (!userId || !(await isEnabled(userId, 'review_packet'))) notFound();

    const { id } = await params;
    const result = await getPacket(id);
    if (!result.success) notFound();
    const packet = result.data;

    if (packet.status === 'generating' || !packet.content) {
        if (packet.status === 'failed') {
            return (
                <div className="mx-auto w-full max-w-[520px] px-4 py-16 text-center">
                    <h1 className="font-heading text-[22px] font-semibold leading-[30px] text-foreground">
                        That run did not finish
                    </h1>
                    <p className="mt-2 text-sm leading-[22px] text-muted-foreground">
                        Your log is untouched — nothing was lost. Start another packet whenever you like.
                    </p>
                    <Link
                        href="/packets/new"
                        className="mt-4 inline-block text-sm text-primary underline-offset-2 hover:underline"
                    >
                        Try again
                    </Link>
                </div>
            );
        }
        return <PacketProgressView packetId={packet.id} initialProgress={packet.progress} />;
    }

    return <PacketEditor packet={packet} />;
}
