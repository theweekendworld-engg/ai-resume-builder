'use client';

import Link from 'next/link';
import { Info, Lock, TriangleAlert } from 'lucide-react';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { launchOpenAccess } from '@/lib/plans';
import { cn } from '@/lib/utils';

/**
 * An action came back refused. When the reason is the plan, the message names
 * the fix — the plans page — rather than leaving a dead end. Inline and
 * dismissible by doing anything else, never a modal (PRD 06 §4).
 *
 * During the launch every feature is open to everyone, so there is no plan
 * to point at: a refusal is the monthly cost ceiling, and its message already
 * says when it resets. No lock, no "See plans" (`launchOpenAccess`). A client
 * bundle reads the launch default; a server caller can pass the real value.
 */
export function EntitlementNotice({
    message,
    entitlement,
    launchOpen = launchOpenAccess(),
}: {
    message: string;
    entitlement: boolean;
    launchOpen?: boolean;
}) {
    const planGated = entitlement && !launchOpen;
    const Icon = planGated ? Lock : entitlement ? Info : TriangleAlert;
    return (
        <section
            role="status"
            className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
        >
            <p className={cn(typeStyles.small, 'flex items-start gap-2', entitlement ? 'text-foreground' : 'text-warning')}>
                <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {message}
            </p>
            {planGated ? (
                <Button asChild size="sm" className="shrink-0 self-start sm:self-auto">
                    <Link href="/settings/plan">See plans</Link>
                </Button>
            ) : null}
        </section>
    );
}
