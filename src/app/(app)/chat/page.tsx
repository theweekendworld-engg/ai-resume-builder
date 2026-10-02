import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getEnabledFlags } from '@/lib/flags';

import { getChatThread } from '@/actions/chat';
import { ChatScreen } from '@/components/chat/ChatScreen';
import { ChatRail } from '@/components/chat/ChatRail';
import { getChatRail } from '@/services/chat';
import { prisma } from '@/lib/prisma';
import { FeatureUnavailable } from '@/components/app/FeatureUnavailable';

export const metadata = {
    title: 'Chat · Patronus',
};

/**
 * `/chat` — the front door (docs/prd/10-chat.md). Flag-gated like every R2
 * surface: a stranger gets a 404, a signed-in customer is told it is coming.
 */
export default async function ChatPage() {
    const result = await getChatThread();
    if (!result.success) {
        if (result.code === 'unauthenticated') notFound();
        if (result.code === 'not_available') {
            return (
                <FeatureUnavailable
                    feature="Chat"
                    blurb="Talk to Patronus: check a job, log what you shipped, tailor a resume or research a company, all in one place. It is being switched on in stages."
                    reason="not_enabled"
                />
            );
        }
        return <FeatureUnavailable feature="Chat" reason="error" />;
    }
    const { userId } = await auth();
    if (!userId) notFound();
    const flags = await getEnabledFlags(userId);
    const [rail, profile] = await Promise.all([
        getChatRail(userId, { missions: flags.missions, scout: flags.scout }),
        prisma.userProfile.findUnique({ where: { userId }, select: { fullName: true } }),
    ]);
    const links = { scout: flags.scout, workLog: flags.work_log };
    return (
        <div className="flex">
            <div className="min-w-0 flex-1">
                <ChatScreen initial={result.data} links={links} name={profile?.fullName?.trim().split(/\s+/)[0] || null} />
            </div>
            <ChatRail rail={rail} links={{ ...links, goals: flags.missions }} />
        </div>
    );
}
