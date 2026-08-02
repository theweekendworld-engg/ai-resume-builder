import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getNotificationSettings } from '@/actions/digest';
import { NotificationsScreen } from '@/components/notifications/NotificationsScreen';

/**
 * `/settings/notifications` — design/02 §J2.
 *
 * Not flag-gated. Every email the product sends carries a "Change when you get
 * this" link that lands here, so the page has to work for anyone who has ever
 * received one — including a user whose `weekly_digest` flag was since turned
 * off. Gating it would send people from an email to a 404.
 */
export const metadata = {
    title: 'Notifications · Patronus',
};

export default async function NotificationsSettingsPage() {
    const { userId } = await auth();
    if (!userId) notFound();

    const settings = await getNotificationSettings();
    if (!settings.success) notFound();

    return <NotificationsScreen initial={settings.data} />;
}
