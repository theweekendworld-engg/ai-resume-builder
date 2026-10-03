import { BookOpen, Briefcase, Building2, History, NotebookPen, type LucideIcon } from 'lucide-react';

import { PageBody, PageHeader, PageTabs } from '@/components/patterns';
import type { CompanyItem, InboxCounts, InsightItem, JobBoardItem, NoteItem } from '@/lib/inbox/types';
import type { ScoutRunSummary } from '@/lib/scout/types';

import { ActivityList } from './ActivityList';
import { CompaniesTable } from './CompaniesTable';
import { InsightsShelf } from './InsightsShelf';
import { JobsBoard } from './JobsBoard';
import { NotesList } from './NotesList';
import { AddJobButton } from './AddJobButton';
import { INBOX_TABS, TAB_LABELS, tabHref, type InboxState, type InboxTab } from './params';

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
    const tabCount: Record<InboxTab, number | null> = {
        jobs: counts ? counts.toReview + counts.applied + counts.interviewing : null,
        insights: counts?.insights ?? null,
        companies: null,
        notes: counts?.draftNotes ?? null,
        activity: null,
    };

    return (
        <div>
            <PageHeader
                title="Jobs"
                description="Everything you share from chat, Telegram or the extension, scored against your record."
                actions={<AddJobButton />}
            >
                <PageTabs
                    label="Inbox sections"
                    active={state.tab}
                    tabs={INBOX_TABS.map((tab) => ({ key: tab, label: TAB_LABELS[tab], href: tabHref(tab), icon: TAB_ICON[tab], count: tabCount[tab] }))}
                />
            </PageHeader>

            <PageBody>
                {panelError ? (
                    <p className="mb-4 rounded-lg border border-warning/40 px-3 py-2 text-sm text-warning" role="alert">{panelError}</p>
                ) : null}
                {panel?.tab === 'jobs' ? <JobsBoard state={state} items={panel.items} /> : null}
                {panel?.tab === 'insights' ? <InsightsShelf state={state} items={panel.items} /> : null}
                {panel?.tab === 'companies' ? <CompaniesTable items={panel.items} /> : null}
                {panel?.tab === 'notes' ? <NotesList items={panel.items} /> : null}
                {panel?.tab === 'activity' ? <ActivityList runs={panel.items} /> : null}
            </PageBody>
        </div>
    );
}
