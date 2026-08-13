import { Reveal } from './Reveal';
import { marketingContainer, marketingType } from './Section';
import { cn } from '@/lib/utils';

/**
 * The big-number band.
 *
 * ── The slot, and the trap in it ────────────────────────────────────────────
 *
 * Four enormous figures across a dark strip is the most persuasive block on a
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
        figure: '90s',
        label: 'is the whole weekly ritual',
        detail: 'Keep, edit or dismiss what we drafted. That is the entire commitment.',
        mechanism: 'designed to fit a busy Tuesday',
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
        <section className="mk-band relative isolate overflow-hidden border-b border-border/60 py-24 lg:py-32">
            <div
                className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-primary/25"
                aria-hidden
            />

            <div className={marketingContainer}>
                <div className="mx-auto max-w-3xl text-center">
                    <Reveal as="span" className="mk-pill">
                        The constraints
                    </Reveal>
                    <Reveal delay={80}>
                        <h2 className={cn(marketingType.section, 'mt-6')}>
                            Not what we measured.{' '}
                            <span className="text-primary">What we guarantee.</span>
                        </h2>
                    </Reveal>
                    <Reveal delay={160}>
                        <p className={cn(marketingType.lead, 'mx-auto mt-5 max-w-2xl')}>
                            Every one of these is enforced in code rather than promised in a prompt,
                            which is the only version of a guarantee worth printing.
                        </p>
                    </Reveal>
                </div>

                <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
                    {CONSTRAINTS.map((item, index) => (
                        <Reveal
                            key={item.label}
                            delay={index * 100}
                            className="flex flex-col bg-background p-7 text-center"
                        >
                            {/*
                              Tabular figures. These sit in a row and a
                              proportional '1' next to a proportional '0' makes
                              the columns visibly disagree about their centres.
                            */}
                            <p className="mk-display num text-primary text-[clamp(2.75rem,5vw,3.75rem)]">
                                {item.figure}
                            </p>
                            <p className="font-heading mt-2 text-sm font-semibold text-foreground">
                                {item.label}
                            </p>
                            <p className="mt-3 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                                {item.detail}
                            </p>
                            <p className="ledger mt-4 border-t border-border/60 pt-3 text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground/50">
                                {item.mechanism}
                            </p>
                        </Reveal>
                    ))}
                </div>
            </div>
        </section>
    );
}
