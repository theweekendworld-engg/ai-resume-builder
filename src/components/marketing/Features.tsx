import Link from 'next/link';
import { ArrowRight, BarChart3, FileText, ListChecks, Repeat2, ScanSearch } from 'lucide-react';
import { Section, SectionIntro } from './Section';
import { Reveal } from './Reveal';
import { START_FREE_HREF } from './links';

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

/**
 * `soon` = built, not yet switched on for a new user, and labelled as such.
 * Nothing on this list is soon any more: since the launch (2026-11-07) every
 * feature is on for every account, so packets, level readiness and the
 * weekly ritual dropped their labels. The field stays for the next thing that
 * ships behind a switch.
 *
 * The job-search cards ("Any job, checked", "One assistant") moved to their
 * own section (`JobSearch.tsx`) and to `Channels.tsx`, so this grid is the
 * record's payoffs only: five cards and the call to action, a full 3×2.
 */
export const PAYOFFS: ReadonlyArray<{
    icon: typeof FileText;
    title: string;
    body: string;
    proof: string;
    soon?: boolean;
}> = [
    {
        icon: ScanSearch,
        title: 'A resume check with the fixes spelled out',
        body: 'Upload your resume and get a score with a prioritised list of what to change, no account needed. Sign up to fix it in the editor.',
        proof: 'The same coverage analysis the full product uses.',
    },
    {
        icon: BarChart3,
        title: 'A resume assembled from evidence',
        body: 'Paste any job posting and get a version tailored to it, built from your history and the wins you logged instead of a blank page, then scored for ATS parsing before you send it.',
        proof: 'Numbers are copied from your record, never generated.',
    },
    {
        icon: FileText,
        title: 'Review and promotion packets',
        body: 'Six or twelve months of confirmed wins, grouped into themes and written into a document you can hand to a manager. Every line traces back to a win you confirmed.',
        proof: 'Brag doc, performance review and promotion case, from the same record.',
    },
    {
        icon: ListChecks,
        title: 'Level readiness',
        body: 'Paste your company’s leveling rubric and see your wins mapped against it, including the competencies where the evidence is thin.',
        proof: '“One instance of cross-team influence in eight months” is a more useful sentence than a score.',
    },
    {
        icon: Repeat2,
        title: 'A weekly ritual that maintains itself',
        body: 'A short weekly digest of what was noticed, on Telegram or by email, and a monthly review written only from what you confirmed. If a paragraph cannot be grounded in the log, it is dropped rather than padded.',
        proof: 'Nothing is generated about a month you did not log.',
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
                        <span className="mk-quiet">Every conversation about your career.</span>
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
                            className="mk-card mk-card-hover flex flex-col p-7"
                        >
                            <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                            <h3 className="mt-5 font-display text-xl font-semibold leading-snug tracking-[-0.01em]">
                                {item.title}
                                {item.soon ? (
                                    <span className="eyebrow ml-2 align-middle rounded-full border border-border px-2 py-0.5">
                                        Coming soon
                                    </span>
                                ) : null}
                            </h3>
                            <p className="mt-2.5 flex-1 text-sm leading-relaxed text-muted-foreground">
                                {item.body}
                            </p>
                            <p className="mt-5 border-t border-border pt-4 text-[13px] leading-relaxed text-muted-foreground">
                                {item.proof}
                            </p>
                        </Reveal>
                    );
                })}

                {/*
                  The sixth cell completes the 3×2 grid rather than leaving a
                  hole, and it is the only card that is an action — so it
                  inverts: a teal wash and edge, and the CTA where the other
                  five put their provenance line. Ink on the wash is 13.8:1.
                */}
                <Reveal
                    delay={200}
                    className="mk-card flex flex-col justify-center border-primary/40 bg-accent p-7"
                >
                    <h3 className="font-display text-xl font-semibold leading-snug tracking-[-0.01em] text-foreground">
                        Start with the record.
                    </h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-foreground/80">
                        Keeping a log is free, permanently, and every payoff is included while we
                        launch.
                    </p>
                    <Link href={START_FREE_HREF} className="mk-btn mt-6">
                        Start free
                        <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                </Reveal>
            </div>
        </Section>
    );
}
