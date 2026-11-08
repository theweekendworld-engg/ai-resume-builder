import * as React from 'react';
import {
    BadgeCheck,
    Building2,
    ExternalLink,
    FileText,
    GitPullRequest,
    Link as LinkIcon,
    MessageSquareQuote,
    Upload,
    type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

import { focusRing } from './tokens';
import type { EvidenceKindValue } from './types';

/**
 * `EvidenceChip` — where a claim comes from, said in two words:
 *
 *   [▢ Plivo · media path]   [⑂ PR #482 · patronus/api]   [▤ resume.pdf]
 *
 * The source in ink, the detail in muted ink after a middot, one icon for
 * the kind of source. Provenance is the product's brand (design/00 §2.4), so
 * this sits beside every generated line, fit reason and matched requirement.
 *
 * It is a label, not a control: with an `href` it links to the source, and
 * that is all. For the hover excerpt popover use `SourceChip`, which shows the
 * stored excerpt; EvidenceChip is the light version for dense rows and for
 * places with no excerpt (a company, a job posting, a section of the record).
 */

const KIND_ICON: Record<EvidenceKindValue | 'company', LucideIcon> = {
    repo: GitPullRequest,
    document: FileText,
    url: LinkIcon,
    interview_assertion: MessageSquareQuote,
    metric_confirmed: BadgeCheck,
    import: Upload,
    company: Building2,
};

export interface EvidenceChipProps {
    /** Who or what: "Plivo", "PR #482", "resume.pdf". */
    source: string;
    /** Which part: "media path", "patronus/api", "p. 2". */
    detail?: string;
    kind?: EvidenceKindValue | 'company';
    /** Overrides the kind's icon. */
    icon?: LucideIcon;
    /** Links the chip to the source (opens in a new tab when external). */
    href?: string;
    className?: string;
}

export function EvidenceChip({ source, detail, kind, icon, href, className }: EvidenceChipProps) {
    const Icon = icon ?? (kind ? KIND_ICON[kind] : null);
    const external = href ? /^https?:\/\//.test(href) : false;
    const title = detail ? `${source} · ${detail}` : source;
    const classes = cn(
        'inline-flex h-6 max-w-full items-center gap-1.5 rounded-sm border border-border bg-card px-2 text-xs leading-4',
        href && cn(focusRing, 'transition-colors duration-150 hover:border-border-strong/70 hover:bg-secondary/50'),
        className,
    );
    const body = (
        <>
            {Icon ? <Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" strokeWidth={2} /> : null}
            <span className="truncate font-medium text-foreground">{source}</span>
            {detail ? (
                <>
                    <span aria-hidden className="text-border-strong">·</span>
                    <span className="sr-only">, </span>
                    <span className="truncate text-muted-foreground">{detail}</span>
                </>
            ) : null}
            {external ? <ExternalLink aria-hidden className="size-3 shrink-0 text-muted-foreground" /> : null}
        </>
    );

    if (href) {
        return (
            <a
                href={href}
                title={title}
                className={classes}
                {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
                {body}
                {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
            </a>
        );
    }
    return (
        <span title={title} className={classes}>
            {body}
        </span>
    );
}

/** A row of chips that wraps, with the 8px rhythm between them. */
export function EvidenceChipRow({ children, label, className }: { children: React.ReactNode; label?: string; className?: string }) {
    return (
        <div role={label ? 'group' : undefined} aria-label={label} className={cn('flex flex-wrap items-center gap-2', className)}>
            {children}
        </div>
    );
}
