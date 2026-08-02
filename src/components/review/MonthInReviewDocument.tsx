import * as React from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { typeStyles } from '@/components/patterns';
import { cn } from '@/lib/utils';

import type { MonthInReviewView } from '@/actions/monthInReview';

/**
 * `/log/review/[yyyy-mm]` — design/02 §E.
 *
 * A DOCUMENT, not a dashboard. `body-read` at 16/26, one column, `max-w-[68ch]`,
 * generous leading, no cards, no chrome, no icons. Every temptation to put a
 * border around a section here has been resisted on purpose: this is the thing
 * people screenshot, and a screenshot of a dashboard is a screenshot of a tool.
 *
 * There is no celebration anywhere in this file. No confetti, no "great month",
 * no exclamation mark. The counter is the reward (PRD 09 §4). Outcomes get
 * congratulated by the paragraph, which the model writes; usage never does.
 */

export interface MonthInReviewDocumentProps {
    review: MonthInReviewView;
    className?: string;
}

export function MonthInReviewDocument({ review, className }: MonthInReviewDocumentProps) {
    return (
        <article
            className={cn(
                'mx-auto w-full max-w-[68ch] px-5 py-14 sm:px-6 sm:py-20',
                typeStyles.bodyRead,
                className,
            )}
        >
            <header className="text-center">
                <p
                    className={cn(
                        typeStyles.caption,
                        'uppercase tracking-[0.18em] text-muted-foreground',
                    )}
                >
                    {review.label}
                </p>
                <h1
                    className={cn(
                        typeStyles.display,
                        'mt-4 text-balance text-foreground',
                    )}
                >
                    <span className="num">{review.headline}</span>
                </h1>
            </header>

            {review.paragraph ? (
                <>
                    <Rule />
                    <p className="text-foreground">{review.paragraph}</p>
                </>
            ) : null}

            {review.mix.length > 0 ? (
                <>
                    <Rule />
                    <section aria-labelledby="mix-heading">
                        <SectionLabel id="mix-heading">Your mix</SectionLabel>
                        <MixBars mix={review.mix} />
                        {review.mixSentence ? (
                            <p className="mt-5 text-foreground">
                                <Marked text={review.mixSentence} />
                            </p>
                        ) : null}
                    </section>
                </>
            ) : null}

            {/*
              PRD 09 §4 and the ticket: specific or absent. When no rule over the
              real counts fired, nothing renders here — a generic line of
              encouragement would cost more trust than the empty space costs
              interest.
            */}
            {review.observation ? (
                <section aria-labelledby="observation-heading" className="mt-10">
                    <SectionLabel id="observation-heading">Worth knowing</SectionLabel>
                    <p className="text-foreground">
                        <Marked text={review.observation} />
                    </p>
                </section>
            ) : null}

            <Rule />

            <nav className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button asChild variant="outline" className="surface-work sm:w-auto">
                    <Link href="/packets/new">Start your review packet</Link>
                </Button>
                <Button asChild variant="ghost" className="sm:w-auto">
                    <Link href="/log">
                        See all <span className="num">{review.winCount}</span> in your log
                    </Link>
                </Button>
            </nav>

            {/*
              The value receipt (PRD 09 §4 M1). Outcome framing, never storage
              framing, and the "older than 90 days" clause is the one that lands:
              the reader knows those are the ones they would have lost.
            */}
            <p className={cn(typeStyles.small, 'mt-8 text-muted-foreground')}>{review.receipt}</p>
        </article>
    );
}

/* -------------------------------------------------------------------------- */

function Rule() {
    return <hr className="my-10 border-0 border-t border-border" />;
}

function SectionLabel({ id, children }: { id: string; children: React.ReactNode }) {
    return (
        <h2
            id={id}
            className={cn(
                typeStyles.caption,
                'mb-4 uppercase tracking-[0.18em] text-muted-foreground',
            )}
        >
            {children}
        </h2>
    );
}

/**
 * The mix. Bars rather than a chart: the comparison is between four to eight
 * small integers, and a chart would be more apparatus than information.
 * Categories get no colour (CLAUDE.md conventions) — length carries the value.
 */
function MixBars({ mix }: { mix: MonthInReviewView['mix'] }) {
    const max = Math.max(1, ...mix.map((row) => row.count));

    return (
        <ul className="space-y-2">
            {mix.map((row) => (
                <li key={row.category} className="flex items-center gap-3">
                    <span className={cn(typeStyles.mono, 'w-[11ch] shrink-0 text-muted-foreground')}>
                        {row.category}
                    </span>
                    <span
                        aria-hidden="true"
                        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary"
                    >
                        <span
                            className="block h-full rounded-full bg-muted-foreground/45"
                            style={{
                                width:
                                    row.count === 0
                                        ? '0%'
                                        : `${Math.round((row.count / max) * 100)}%`,
                            }}
                        />
                    </span>
                    <span
                        className={cn(
                            typeStyles.small,
                            'num w-[3ch] shrink-0 text-right text-muted-foreground',
                        )}
                    >
                        {row.count}
                    </span>
                </li>
            ))}
            <li className="sr-only">
                {mix.map((row) => `${row.category}: ${row.count}`).join(', ')}
            </li>
        </ul>
    );
}

/**
 * Copy from the service marks category names with backticks, because the same
 * string has to survive a plain-text email. On the web they become code spans.
 */
function Marked({ text }: { text: string }) {
    const parts = text.split(/`([^`]+)`/g);
    return (
        <>
            {parts.map((part, index) =>
                index % 2 === 1 ? (
                    <code key={index} className="font-mono text-[0.9em] text-foreground">
                        {part}
                    </code>
                ) : (
                    <React.Fragment key={index}>{part}</React.Fragment>
                ),
            )}
        </>
    );
}

export default MonthInReviewDocument;
