/**
 * Where each sidebar destination lives, and which pages light it up.
 *
 * Pure, so the route test can check it without rendering the shell (which
 * pulls in Clerk). `AppNav.tsx` adds the icons.
 *
 * Labels and routes disagree for history's sake: Home is /overview, Goals is
 * /home, Jobs is /scout, Resumes is /dashboard. The routes keep their names
 * because Telegram messages, emails and deep links point at them; the label
 * URLs (/jobs, /goals, /resumes) redirect to them (`next.config.ts`). So the
 * active state matches on the ROUTE, never on the label.
 */

export type NavDestination = 'overview' | 'chat' | 'home' | 'log' | 'resumes' | 'packets' | 'radar' | 'scout' | 'watch';

export const NAV_ROUTES: Record<NavDestination, { href: string; label: string }> = {
    // Everything on one screen: what needs you, the pipeline, the record.
    overview: { href: '/overview', label: 'Home' },
    chat: { href: '/chat', label: 'Chat' },
    // Missions: the goal you are working toward and its next step.
    home: { href: '/home', label: 'Goals' },
    log: { href: '/log', label: 'Work Log' },
    // The route stays /scout (links in chat messages point there).
    scout: { href: '/scout', label: 'Jobs' },
    watch: { href: '/watch', label: 'Job watch' },
    resumes: { href: '/dashboard', label: 'Resumes' },
    packets: { href: '/packets', label: 'Packets' },
    radar: { href: '/radar', label: 'Radar' },
};

export const SETTINGS_ROUTE = { href: '/settings', label: 'Settings' } as const;

/** Pages that belong to a destination without living under its URL. */
const ALSO_ACTIVE: Partial<Record<string, readonly string[]>> = {
    // The screens a resume is made on.
    '/dashboard': ['/editor', '/build'],
    // Clerk's account pages are part of Settings.
    '/settings': ['/account'],
};

function under(pathname: string, href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
}

/** Is the destination at `href` the page the user is on? */
export function isActive(pathname: string, href: string): boolean {
    return under(pathname, href) || (ALSO_ACTIVE[href] ?? []).some((prefix) => under(pathname, prefix));
}
