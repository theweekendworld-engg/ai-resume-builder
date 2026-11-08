import { notFound } from 'next/navigation';

import { AppShell, type NavDestination } from '@/components/app/AppNav';
import { OverviewScreen } from '@/components/overview/OverviewScreen';
import { overviewFixture } from '@/components/overview/overview.fixtures';

/**
 * `/dev/patterns/home` — Home, mocked, inside the real app shell.
 *
 * Dev-only, like the gallery. Authed pages cannot be signed into from a
 * headless browser, so this is where the Dossier Home is reviewed and
 * screenshotted. `?theme=dark` renders the dark palette, `?state=new` a
 * brand-new account, `?chat=1` the chat-first variant with the ask bar.
 */
export const metadata = {
    title: 'Home (mock) · Patronus',
    robots: { index: false, follow: false },
};

const ALL: NavDestination[] = ['overview', 'chat', 'home', 'log', 'scout', 'watch', 'resumes', 'packets', 'radar'];

export default async function MockHomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
    if (process.env.NODE_ENV === 'production') notFound();
    const params = await searchParams;
    const dark = params.theme === 'dark';
    return (
        <div className={dark ? 'dark min-h-screen bg-background text-foreground' : 'min-h-screen bg-background text-foreground'}>
            <AppShell destinations={ALL} pathnameOverride="/overview">
                <OverviewScreen data={overviewFixture(new Date(), params.state === 'new' ? 'new' : 'active')} chat={params.chat === '1'} />
            </AppShell>
        </div>
    );
}
