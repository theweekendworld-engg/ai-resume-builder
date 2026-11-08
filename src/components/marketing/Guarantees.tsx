import { Reveal } from './Reveal';
import { marketingContainer, marketingType } from './Section';
import { cn } from '@/lib/utils';

/**
 * The big-number band.
 *
 * ── The slot, and the trap in it ────────────────────────────────────────────
 *
 * Four large figures across a band is the most persuasive block on a
 * landing page of this shape, which is exactly why it is the one most often
 * filled with fiction — "$1M+ generated", "100+ businesses scaled", "4.8/5
 * average rating". The reference design does all three.
 *
 * We have no traffic to quote. The honest options were to drop the band or to
 * find four numbers that are true. Dropping it costs the page its strongest
 * rhythmic beat, so: these are not measurements, they are CONSTRAINTS — things
 * that are true because the system cannot do otherwise, each one enforced
 * somewhere in `src/`.
 *
 * That turns out to be a better band than the fake one would have been. A
 * usage metric says other people liked this. A constraint says here is what
 * cannot happen to you, which is the thing a reader deciding whether to trust
 * an AI writing tool is actually asking about.
 *
 * Every figure below is load-bearing. If one stops being true, this section is
 * a lie and it has to change — so each carries the mechanism that keeps it
 * true, in the ledger voice, directly underneath.
 */

/**
 * Static figures. They used to count up from zero as the band scrolled in, and
 * two of the four (0 and 1) had nowhere to travel. A number that performs reads
 * as a slot machine; these are constraints, and they should simply be there
 * (design/00 §7.2: "it's a number, not a slot machine").
 */
const CONSTRAINTS = [
    {
        figure: '0',
        label: 'invented numbers',
        detail: 'A generated document cannot contain a figure absent from your log.',
        mechanism: 'numeric guard, src/lib/ai',
    },
    {
        figure: '1',
        label: 'tap to confirm a win',
        detail: 'Confirming writes the evidence and the link in a single transaction.',
        mechanism: 'the only step the habit needs',
    },
    {
        figure: '1',
        label: 'sentence is enough to log a win',
        detail: 'Type a rough note; it comes back structured, with your numbers untouched.',
        mechanism: 'no weekly homework',
    },
    {
        figure: '100%',
        label: 'of shipped lines carry a source',
        detail: 'A sentence that cannot be grounded is dropped rather than softened.',
        mechanism: 'unsourced claims never ship',
    },
] as const;

export function Guarantees() {
    return (
        <section className="mk-band relative border-b border-border py-24 lg:py-32">
            <div className={marketingContainer}>
                <div className="mx-auto max-w-3xl text-center">
                    <Reveal as="span" className="mk-pill">
                        The constraints
                    </Reveal>
                    <Reveal delay={80}>
                        <h2 className={cn(marketingType.section, 'mt-5')}>
                            Not what we measured.{' '}
                            <span className="mk-quiet">What we guarantee.</span>
                        </h2>
                    </Reveal>
                    <Reveal delay={160}>
                        <p className={cn(marketingType.lead, 'mx-auto mt-5 max-w-2xl')}>
                            Every one of these is enforced in code rather than promised in a prompt,
                            which is the only version of a guarantee worth printing.
                        </p>
                    </Reveal>
                </div>

                <div className="mt-16 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
                    {CONSTRAINTS.map((item, index) => (
                        <Reveal
                            key={item.label}
                            delay={index * 100}
                            className="flex flex-col bg-card p-7 text-left"
                        >
                            {/*
                              Tabular lining figures in the serif: these sit in
                              a row, and a proportional '1' next to a
                              proportional '0' makes the columns disagree.
                            */}
                            <p className="mk-display num text-[clamp(2.75rem,5vw,3.5rem)] leading-none">
                                {item.figure}
                            </p>
                            <p className="mt-3 text-sm font-semibold text-foreground">
                                {item.label}
                            </p>
                            <p className="mt-3 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                                {item.detail}
                            </p>
                            <p className="ledger mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
                                {item.mechanism}
                            </p>
                        </Reveal>
                    ))}
                </div>
            </div>
        </section>
    );
}
