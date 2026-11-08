import { Check, FileWarning, Fingerprint, GitPullRequest, Lock, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { marketingType, Section } from './Section';
import { Reveal } from './Reveal';

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
        body: 'Each line of a generated resume carries the wins it came from. If a sentence has no source, it does not ship.',
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
            <div className="grid grid-cols-1 items-start gap-14 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
                <div>
                    <Reveal as="span" className="mk-pill">
                        Truthfulness
                    </Reveal>
                    <Reveal delay={80}>
                        <h2 className={cn(marketingType.section, 'mt-5')}>
                            A record is worthless{' '}
                            <span className="mk-quiet">if you can’t defend it.</span>
                        </h2>
                    </Reveal>
                    <Reveal delay={160}>
                        <p className={cn(marketingType.lead, 'mt-5')}>
                            You are going to put this in front of your manager, or a hiring panel,
                            and be asked follow-up questions. So the constraint is not that the
                            writing sounds good — it is that every sentence survives someone asking
                            “where did that come from?”
                        </p>
                    </Reveal>

                    {/*
                      The claim rendered as a document, with its provenance
                      under it: the sentence a manager will read is the
                      artifact, and the audit trail sits beneath it in the
                      ledger voice, each win with its source tag. Showing the
                      link is more convincing than a paragraph promising one.
                    */}
                    <Reveal delay={240} className="mt-10">
                    <figure className="paper rounded-lg">
                        <blockquote className="px-5 pb-4 pt-5 font-display text-[17px] leading-relaxed text-foreground">
                            “I stabilised payments by migrating off the legacy queue in four waves,
                            and fixing the duplicate-webhook bug that double-charged{' '}
                            <mark className="rounded-sm bg-success/15 px-1 text-inherit">
                                38 accounts
                            </mark>
                            .”
                        </blockquote>
                        <figcaption className="paper-rule border-t px-5 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 text-[11.5px] font-medium text-success">
                                    <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                                    Grounded
                                </span>
                                <span className="ledger paper-muted text-[11px]">
                                    3 confirmed wins · “38” appears in your log
                                </span>
                            </div>
                            <ul className="paper-muted mt-3 divide-y divide-border">
                                {[
                                    ['30 Jun', 'Fixed the duplicate-webhook bug', 'PR #455'],
                                    ['16 Jun', 'Led the payments migration', 'PR #431'],
                                    ['02 Jun', 'Wave 3 cutover, zero downtime', 'PR #418'],
                                ].map(([date, claim, src]) => (
                                    <li
                                        key={src}
                                        className="flex items-center gap-3 py-2 text-[12.5px]"
                                    >
                                        <span className="ledger w-12 shrink-0 text-[11px]">{date}</span>
                                        <span className="min-w-0 flex-1 truncate text-foreground">{claim}</span>
                                        <span className="mk-source shrink-0">
                                            <GitPullRequest className="h-3 w-3" aria-hidden />
                                            {src}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </figcaption>
                    </figure>
                    </Reveal>
                </div>

                <div className="grid gap-px self-start overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
                    {GUARANTEES.map((item, index) => {
                        const Icon = item.icon;
                        return (
                            <Reveal
                                key={item.title}
                                delay={index * 100}
                                className="bg-card p-7"
                            >
                                <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                                <p className="mt-4 font-display text-lg font-semibold leading-snug tracking-[-0.01em]">
                                    {item.title}
                                </p>
                                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                    {item.body}
                                </p>
                            </Reveal>
                        );
                    })}
                </div>
            </div>
        </Section>
    );
}
