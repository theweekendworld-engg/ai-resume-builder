import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { EyebrowLink, PageBody, PageHeader } from '@/components/patterns';

import { MemoryPanel } from '@/components/settings/MemoryPanel';
import { listMemories } from '@/services/memory';

export const metadata = {
    title: 'Memory · Patronus',
};

/**
 * `/settings/memory` — what Patronus remembers you told it
 * (docs/impl/08-memory.md §6).
 *
 * Not flag-gated: memory changes what you are asked and what drafts may say,
 * and a privacy control must always be reachable. Reads the service directly,
 * as `/settings/resume` reads Prisma: `auth()` is the whole check, and every
 * write goes through `src/actions/memory.ts`.
 */
export default async function MemorySettingsPage() {
    const { userId } = await auth();
    if (!userId) notFound();

    const memories = await listMemories(userId);

    return (
        <div>
            <PageHeader
                eyebrow={<EyebrowLink href="/settings">Settings</EyebrowLink>}
                title="Memory"
                description="What you have told me, kept so I never ask the same thing twice. When a job asks about something here, I use your answer and say so. Each week new lines are tidied to the fewest words, and nothing is added. Private lines help me answer you but never go into a resume or a message."
            />
            <PageBody className="max-w-3xl space-y-6">

            <MemoryPanel
                initial={memories.map((memory) => ({
                    id: memory.id,
                    key: memory.key,
                    label: memory.label,
                    text: memory.text,
                    source: memory.source,
                    sensitivity: memory.sensitivity,
                    useCount: memory.useCount,
                    createdAt: memory.createdAt,
                }))}
            />
            </PageBody>
        </div>
    );
}
