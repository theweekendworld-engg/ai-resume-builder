'use client';

import Link from 'next/link';
import { Lock, TriangleAlert } from 'lucide-react';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * An action came back refused. When the reason is the plan, the message names
 * the fix — the plans page — rather than leaving a dead end. Inline and
 * dismissible by doing anything else, never a modal (PRD 06 §4).
 */
export function EntitlementNotice({ message, entitlement }: { message: string; entitlement: boolean }) {
    const Icon = entitlement ? Lock : TriangleAlert;
    return (
        <section
            role="status"
            className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
        >
            <p className={cn(typeStyles.small, 'flex items-start gap-2', entitlement ? 'text-foreground' : 'text-warning')}>
                <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {message}
            </p>
            {entitlement ? (
                <Button asChild size="sm" className="shrink-0 self-start sm:self-auto">
                    <Link href="/settings/plan">See plans</Link>
                </Button>
            ) : null}
        </section>
    );
}
