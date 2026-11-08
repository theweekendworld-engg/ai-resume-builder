import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

import { cn } from '@/lib/utils';

import { typeStyles } from './tokens';

/**
 * `StatStrip` — a row of the few numbers that matter, ruled top and bottom
 * like a ledger line (Dossier, docs/design/03-dossier.md §5).
 *
 *   TO REVIEW      APPLIED      INTERVIEWING     OFFER
 *   3              5            1                0
 *   scored today   2 this week
 *
 * The label is a letterspaced eyebrow above the number, the number is the
 * serif at 28px with lining tabular figures so a row of them lines up, and an
 * optional caption under it says what the number is made of. A cell with an
 * `href` is a link to where the number is acted on.
 *
 * `tone="attention"` puts an amber mark before the label: this count is
 * waiting on the user. Use it for at most one cell, or it stops meaning
 * anything.
 *
 * A list of links, not a `<dl>`: links cannot be children of a definition
 * list. The label comes first in the DOM so a screen reader hears
 * "To review, 3", which is also the reading order on screen.
 */

export interface StatStripItem {
    key?: string;
    label: string;
    value: React.ReactNode;
    caption?: React.ReactNode;
    href?: string;
    tone?: 'default' | 'attention';
}

export interface StatStripProps {
    items: StatStripItem[];
    /** Accessible name for the list: "Your pipeline". */
    label: string;
    /**
     * `fixed` keeps every cell on one row at all widths (for three short
     * numbers in a narrow column). Default wraps to two-up on phones.
     */
    layout?: 'responsive' | 'fixed';
    /** Drop the top and bottom rules when a Section already supplies one. */
    bare?: boolean;
    className?: string;
}

const COLS: Record<number, string> = {
    1: 'sm:grid-cols-1',
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-3',
    4: 'sm:grid-cols-4',
    5: 'sm:grid-cols-5',
    6: 'sm:grid-cols-6',
};

const FIXED: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };

export function StatStrip({ items, label, layout = 'responsive', bare = false, className }: StatStripProps) {
    const fixed = layout === 'fixed';
    return (
        <ul
            aria-label={label}
            className={cn(
                'grid',
                !bare && 'border-y border-border',
                fixed ? (FIXED[Math.min(items.length, 4)] ?? 'grid-cols-4') : cn('grid-cols-2', COLS[Math.min(items.length, 6)] ?? 'sm:grid-cols-4'),
                className,
            )}
        >
            {items.map((item, index) => {
                const body = (
                    <>
                        <span className={cn(typeStyles.eyebrow, 'flex items-center gap-1.5', item.tone === 'attention' && 'text-warning')}>
                            {item.tone === 'attention' ? <span aria-hidden className="size-1.5 shrink-0 rounded-[1px] bg-warning" /> : null}
                            {item.label}
                            {item.href ? (
                                <ArrowUpRight
                                    aria-hidden
                                    className="size-3 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                                />
                            ) : null}
                        </span>
                        <span className={cn(typeStyles.stat, 'mt-1.5 block text-foreground')}>{item.value}</span>
                        {item.caption ? <span className="mt-1 block text-xs leading-4 text-muted-foreground">{item.caption}</span> : null}
                    </>
                );
                return (
                    <li
                        key={item.key ?? item.label}
                        className={cn(
                            'min-w-0',
                            // Vertical hairlines between cells; on the two-up phone
                            // grid the second row gets a top rule instead.
                            fixed
                                ? index > 0 && 'border-l border-border'
                                : [index % 2 === 1 && 'border-l border-border', index >= 2 && 'border-t border-border sm:border-t-0', index > 0 && 'sm:border-l'],
                            fixed && index === 0 && '[&>*]:pl-0',
                        )}
                    >
                        {item.href ? (
                            <Link
                                href={item.href}
                                className="group block h-full px-4 py-4 transition-colors duration-150 hover:bg-card focus-visible:bg-card focus-visible:outline-offset-[-2px] sm:px-5"
                            >
                                {body}
                            </Link>
                        ) : (
                            <div className="h-full px-4 py-4 sm:px-5">{body}</div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
