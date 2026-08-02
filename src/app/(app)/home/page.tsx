import { notFound } from 'next/navigation';

import { getHome } from '@/actions/missions';
import { HomeScreen } from '@/components/missions/HomeScreen';

export const metadata = {
    title: 'Home · Patronus',
};

/**
 * `/home` — the mission surface (PRD 05 §5.2).
 *
 * Not `/`, which is the marketing page. The five-item IA in §5.2 renames this
 * to "Home" in the navigation; moving the authenticated app off `/dashboard`
 * wholesale is a separate change and would break every existing link, so the
 * route arrives first and the nav follows.
 *
 * `getHome` gates on the flag itself and evaluates the mission as a side
 * effect — one of the three triggers §6.1 names — so the card is never stale.
 */
export default async function HomePage() {
    const result = await getHome();
    if (!result.success) notFound();

    return <HomeScreen initial={result.data} />;
}
