import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, BarChart3, Chrome, FileText, ListChecks, Repeat2 } from 'lucide-react';
import { Section, SectionIntro } from './Section';

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
        <Section id="features" className="bg-card/20">
            <div className="flex flex-wrap items-end justify-between gap-6">
                <SectionIntro
                    eyebrow="What the log becomes"
                    title="One record. Every conversation about your career."
                    lead={
                        <>
                            The log is not the product — it is the input. Everything below is
                            generated from the same confirmed evidence, which is why the numbers
                            agree with each other.
                        </>
                    }
                />
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {PAYOFFS.map((item) => {
                    const Icon = item.icon;
                    return (
                        <article
                            key={item.title}
                            className="flex flex-col rounded-xl border border-border/50 bg-background/50 p-6"
                        >
                            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Icon className="h-4 w-4" strokeWidth={1.75} />
                            </span>
                            <h3 className="font-heading mt-4 text-base font-semibold leading-snug">
                                {item.title}
                            </h3>
                            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                                {item.body}
                            </p>
                            <p className="mt-4 border-t border-border/40 pt-3 text-xs leading-relaxed text-muted-foreground/70">
                                {item.proof}
                            </p>
                        </article>
                    );
                })}

                <div className="flex flex-col justify-center rounded-xl border border-dashed border-border/50 p-6">
                    <p className="font-heading text-base font-semibold leading-snug">
                        Start with the record.
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        Keeping a log is free, permanently. The payoffs are there when you need
                        them.
                    </p>
                    <Link href="/sign-up?redirect_url=/log" className="mt-4">
                        <Button className="group w-full gap-2">
                            Start your work log
                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </Button>
                    </Link>
                </div>
            </div>
        </Section>
    );
}
