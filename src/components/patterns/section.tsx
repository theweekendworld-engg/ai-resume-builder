import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { cn } from '@/lib/utils';

import { focusRing, typeStyles } from './tokens';

/**
 * `Section` — one part of a page, introduced by an eyebrow and separated from
 * the part above it by a hairline rule (Dossier, docs/design/03-dossier.md §5).
 *
 *   ─────────────────────────────────────────────────────────  ← rule
 *   NEEDS YOU · 3                                   View all →  ← eyebrow · action
 *   Optional serif title                                        ← h2, 19/26
 *   One line of description, muted.
 *
 *   …content
 *
 * Two variants:
 *   `ruled` (default) — no box; the rule does the separating. Use it for the
 *                       parts of a page, so the page reads as one document
 *                       rather than a pile of floating cards.
 *   `boxed`           — the same header on a white card with a hairline edge,
 *                       for a list that needs a container (rows with
 *                       dividers, a table). The header gets its own rule.
 *
 * The heading is always a real heading: the title when there is one,
 * otherwise the eyebrow itself is the `<h2>`, so the page outline is intact.
 */

export interface SectionProps {
    /** The kicker: "Needs you", "Pipeline". Sentence case; CSS uppercases it. */
    eyebrow?: string;
    /** A count beside the eyebrow, in tabular figures. */
    count?: number | null;
    /** Mark the eyebrow amber: this section is waiting on the user. */
    tone?: 'default' | 'attention';
    title?: React.ReactNode;
    description?: React.ReactNode;
    /** Right side of the header. Usually a <SectionLink>. */
    action?: React.ReactNode;
    variant?: 'ruled' | 'boxed';
    /** Heading level for the title/eyebrow. Default 2. */
    level?: 2 | 3;
    id?: string;
    className?: string;
    bodyClassName?: string;
    children?: React.ReactNode;
}

export function Section({
    eyebrow,
    count,
    tone = 'default',
    title,
    description,
    action,
    variant = 'ruled',
    level = 2,
    id,
    className,
    bodyClassName,
    children,
}: SectionProps) {
    const reactId = React.useId();
    const headingId = id ? `${id}-heading` : `section-${reactId.replace(/:/g, '')}`;
    const Heading = (level === 3 ? 'h3' : 'h2') as 'h2' | 'h3';
    const boxed = variant === 'boxed';

    const eyebrowContent = eyebrow ? (
        <span className={cn(typeStyles.eyebrow, 'flex items-center gap-1.5', tone === 'attention' && 'text-warning')}>
            {tone === 'attention' ? <span aria-hidden className="size-1.5 shrink-0 rounded-[1px] bg-warning" /> : null}
            {eyebrow}
            {typeof count === 'number' ? (
                <>
                    <span aria-hidden className="text-border-strong">·</span>
                    <span className="num">{count}</span>
                </>
            ) : null}
        </span>
    ) : null;

    const header =
        eyebrow || title || action ? (
            <header
                className={cn(
                    'flex justify-between gap-4',
                    // An eyebrow alone centres on its action link; a title block
                    // aligns the action with its first line.
                    title || description ? 'items-start' : 'items-center',
                    boxed ? 'border-b border-border px-4 py-3' : 'mb-3',
                    !boxed && !(title || description) && action ? '-mt-1.5' : null,
                )}
            >
                <div className="min-w-0">
                    {title ? (
                        <>
                            {eyebrowContent}
                            <Heading id={headingId} className={cn(typeStyles.h2, 'text-foreground', eyebrow && 'mt-1')}>
                                {title}
                            </Heading>
                        </>
                    ) : eyebrowContent ? (
                        <Heading id={headingId}>{eyebrowContent}</Heading>
                    ) : null}
                    {description ? <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p> : null}
                </div>
                {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
            </header>
        ) : null;

    return (
        <section
            id={id}
            aria-labelledby={eyebrow || title ? headingId : undefined}
            className={cn(boxed ? 'overflow-hidden rounded-lg border border-border bg-card' : 'border-t border-border pt-5', className)}
        >
            {header}
            <div className={bodyClassName}>{children}</div>
        </section>
    );
}

/** "View all →" in a section header: a quiet link, 13px, ink on hover. */
export function SectionLink({ href, children = 'View all', className }: { href: string; children?: React.ReactNode; className?: string }) {
    return (
        <Link
            href={href}
            className={cn(
                focusRing,
                'inline-flex min-h-8 items-center gap-1 rounded-sm text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground',
                className,
            )}
        >
            {children}
            <ArrowRight aria-hidden className="size-3.5" />
        </Link>
    );
}
