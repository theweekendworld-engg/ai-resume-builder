import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getEnabledFlags } from '@/lib/flags';

import { getChatThread } from '@/actions/chat';
import { ChatScreen } from '@/components/chat/ChatScreen';
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
    const flags = userId ? await getEnabledFlags(userId) : null;
    return <ChatScreen initial={result.data} links={{ scout: Boolean(flags?.scout), workLog: Boolean(flags?.work_log) }} />;
}
