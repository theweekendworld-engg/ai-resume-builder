import { FileWarning, Fingerprint, Lock, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { marketingType, Section, SectionIntro } from './Section';

/**
 * The trust section — the actual differentiator.
 *
 * Every AI resume tool will happily invent a number. This product's design
 * principle (design/00 §4, "show provenance, always") is that a generated
 * string carries a visible path back to its source, and that a claim which
 * cannot be grounded is dropped rather than softened. That is enforced in
 * code — a numeric guard, a truthfulness pass, and a sensitivity filter that
 * runs in the database query rather than in a prompt.
 *
 * These are engineering facts, stated plainly and without a percentage
 * attached, because we have no live-traffic figure to quote yet and inventing
 * one here would be self-refuting.
 */

const GUARANTEES = [
    {
        icon: Fingerprint,
        title: 'Every claim traces to a win',
        body: 'Each line of a generated packet carries the wins it came from. If a sentence has no source, it does not ship.',
    },
    {
        icon: FileWarning,
        title: 'Numbers are copied, never invented',
        body: 'A generated document cannot contain a figure that is absent from your log. Output is checked against the source and stripped if it fails.',
    },
    {
        icon: Lock,
        title: 'Confidential stays confidential',
        body: 'Wins you mark confidential are excluded from anything that leaves the product — filtered at the database, not by asking a model nicely.',
    },
    {
        icon: ShieldCheck,
        title: 'Your record is yours',
        body: 'Never sold, never used to train a model. Downgrade and your history is hidden, never deleted.',
    },
];

export function Provenance() {
    return (
        <Section>
            <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
                <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-primary/80">
                        Truthfulness
                    </p>
                    <h2 className={cn(marketingType.section, 'mt-3')}>
                        A record is worthless if you can’t defend it.
                    </h2>
                    <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                        You are going to put this in front of your manager, or a hiring panel, and
                        be asked follow-up questions. So the constraint is not that the writing
                        sounds good — it is that every sentence survives someone asking “where did
                        that come from?”
                    </p>

                    <figure className="mt-8 rounded-xl border border-border/50 bg-card/30 p-5">
                        <blockquote className="text-sm leading-relaxed text-foreground">
                            “I stabilised payments by migrating off the legacy queue in four waves,
                            and fixing the duplicate-webhook bug that double-charged 38 accounts.”
                        </blockquote>
                        <figcaption className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-3">
                            <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] text-success">
                                grounded
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                                drawn from 3 confirmed wins · “38” appears in your log
                            </span>
                        </figcaption>
                    </figure>
                </div>

                <div className="grid gap-px self-start overflow-hidden rounded-xl border border-border/50 bg-border/40 sm:grid-cols-2">
                    {GUARANTEES.map((item) => {
                        const Icon = item.icon;
                        return (
                            <div key={item.title} className="bg-background/60 p-6">
                                <Icon
                                    className="h-4 w-4 text-primary"
                                    strokeWidth={1.75}
                                    aria-hidden
                                />
                                <p className="font-heading mt-3 text-sm font-semibold">
                                    {item.title}
                                </p>
                                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                    {item.body}
                                </p>
                            </div>
                        );
                    })}
                </div>
            </div>
        </Section>
    );
}
