'use client';

import * as React from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { updateJobStatus } from '@/actions/inbox';
import {
    COLUMN_LABELS,
    COLUMN_OF_STATUS,
    JOB_ACTION_LABELS,
    JOB_ACTION_STATUS,
    JOB_ACTIONS,
    type JobAction,
    type JobBoardItem,
} from '@/lib/inbox/types';
import type { TrackedStatus } from '@/lib/scout/types';

/** The action a status corresponds to, for the check mark. */
export function actionOfStatus(status: TrackedStatus): JobAction | null {
    for (const action of JOB_ACTIONS) {
        if (JOB_ACTION_STATUS[action] === status) return action;
    }
    return null;
}

/**
 * Move a job along the tracker. Identified by workspace (board cards) or by
 * Scout run (the run page, which knows the run before it knows the row).
 *
 * Optimistic: the label changes on click, and reverts with the error if the
 * server refuses. The board re-sorts on the next render the caller triggers.
 */
export function JobStatusMenu({
    target,
    status,
    onChanged,
    size = 'sm',
    className,
}: {
    target: { workspaceId: string } | { runId: string };
    status: TrackedStatus;
    onChanged?: (item: JobBoardItem) => void;
    size?: 'sm' | 'xs';
    className?: string;
}) {
    const [current, setCurrent] = React.useState<TrackedStatus>(status);
    const [pending, setPending] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => setCurrent(status), [status]);

    const choose = async (action: JobAction) => {
        const previous = current;
        setCurrent(JOB_ACTION_STATUS[action]);
        setPending(true);
        setError(null);
        const result = await updateJobStatus({ ...target, action });
        setPending(false);
        if (!result.success) {
            setCurrent(previous);
            setError(result.error);
            return;
        }
        setCurrent(result.data.status);
        onChanged?.(result.data);
    };

    const active = actionOfStatus(current);
    const label = active ? JOB_ACTION_LABELS[active] : COLUMN_LABELS[COLUMN_OF_STATUS[current]];

    return (
        <div className={cn('inline-flex flex-col items-start gap-1', className)}>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn('gap-1.5', size === 'xs' ? 'h-7 px-2 text-xs' : '')}
                        disabled={pending}
                        aria-label={`Status: ${label}. Change status`}
                    >
                        {pending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null}
                        {label}
                        <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuLabel className={typeStyles.caption}>Move to</DropdownMenuLabel>
                    {JOB_ACTIONS.map((action) => (
                        <DropdownMenuItem key={action} onSelect={() => void choose(action)} className="gap-2">
                            <Check aria-hidden className={cn('size-3.5', action === active ? 'opacity-100' : 'opacity-0')} />
                            {JOB_ACTION_LABELS[action]}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
            {error ? <p className={cn(typeStyles.caption, 'text-warning')} role="alert">{error}</p> : null}
        </div>
    );
}
