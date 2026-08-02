import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { listPackets } from '@/actions/packets';
import { PacketList } from '@/components/packets/PacketList';
import { isEnabled } from '@/lib/flags';

export const metadata = {
    title: 'Review packets · Patronus',
};

export default async function PacketsPage() {
    // Flag-gated (ADR-7): invisible until `review_packet` is switched on.
    const { userId } = await auth();
    if (!userId || !(await isEnabled(userId, 'review_packet'))) notFound();

    const result = await listPackets();
    return <PacketList packets={result.success ? result.data : []} />;
}
