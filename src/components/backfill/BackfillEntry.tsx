'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { History, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState, typeStyles } from '@/components/patterns';
import { cn } from '@/lib/utils';

import { backfillData } from './data-source';
import type { BackfillEntryPoint } from '@/agents/backfillAgent';

/**
 * `/log/backfill` — pick a subject.
 *
 * One session covers ONE subject, and that bound is the feature (PRD 07 §3.1):
 * "tell me about your career" is unanswerable, "tell me about your two years at
 * Acme" is a conversation someone can actually finish. So this screen offers
 * employers, never a general "start an interview" button.
 *
 * This screen is reachable only from the six entry points in §2, all of which
 * are after the user has seen value. It is never part of first-run onboarding —
 * a twenty-question interview before the first resume is a tax at the worst
 * possible moment, and it is why the feature was retargeted in the first place.
 */

export type EntrySubject = {
    subjectId: string | null;
    label: string;
    detail: string;
    resumeSessionId: string | null;
};

export interface BackfillEntryProps {
    subjects: EntrySubject[];
    entryPoint: BackfillEntryPoint;
}

export function BackfillEntry({ subjects, entryPoint }: BackfillEntryProps) {
    const router = useRouter();
    const [pendingId, setPendingId] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    const open = async (subject: EntrySubject) => {
        if (subject.resumeSessionId) {
            router.push(`/log/backfill/${subject.resumeSessionId}`);
            return;
        }

        setPendingId(subject.subjectId ?? subject.label);
        setError(null);
        const result = await backfillData.start({
            subjectType: 'employer',
            subjectId: subject.subjectId,
            subjectLabel: subject.label,
            entryPoint,
        });
        setPendingId(null);

        if (!result.success) {
            setError(result.error);
            return;
        }
        router.push(`/log/backfill/${result.data.sessionId}`);
    };

    if (subjects.length === 0) {
        return (
            <div className="mx-auto w-full max-w-2xl px-4 py-12">
                <EmptyState
                    icon={History}
                    title="Nothing to reconstruct yet"
                    description="Add an employer to your profile and we can walk through what actually happened there."
                    action={{ label: 'Add an employer', onClick: () => router.push('/dashboard') }}
                />
            </div>
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
            <header className="flex flex-col gap-2">
                <h1 className={typeStyles.display}>Get the rest of your record back</h1>
                <p className={cn(typeStyles.bodyRead, 'text-muted-foreground')}>
                    Automatic capture only sees forward. Pick one job and spend ten minutes on it —
                    one question at a time, and everything you describe is saved as you go.
                </p>
            </header>

            {error ? (
                <p className={cn(typeStyles.small, 'text-destructive')} role="alert">
                    {error}
                </p>
            ) : null}

            <ul className="flex flex-col gap-2" role="list">
                {subjects.map((subject) => {
                    const busy = pendingId === (subject.subjectId ?? subject.label);
                    return (
                        <li
                            key={subject.subjectId ?? subject.label}
                            className="surface-work flex items-center gap-4 rounded-lg border border-border px-4 py-3"
                        >
                            <div className="min-w-0 flex-1">
                                <p className={cn(typeStyles.h3, 'truncate')}>{subject.label}</p>
                                <p className={cn(typeStyles.small, 'truncate text-muted-foreground')}>
                                    {subject.detail}
                                </p>
                            </div>
                            <Button
                                variant={subject.resumeSessionId ? 'default' : 'outline'}
                                onClick={() => void open(subject)}
                                disabled={busy}
                            >
                                {busy ? (
                                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                                ) : subject.resumeSessionId ? (
                                    'Pick up where you left off'
                                ) : (
                                    'Reconstruct'
                                )}
                            </Button>
                        </li>
                    );
                })}
            </ul>

            <p className={cn(typeStyles.caption, 'text-muted-foreground')}>
                The conversation is private, is never used to train anything, and is deleted after
                30 days.
            </p>
        </div>
    );
}
