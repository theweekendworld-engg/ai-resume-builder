import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { Globe, Puzzle, Terminal } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TelegramSection } from '@/components/dashboard/sections/TelegramSection';
import { WhatsAppSection } from '@/components/dashboard/sections/WhatsAppSection';
import { ExtensionDevices } from '@/components/settings/ExtensionDevices';
import { isEnabled } from '@/lib/flags';

export const metadata = { title: 'Channels · Patronus' };

/**
 * `/settings/channels`: every place you can talk to Patronus, in one page.
 * Linking used to live under the Resumes dashboard as "Telegram" (launch
 * audit 2026-10-02), which nobody looking for "WhatsApp" or "the bot" found.
 */
export default async function ChannelsPage() {
    const { userId } = await auth();
    if (!userId) notFound();
    const chat = await isEnabled(userId, 'chat');

    return (
        <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
            <header>
                <h1 className="font-heading text-2xl font-semibold tracking-tight">Channels</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Talk to Patronus wherever you are. Everything you send lands in the same record.
                </p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Globe className="size-4" aria-hidden /> Web</CardTitle>
                    <CardDescription>Chat with Patronus here: check a job, log a win, tailor a resume.</CardDescription>
                </CardHeader>
                <CardContent>
                    {chat ? (
                        <Link href="/chat" className="text-sm font-medium text-primary hover:underline">Open chat</Link>
                    ) : (
                        <p className="text-sm text-muted-foreground">Web chat is not switched on for your account yet.</p>
                    )}
                </CardContent>
            </Card>

            <TelegramSection />
            <WhatsAppSection />

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Puzzle className="size-4" aria-hidden /> Browser extension</CardTitle>
                    <CardDescription>Save jobs and posts from LinkedIn, and fill applications, without leaving the page.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ExtensionDevices />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Terminal className="size-4" aria-hidden /> Command line</CardTitle>
                    <CardDescription>Log work and check jobs from your terminal with the Patronus CLI.</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">Coming soon.</p>
                </CardContent>
            </Card>
        </div>
    );
}
