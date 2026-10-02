'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, Search, X } from 'lucide-react';

import { EmptyState, typeStyles, focusRing } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SourceLink } from '@/components/scout/parts';
import { shortDate } from '@/components/scout/format';
import { cn } from '@/lib/utils';
import type { InsightItem } from '@/lib/inbox/types';

import { hrefFor, type InboxState } from './params';

/**
 * The reading shelf: posts worth keeping, as takeaways. Kept apart from the
 * Work Log on purpose — someone else's post is not the user's evidence.
 */
export function InsightsShelf({ state, items }: { state: InboxState; items: InsightItem[] }) {
    const router = useRouter();
    const [q, setQ] = React.useState(state.q);
    React.useEffect(() => setQ(state.q), [state.q]);
    const go = (patch: Partial<InboxState>) => router.replace(hrefFor(state, patch), { scroll: false });

    const searching = Boolean(state.q || state.tag);
    // Tags across what is on screen, most common first, for the chip row.
    const tags = React.useMemo(() => {
        const count = new Map<string, number>();
        for (const item of items) for (const tag of item.tags) count.set(tag, (count.get(tag) ?? 0) + 1);
        return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag]) => tag);
    }, [items]);

    if (items.length === 0 && !searching) {
        return (
            <EmptyState
                icon={BookOpen}
                title="Your reading shelf is empty"
                description="Send a LinkedIn post worth keeping to the bot, or paste it above. Patronus keeps the takeaways here, away from your Work Log."
                action={{ label: 'Link Telegram', href: '/settings/channels' }}
            />
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <form
                    className="relative"
                    onSubmit={(event) => {
                        event.preventDefault();
                        go({ q: q.trim() });
                    }}
                >
                    <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        aria-label="Search insights"
                        value={q}
                        onChange={(event) => setQ(event.target.value)}
                        placeholder="Search takeaways"
                        className="h-8 w-60 pl-8 text-[13px]"
                        maxLength={120}
                    />
                </form>
                {state.tag ? (
                    <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => go({ tag: '' })}>
                        <X aria-hidden className="size-3" /> {state.tag}
                    </Button>
                ) : null}
                {searching ? (
                    <Link href={hrefFor({ ...state, q: '', tag: '' })} className={cn(typeStyles.caption, 'text-muted-foreground hover:underline')}>
                        Clear
                    </Link>
                ) : null}
            </div>

            {tags.length ? (
                <div className="flex flex-wrap gap-1.5" aria-label="Tags">
                    {tags.map((tag) => (
                        <button
                            key={tag}
                            type="button"
                            aria-pressed={state.tag === tag}
                            onClick={() => go({ tag: state.tag === tag ? '' : tag })}
                            className={cn(
                                typeStyles.caption,
                                focusRing,
                                'rounded-full border px-2.5 py-1',
                                state.tag === tag ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {tag}
                        </button>
                    ))}
                </div>
            ) : null}

            {items.length === 0 ? (
                <p className={cn(typeStyles.small, 'text-muted-foreground')}>Nothing on the shelf matches that.</p>
            ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                    {items.map((item) => (
                        <li key={item.id} className="surface-work flex flex-col rounded-xl border border-border bg-card p-4">
                            <h3 className={cn(typeStyles.h3, 'text-foreground')}>
                                {item.runId ? (
                                    <Link href={`/scout/${item.runId}`} className={cn(focusRing, 'rounded-sm hover:underline')}>{item.title}</Link>
                                ) : (
                                    item.title
                                )}
                            </h3>
                            <ul className={cn(typeStyles.small, 'mt-2 list-disc space-y-1 pl-4 text-foreground')}>
                                {item.takeaways.slice(0, 5).map((takeaway, index) => (
                                    <li key={`${index}-${takeaway.slice(0, 16)}`}>{takeaway}</li>
                                ))}
                            </ul>
                            <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3">
                                {item.url ? <SourceLink url={item.url} title={item.title} /> : null}
                                {item.author ? <span className={cn(typeStyles.caption, 'text-muted-foreground')}>by {item.author}</span> : null}
                                <span className={cn(typeStyles.caption, 'text-muted-foreground')}>{shortDate(item.createdAt)}</span>
                            </div>
                            {item.tags.length ? (
                                <p className={cn(typeStyles.caption, 'mt-1 text-muted-foreground')}>{item.tags.join(' · ')}</p>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
