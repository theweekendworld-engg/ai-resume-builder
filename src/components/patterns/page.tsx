import * as React from 'react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

import { focusRing } from './tokens';

/**
 * Page chrome inside the app shell (design/00 §5.2, revised 2026-10-03).
 *
 * Every destination page is built from the same four pieces, in this order,
 * so moving between pages never changes where the eye finds things:
 *
 *   PageHeader   title · one-line description · one primary action (right)
 *   PageTabs     the page's own views, underlined, links not state
 *   Toolbar      segmented status + Filter + Sort, one row
 *   content      a list in one bordered container, or cards
 *
 * Reference: Linear, Vercel, Attio. A page says what it is in one line; the
 * description is never a paragraph, filters live behind one button, and the
 * empty state appears once per view, not once per column.
 */

/** Width and gutters for every page. Left-aligned to the sidebar from lg. */
export const pageContainer = 'w-full max-w-6xl px-4 sm:px-6 lg:px-8';

export function PageHeader({
    title,
    description,
    actions,
    children,
    className,
}: {
    title: React.ReactNode;
    /** One line. If it needs two, it belongs in an empty state or a doc. */
    description?: React.ReactNode;
    /** At most one primary button plus quiet secondaries. */
    actions?: React.ReactNode;
    /** Usually <PageTabs>. Sits flush on the header's bottom border. */
    children?: React.ReactNode;
    className?: string;
}) {
    return (
        <header className={cn('border-b border-border', !children && 'pb-5', className)}>
            <div className={cn(pageContainer, 'flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pt-6 md:pt-8')}>
                <div className="min-w-0">
                    <h1 className="font-heading text-[22px] font-semibold leading-8 tracking-tight text-foreground">{title}</h1>
                    {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
                </div>
                {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
            </div>
            {children ? <div className={cn(pageContainer, 'mt-4')}>{children}</div> : null}
        </header>
    );
}

export type PageTab = { key: string; label: string; href?: string; onSelect?: () => void; count?: number | null; icon?: React.ComponentType<{ className?: string }> };

export function PageTabs({ tabs, active, label }: { tabs: PageTab[]; active: string; label: string }) {
    return (
        <nav aria-label={label} className="-mb-px flex gap-5 overflow-x-auto [scrollbar-width:none]">
            {tabs.map((tab) => {
                const isActive = tab.key === active;
                const Icon = tab.icon;
                const className = cn(
                    focusRing,
                    'inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 text-sm transition-colors',
                    isActive ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                );
                const body = (
                    <>
                        {Icon ? <Icon className="size-4" aria-hidden /> : null}
                        {tab.label}
                        {tab.count ? <span className="num rounded-full bg-secondary px-1.5 text-[11px] font-medium text-muted-foreground">{tab.count}</span> : null}
                    </>
                );
                return tab.href ? (
                    <Link key={tab.key} href={tab.href} aria-current={isActive ? 'page' : undefined} className={className}>
                        {body}
                    </Link>
                ) : (
                    <button key={tab.key} type="button" aria-current={isActive ? 'page' : undefined} onClick={tab.onSelect} className={className}>
                        {body}
                    </button>
                );
            })}
        </nav>
    );
}

/** The page body under the header. */
export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={cn(pageContainer, 'py-6', className)}>{children}</div>;
}

/**
 * A segmented control for a list's status views ("All · To review · …").
 * One row, counts beside labels, the selected segment raised.
 */
export function Segmented<T extends string>({
    options,
    value,
    onChange,
    label,
}: {
    options: { value: T; label: string; count?: number }[];
    value: T;
    onChange: (value: T) => void;
    label: string;
}) {
    return (
        <div role="tablist" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg bg-secondary p-0.5 [scrollbar-width:none]">
            {options.map((option) => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => onChange(option.value)}
                        className={cn(
                            focusRing,
                            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
                            selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {option.label}
                        {option.count !== undefined ? <span className="num text-[11px] text-muted-foreground">{option.count}</span> : null}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * A quiet pill: neutral surface, an optional coloured dot carries the
 * meaning. Colour on the dot only, never on the whole pill (design/00 §4:
 * colour is reserved, categories get icons).
 */
export function Pill({ children, dot, className }: { children: React.ReactNode; dot?: 'success' | 'info' | 'warning' | 'muted' | 'danger'; className?: string }) {
    const dotClass = {
        success: 'bg-success',
        info: 'bg-primary',
        warning: 'bg-warning',
        danger: 'bg-danger',
        muted: 'bg-muted-foreground/50',
    } as const;
    return (
        <span className={cn('num inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2 text-xs font-medium text-foreground', className)}>
            {dot ? <span aria-hidden className={cn('size-1.5 rounded-full', dotClass[dot])} /> : null}
            {children}
        </span>
    );
}

/** A company's initial in a neutral square, the list's visual anchor. */
export function InitialAvatar({ name, className }: { name: string | null; className?: string }) {
    const initial = (name ?? '').trim().charAt(0).toUpperCase() || '?';
    return (
        <span aria-hidden className={cn('grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-secondary font-heading text-sm font-semibold text-muted-foreground', className)}>
            {initial}
        </span>
    );
}
