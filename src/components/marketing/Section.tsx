import * as React from 'react';

import { cn } from '@/lib/utils';
import { Reveal } from './Reveal';

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
 * one large statement in the serif, one calm paragraph in Inter, and nothing
 * competing. Dossier (2026-11-08) moved the display roles from Sora 800 to
 * Source Serif 4 at 600: the page should read as a well-set document, the
 * same voice as the app's page titles.
 */

export const marketingType = {
    /**
     * 38 → 68px, fluid, serif 600. `clamp` rather than breakpoint steps: the
     * size is a function of the viewport, so a line that fits at 1440 also
     * fits at 1100 rather than falling into a gap between two fixed steps.
     */
    hero: 'mk-display mk-h1',
    /** 30 → 48px, fluid. Section headings. */
    section: 'mk-display mk-h2',
    /** 18 → 22px. A statement inside a section — a card title, a pull quote. */
    statement: 'mk-display mk-h3',
    /** 17 → 18px. The paragraph under a heading. Never smaller. */
    lead: 'text-[1.0625rem] leading-relaxed text-muted-foreground sm:text-lg',
    /** 11px caps. The label above a heading — see `.mk-pill` and `.eyebrow`. */
    eyebrow: 'eyebrow',
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
 *
 * `py-24 lg:py-32`: whitespace scales with the headline it surrounds, and an
 * 8px rhythm (96 / 128) keeps every section on the same grid.
 */
const RHYTHM = 'py-24 lg:py-32';

/** The ground a section sits on: paper, the warm secondary band, or a white
 *  sheet. They alternate so consecutive sections separate by a change of
 *  paper rather than by stacking more hairlines. */
type SectionTone = 'default' | 'sunken' | 'raised';

const TONE: Record<SectionTone, string> = {
    default: '',
    sunken: 'mk-band',
    raised: 'bg-card',
};

export function Section({
    id,
    children,
    className,
    bleed = false,
    bordered = true,
    tone = 'default',
}: {
    id?: string;
    children: React.ReactNode;
    className?: string;
    /** Skip the container — for a section that manages its own full-bleed layout. */
    bleed?: boolean;
    /** The hairline between sections. Off for the last one before the footer. */
    bordered?: boolean;
    tone?: SectionTone;
}) {
    return (
        <section
            id={id}
            className={cn(
                'relative isolate',
                bordered && 'border-b border-border',
                TONE[tone],
                RHYTHM,
                className,
            )}
        >
            {bleed ? children : <div className={marketingContainer}>{children}</div>}
        </section>
    );
}

/**
 * Pill → heading → lead.
 *
 * The heading takes a `<span className="mk-quiet">` for its second line
 * rather than accepting an `accent` prop: which words carry the second voice
 * is a copy decision, and it changes per section. A prop would force every
 * caller to split its headline the same way. The second clause is muted ink,
 * not teal — teal is kept for what you can press.
 *
 * `align="center"` is now the common case rather than the exception. That is a
 * reversal of the previous rule and it is deliberate — at this display size the
 * headline is two or three words per line, where centring reads as composed
 * rather than as the hard-to-scan wall of centred text the old rule guarded
 * against. Body copy underneath still gets a measure cap.
 */
export function SectionIntro({
    eyebrow,
    title,
    lead,
    align = 'center',
    className,
}: {
    eyebrow?: string;
    title: React.ReactNode;
    lead?: React.ReactNode;
    align?: 'left' | 'center';
    className?: string;
}) {
    const centered = align === 'center';

    return (
        <div className={cn(centered ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl', className)}>
            {eyebrow ? (
                <Reveal className="mk-pill" as="span">
                    {eyebrow}
                </Reveal>
            ) : null}
            <Reveal delay={eyebrow ? 80 : 0}>
                <h2 className={cn(marketingType.section, eyebrow ? 'mt-5' : undefined)}>{title}</h2>
            </Reveal>
            {lead ? (
                <Reveal delay={160}>
                    <p className={cn(marketingType.lead, 'mt-5', centered && 'mx-auto max-w-2xl')}>
                        {lead}
                    </p>
                </Reveal>
            ) : null}
        </div>
    );
}
