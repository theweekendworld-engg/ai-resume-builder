'use client';

import { useMemo } from 'react';
import { diffWords } from '@/lib/textDiff';
import { cn } from '@/lib/utils';

interface DiffPreviewProps {
    before: string;
    after: string;
    className?: string;
}

/**
 * Renders a word-level before/after diff: removed text in red/strikethrough,
 * added text highlighted green. Shared by inline bullet suggestions and the
 * fix checklist so "trust" comes from seeing the change before applying it.
 */
export function DiffPreview({ before, after, className }: DiffPreviewProps) {
    const tokens = useMemo(() => diffWords(before, after), [before, after]);

    return (
        <div className={cn('rounded-md border border-border bg-muted/40 p-3 text-sm leading-relaxed', className)}>
            {tokens.map((token, index) => {
                if (token.op === 'equal') {
                    return <span key={index}>{token.value}</span>;
                }
                if (token.op === 'remove') {
                    return (
                        <span
                            key={index}
                            className="rounded bg-destructive/15 text-destructive line-through decoration-destructive/60"
                        >
                            {token.value}
                        </span>
                    );
                }
                return (
                    <span
                        key={index}
                        className="rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    >
                        {token.value}
                    </span>
                );
            })}
        </div>
    );
}
