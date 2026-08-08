import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The landing page's layout and type scale, in one place.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * Seven sections, each re-declaring its own container, its own vertical
 * rhythm, and its own heading markup. They had drifted:
 *
 *   Hero        pt-20 pb-20 / lg:pt-28 lg:pb-28   max-w-6xl
 *   Sections    py-20        / lg:py-24            max-w-6xl
 *   ClosingCta  py-24        / lg:py-28            max-w-6xl
 *   Navbar      —                                  max-w-5xl
 *   Footer      py-10                              max-w-5xl
 *
 * Three vertical rhythms and two container widths on one page. The nav and
 * footer being 4rem narrower than everything between them is the visible one:
 * the logo does not line up with the content beneath it, which is the kind of
 * thing that reads as "unfinished" without anyone being able to say why.
 *
 * The app has `src/components/patterns/tokens.ts` for exactly this reason. It
 * stops at `display` (30px), which is correct for a data-dense work tool and
 * far too small for a landing page, so marketing gets its own scale here
 * rather than bending the app's.
 *
 * ── The scale ───────────────────────────────────────────────────────────────
 *
 * Four roles, and the jump between them is deliberate. A landing page reads
 * as high-craft when the type contrast is large and the palette is small —
 * one enormous statement, one calm paragraph, and nothing competing.
 */

export const marketingType = {
    /** 40 → 60px. The one statement on the page. Sora 600, tight. */
    hero: 'font-heading text-[2.5rem] leading-[1.08] font-semibold tracking-tight sm:text-[3.25rem] lg:text-[3.75rem]',
    /** 30 → 36px. Section headings. */
    section:
        'font-heading text-[1.875rem] leading-[1.15] font-semibold tracking-tight sm:text-[2.25rem]',
    /** 20 → 24px. A statement inside a section — a pull quote, a big number. */
    statement: 'font-heading text-xl leading-snug font-semibold tracking-tight sm:text-2xl',
    /** 17 → 18px. The paragraph under a heading. Never smaller. */
    lead: 'text-[1.0625rem] leading-relaxed text-muted-foreground sm:text-lg',
    /** 12px caps. The label above a heading. */
    eyebrow: 'text-[11px] font-medium uppercase tracking-[0.12em]',
    /** Body copy inside a section. */
    body: 'text-sm leading-relaxed text-muted-foreground',
} as const;

/**
 * One container width for the whole page, nav and footer included.
 *
 * 72rem rather than the sections' old 6xl (72rem) and the chrome's 5xl
 * (64rem) — the sections were already right and the chrome was the outlier.
 */
export const marketingContainer = 'mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8';

/**
 * Vertical rhythm.
 *
 * One value, applied by `Section`. Sections that need more room say so by
 * composing, not by inventing a fourth number.
 */
const RHYTHM = 'py-20 lg:py-28';

export function Section({
    id,
    children,
    className,
    bleed = false,
    bordered = true,
}: {
    id?: string;
    children: React.ReactNode;
    className?: string;
    /** Skip the container — for a section that manages its own full-bleed layout. */
    bleed?: boolean;
    /** The hairline between sections. Off for the last one before the footer. */
    bordered?: boolean;
}) {
    return (
        <section
            id={id}
            className={cn(
                'relative isolate',
                bordered && 'border-b border-border/40',
                RHYTHM,
                className,
            )}
        >
            {bleed ? children : <div className={marketingContainer}>{children}</div>}
        </section>
    );
}

/**
 * Eyebrow → heading → lead.
 *
 * Every section on the page opened with some version of this and none of them
 * agreed on the spacing. `align="center"` is the exception rather than the
 * default: centred text is harder to read and the design foundations say to
 * centre display headlines only.
 */
export function SectionIntro({
    eyebrow,
    title,
    lead,
    align = 'left',
    className,
}: {
    eyebrow?: string;
    title: React.ReactNode;
    lead?: React.ReactNode;
    align?: 'left' | 'center';
    className?: string;
}) {
    return (
        <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center', className)}>
            {eyebrow ? (
                <p className={cn(marketingType.eyebrow, 'text-primary/80')}>{eyebrow}</p>
            ) : null}
            <h2 className={cn(marketingType.section, eyebrow ? 'mt-3' : undefined)}>{title}</h2>
            {lead ? <p className={cn(marketingType.lead, 'mt-4')}>{lead}</p> : null}
        </div>
    );
}
