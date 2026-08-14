'use client';

import * as React from 'react';
import { Lock, Sparkles, TriangleAlert } from 'lucide-react';

import { CATEGORY_META, typeStyles, duration, easing } from '@/components/patterns';
import { usePrefersReducedMotion } from '@/components/patterns';
import { cn } from '@/lib/utils';

import type { CapturedWinView } from './types';

/**
 * CAPTURED SO FAR — design/02 §I.
 *
 * The right rail is the product. A backfill interview that is only a chat feels
 * like a form and gets abandoned around question five; watching the record fill
 * is what makes people finish, and completion rate is the metric the whole
 * feature is tuned against (PRD 07 §7).
 *
 * So: cards enter, they enter fast, and nothing here can be slower than the
 * answer that produced it. The list is append-only within a session — a card
 * that appears and then vanishes would undo exactly the reassurance it exists
 * to give.
 */

export interface CaptureRailProps {
    wins: CapturedWinView[];
    /** Ids captured on the most recent turn; these get the entrance treatment. */
    freshIds?: string[];
    className?: string;
}

export function CaptureRail({ wins, freshIds = [], className }: CaptureRailProps) {
    const fresh = React.useMemo(() => new Set(freshIds), [freshIds]);
    const quantified = wins.filter((win) => win.quantified).length;

    return (
        <aside
            className={cn('flex flex-col gap-4', className)}
            aria-label="Captured so far"
        >
            <header className="flex items-baseline justify-between border-b border-border pb-2">
                <h2 className={cn(typeStyles.caption, 'uppercase text-muted-foreground')}>
                    Captured so far
                </h2>
                <span
                    className={cn(typeStyles.h2, 'tabular-nums')}
                    aria-live="polite"
                    aria-atomic="true"
                >
                    {wins.length}
                </span>
            </header>

            {wins.length === 0 ? (
                <p className={cn(typeStyles.small, 'text-muted-foreground')}>
                    What you describe lands here as you talk. Nothing is saved to your resume until
                    you review it.
                </p>
            ) : (
                <>
                    <ol className="flex flex-col gap-2" role="list">
                        {wins.map((win) => (
                            <CaptureCard key={win.winId} win={win} fresh={fresh.has(win.winId)} />
                        ))}
                    </ol>
                    {quantified > 0 ? (
                        <p className={cn(typeStyles.caption, 'text-muted-foreground')}>
                            {quantified} of {wins.length} carry a number you gave.
                        </p>
                    ) : null}
                </>
            )}
        </aside>
    );
}

function CaptureCard({ win, fresh }: { win: CapturedWinView; fresh: boolean }) {
    const reduced = usePrefersReducedMotion();
    const [entered, setEntered] = React.useState(!fresh || reduced);
    const meta = CATEGORY_META[win.category];
    const Icon = meta?.icon;

    React.useEffect(() => {
        if (entered) return;
        const frame = requestAnimationFrame(() => setEntered(true));
        return () => cancelAnimationFrame(frame);
    }, [entered]);

    return (
        <li
            className={cn(
                'surface-work rounded-lg border border-border px-3 py-2.5',
                'transition-[opacity,transform]',
                entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1',
            )}
            style={{
                transitionDuration: `${reduced ? 0 : duration.state}ms`,
                transitionTimingFunction: easing.state,
            }}
        >
            <div className="flex items-start gap-2">
                {Icon ? (
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : null}
                <p className={cn(typeStyles.body, 'flex-1 text-foreground')}>{win.title}</p>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6">
                {win.quantified && win.metricLabel ? (
                    <span
                        className={cn(typeStyles.caption, 'inline-flex items-center gap-1 text-foreground')}
                    >
                        <Sparkles className="size-3" aria-hidden="true" />
                        {win.metricLabel}
                    </span>
                ) : (
                    <span
                        className={cn(
                            typeStyles.caption,
                            'inline-flex items-center gap-1 text-muted-foreground',
                        )}
                    >
                        <TriangleAlert className="size-3" aria-hidden="true" />
                        needs a number
                    </span>
                )}

                {win.sensitivity !== 'shareable' ? (
                    <span
                        className={cn(
                            typeStyles.caption,
                            'inline-flex items-center gap-1 text-muted-foreground',
                        )}
                    >
                        <Lock className="size-3" aria-hidden="true" />
                        {win.sensitivity === 'confidential' ? 'confidential' : 'internal only'}
                    </span>
                ) : null}
            </div>
        </li>
    );
}
