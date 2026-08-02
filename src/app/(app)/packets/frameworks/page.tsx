import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { listFrameworkOptions } from '@/actions/packets';
import { RubricUploadScreen } from '@/components/packets/RubricUploadScreen';
import { isEnabled } from '@/lib/flags';

export const metadata = {
    title: 'Leveling frameworks · Patronus',
};

export default async function FrameworksPage() {
    const { userId } = await auth();
    if (!userId || !(await isEnabled(userId, 'review_packet'))) notFound();

    const result = await listFrameworkOptions();
    return <RubricUploadScreen frameworks={result.success ? result.data : []} />;
}
