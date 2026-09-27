import Link from 'next/link';
import { History } from 'lucide-react';

import { EmptyState, typeStyles } from '@/components/patterns';
import { KindIcon, RunStatusLabel } from '@/components/scout/parts';
import { relativeTime } from '@/components/scout/format';
import { cn } from '@/lib/utils';
import type { ScoutRunSummary } from '@/lib/scout/types';

/** Everything shared, newest first: the raw feed behind the other tabs. */
export function ActivityList({ runs }: { runs: ScoutRunSummary[] }) {
    if (runs.length === 0) {
        return (
            <EmptyState
                icon={History}
                title="Nothing shared yet"
                description="Most people share from their phone. Link Telegram, then send any LinkedIn link the moment you see it."
                action={{ label: 'Link a chat app', href: '/dashboard?section=telegram' }}
                secondary={{ label: 'Set your job-search preferences', href: '/settings/job-search' }}
            />
        );
    }
    return (
        <ul className="space-y-2">
            {runs.map((run) => (
                <li key={run.id}>
                    <Link
                        href={`/scout/${run.id}`}
                        className="surface-work flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:border-primary/40"
                    >
                        <KindIcon kind={run.kind} />
                        <div className="min-w-0 flex-1">
                            <p className={cn(typeStyles.h3, 'truncate text-foreground')}>{run.headline}</p>
                            <p className={cn(typeStyles.caption, 'text-muted-foreground')}>{relativeTime(run.createdAt)}</p>
                        </div>
                        <RunStatusLabel status={run.status} className="shrink-0" />
                    </Link>
                </li>
            ))}
        </ul>
    );
}
