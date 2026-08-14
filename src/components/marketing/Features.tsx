import Link from 'next/link';
import { ArrowRight, BarChart3, Chrome, FileText, ListChecks, Repeat2 } from 'lucide-react';
import { Section, SectionIntro } from './Section';
import { Reveal } from './Reveal';

/**
 * What the log turns into.
 *
 * Every item here is shipped and verifiable in the product today. Career Radar
 * and Missions are named in the strategy doc and in our own entitlement flags,
 * but they have no implementation — so they are deliberately absent. Promising
 * them on the page a user reads *before* paying would be the same category of
 * mistake this product exists to eliminate from a resume.
 *
 * Ordered by how soon a new user actually reaches the payoff, which is not the
 * order of how impressive each one is.
 */

const PAYOFFS = [
    {
        icon: FileText,
        title: 'Review and promotion packets',
        body: 'Six or twelve months of confirmed wins, grouped into themes and written into a document you can hand to a manager. Every line traces back to a win you confirmed.',
        proof: 'Free plan includes a brag doc; paid plans add performance-review and promotion formats.',
    },
    {
        icon: ListChecks,
        title: 'Level readiness',
        body: 'Upload your company’s leveling rubric and see your wins mapped against it — including the competencies where the evidence is thin.',
        proof: '“One instance of cross-team influence in eight months” is a more useful sentence than a score.',
    },
    {
        icon: Repeat2,
        title: 'A weekly ritual that maintains itself',
        body: 'A short digest of what we noticed, and a monthly review written only from what you confirmed. If a paragraph cannot be grounded in the log, it is dropped rather than padded.',
        proof: 'Nothing is generated about a month you did not log.',
    },
    {
        icon: BarChart3,
        title: 'A resume assembled from evidence',
        body: 'When you do search, the resume is built from dated, evidence-linked wins instead of a blank page and your memory — then scored for ATS parsing before you send it.',
        proof: 'Tools that only show up at search time start from nothing.',
    },
    {
        icon: Chrome,
        title: 'Apply without retyping',
        body: 'The browser extension fills applications from your profile, drafts the long-form answers, and remembers them — so the second time a form asks why you want to work somewhere, it is already answered.',
        proof: 'Saved answers match by meaning, not exact wording.',
    },
];

export function Features() {
    return (
        <Section id="features" tone="raised">
            <SectionIntro
                eyebrow="What the log becomes"
                title={
                    <>
                        One record.{' '}
                        <span className="text-primary">Every conversation about your career.</span>
                    </>
                }
                lead={
                    <>
                        The log is not the product — it is the input. Everything below is generated
                        from the same confirmed evidence, which is why the numbers agree with each
                        other.
                    </>
                }
            />

            <div className="mt-16 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {PAYOFFS.map((item, index) => {
                    const Icon = item.icon;
                    return (
                        <Reveal
                            as="article"
                            key={item.title}
                            // Stagger by column rather than by absolute index.
                            // At index * 100 the sixth card waits half a second
                            // after the first, which on a three-up grid means
                            // the bottom row is still arriving well after the
                            // reader has finished the top one.
                            delay={(index % 3) * 100}
                            className="mk-card mk-card-hover mk-rail group flex flex-col overflow-hidden p-7 pl-8"
                        >
                            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                                <Icon className="h-5 w-5" strokeWidth={1.75} />
                            </span>
                            <h3 className="font-heading mt-5 text-lg font-bold leading-snug tracking-tight">
                                {item.title}
                            </h3>
                            <p className="mt-2.5 flex-1 text-sm leading-relaxed text-muted-foreground">
                                {item.body}
                            </p>
                            <p className="ledger mt-5 border-t border-border/60 pt-4 text-[11px] leading-relaxed text-muted-foreground/60">
                                {item.proof}
                            </p>
                        </Reveal>
                    );
                })}

                {/*
                  The sixth cell completes the 3×2 grid rather than leaving a
                  hole, and it is the only card that is an action — so it
                  inverts: accent border, lit, and the CTA where the other five
                  put their provenance line.
                */}
                <Reveal
                    delay={200}
                    className="mk-card mk-glow flex flex-col justify-center border-primary/30 p-7"
                >
                    <h3 className="font-heading text-lg font-bold leading-snug tracking-tight">
                        Start with the record.
                    </h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                        Keeping a log is free, permanently. The payoffs are there when you need
                        them.
                    </p>
                    <Link href="/sign-up?redirect_url=/build" className="mk-btn group mt-6">
                        Start free
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                </Reveal>
            </div>
        </Section>
    );
}
