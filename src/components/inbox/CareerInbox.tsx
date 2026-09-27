import Link from 'next/link';
import { BookOpen, Briefcase, Building2, History, NotebookPen, type LucideIcon } from 'lucide-react';

import { typeStyles, focusRing } from '@/components/patterns';
import { cn } from '@/lib/utils';
import type { CompanyItem, InboxCounts, InsightItem, JobBoardItem, NoteItem } from '@/lib/inbox/types';
import type { ScoutRunSummary } from '@/lib/scout/types';

import { ActivityList } from './ActivityList';
import { CompaniesTable } from './CompaniesTable';
import { InsightsShelf } from './InsightsShelf';
import { JobsBoard } from './JobsBoard';
import { NotesList } from './NotesList';
import { INBOX_TABS, pipelineSummary, tabHref, tabLabel, type InboxState, type InboxTab } from './params';
import { PasteBox } from './PasteBox';

const TAB_ICON: Record<InboxTab, LucideIcon> = {
    jobs: Briefcase,
    insights: BookOpen,
    companies: Building2,
    notes: NotebookPen,
    activity: History,
};

export type InboxPanelData =
    | { tab: 'jobs'; items: JobBoardItem[] }
    | { tab: 'insights'; items: InsightItem[] }
    | { tab: 'companies'; items: CompanyItem[] }
    | { tab: 'notes'; items: NoteItem[] }
    | { tab: 'activity'; items: ScoutRunSummary[] };

/**
 * `/scout` — the career inbox. Everything shared from any channel, arranged:
 * jobs on a board by status and fit, insights on a shelf, companies derived
 * from both, notes on their way into the Work Log, and the raw activity feed.
 *
 * Tabs are links (`?tab=`), not client state: a tab is a place you can send
 * someone, and the back button should leave it.
 */
export function CareerInbox({
    state,
    counts,
    panel,
    panelError,
}: {
    state: InboxState;
    counts: InboxCounts | null;
    panel: InboxPanelData | null;
    panelError: string | null;
}) {
    const summary = pipelineSummary(counts);

    return (
        <div className={cn('mx-auto w-full px-4 py-8 sm:py-10', state.tab === 'jobs' ? 'max-w-[1200px]' : 'max-w-[860px]')}>
            <header className="flex flex-col gap-1">
                <h1 className={cn(typeStyles.h1, 'text-foreground')}>Inbox</h1>
                <p className={cn(typeStyles.body, 'text-muted-foreground')}>
                    Everything you share from Telegram or here: jobs scored against your record,
                    posts worth keeping, and notes on their way into your Work Log.
                </p>
                {summary ? <p className={cn(typeStyles.small, 'num text-foreground')}>{summary}</p> : null}
            </header>

            <div className="mt-6 max-w-[760px]">
                <PasteBox />
            </div>

            <nav aria-label="Inbox sections" className="mt-8 border-b border-border">
                <ul className="-mb-px flex gap-1 overflow-x-auto">
                    {INBOX_TABS.map((tab) => {
                        const Icon = TAB_ICON[tab];
                        const active = state.tab === tab;
                        return (
                            <li key={tab} className="shrink-0">
                                <Link
                                    href={tabHref(tab)}
                                    aria-current={active ? 'page' : undefined}
                                    className={cn(
                                        typeStyles.small,
                                        focusRing,
                                        'num inline-flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2',
                                        active
                                            ? 'border-primary font-medium text-foreground'
                                            : 'border-transparent text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    <Icon aria-hidden className="size-3.5" strokeWidth={1.5} />
                                    {tabLabel(tab, counts)}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            <div className="mt-6">
                {panelError ? (
                    <p className={cn(typeStyles.small, 'text-warning')} role="alert">{panelError}</p>
                ) : null}
                {panel?.tab === 'jobs' ? <JobsBoard state={state} items={panel.items} /> : null}
                {panel?.tab === 'insights' ? <InsightsShelf state={state} items={panel.items} /> : null}
                {panel?.tab === 'companies' ? <CompaniesTable items={panel.items} /> : null}
                {panel?.tab === 'notes' ? <NotesList items={panel.items} /> : null}
                {panel?.tab === 'activity' ? <ActivityList runs={panel.items} /> : null}
            </div>
        </div>
    );
}
