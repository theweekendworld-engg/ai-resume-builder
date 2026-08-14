'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { typeStyles } from '@/components/patterns';
import { cn } from '@/lib/utils';

import { CaptureRail } from './CaptureRail';
import { backfillData } from './data-source';
import type { CapturedWinView } from './types';

/**
 * The closing screen — PRD 07 §4, design/02 §I.
 *
 * This is the payoff for ten minutes of work and the moment the user decides
 * whether to reconstruct their next employer, so every number on it is counted
 * from rows rather than estimated, and the before/after line is the whole
 * point: *"before this, your Acme record was 3 resume bullets."* Value that is
 * created but not perceived does not retain anyone (PRD 09 §4).
 *
 * "Review and confirm all" is a button the user presses. Nothing here confirms
 * anything on its own — every capture is still a draft (CLAUDE.md rule 5).
 */

export interface ClosingScreenProps {
    sessionId: string;
    captured: CapturedWinView[];
}

export function ClosingScreen({ sessionId, captured }: ClosingScreenProps) {
    const router = useRouter();
    const [lines, setLines] = React.useState<string[] | null>(null);
    const [wins, setWins] = React.useState<CapturedWinView[]>(captured);
    const [confirming, setConfirming] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        void (async () => {
            const result = await backfillData.complete(sessionId);
            if (cancelled) return;
            if (!result.success) {
                setError(result.error);
                setLines([]);
                return;
            }
            setLines(result.data.lines);
            setWins(result.data.capturedWins as CapturedWinView[]);
        })();
        return () => {
            cancelled = true;
        };
    }, [sessionId]);

    const confirmAll = async () => {
        setConfirming(true);
        const result = await backfillData.confirmAll(sessionId);
        setConfirming(false);
        if (!result.success) {
            setError(result.error);
            return;
        }
        router.push('/log');
    };

    if (lines === null) {
        return (
            <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-16 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span className={typeStyles.body}>Counting what you recovered</span>
            </div>
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-12 lg:flex-row">
            <section className="flex min-w-0 flex-1 flex-col gap-6">
                <div className="flex flex-col gap-2">
                    {lines.map((line, index) => (
                        <p
                            key={line}
                            className={index === 0 ? typeStyles.display : typeStyles.bodyRead}
                        >
                            {line}
                        </p>
                    ))}
                </div>

                {error ? (
                    <p className={cn(typeStyles.small, 'text-destructive')} role="alert">
                        {error}
                    </p>
                ) : null}

                <div className="flex flex-wrap gap-3">
                    <Button onClick={() => void confirmAll()} disabled={confirming || wins.length === 0}>
                        {confirming ? 'Confirming' : 'Review and confirm all'}
                    </Button>
                    <Button variant="outline" onClick={() => router.push('/log/backfill')}>
                        Do another period
                    </Button>
                </div>

                <p className={cn(typeStyles.small, 'text-muted-foreground')}>
                    Everything above is a draft in your log until you confirm it. The conversation
                    itself is deleted after 30 days, and you can remove it sooner from your log
                    settings — the wins it produced stay.
                </p>
            </section>

            <CaptureRail wins={wins} className="w-full shrink-0 lg:w-80" />
        </div>
    );
}
