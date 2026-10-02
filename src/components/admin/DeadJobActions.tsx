'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { resolveDeadJob } from '@/actions/admin';

/** Retry or discard one dead job. Both are audited. */
export function DeadJobActions({ jobId }: { jobId: string }) {
    const router = useRouter();
    const [busy, setBusy] = React.useState(false);
    const go = async (op: 'retry' | 'discard') => {
        setBusy(true);
        const result = await resolveDeadJob({ jobId, op });
        setBusy(false);
        if (!result.success) toast.error(result.error ?? 'Failed');
        else {
            toast.success(op === 'retry' ? 'Requeued; it runs on the next drain.' : 'Discarded.');
            router.refresh();
        }
    };
    return (
        <span className="flex gap-1">
            <button type="button" disabled={busy} onClick={() => void go('retry')} className="rounded border border-border px-2 py-0.5 text-xs">Retry</button>
            <button type="button" disabled={busy} onClick={() => void go('discard')} className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">Discard</button>
        </span>
    );
}
