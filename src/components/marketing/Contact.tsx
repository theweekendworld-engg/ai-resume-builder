import { ArrowRight, Mail } from 'lucide-react';
import { Section, SectionIntro } from './Section';
import { Reveal } from './Reveal';

/**
 * Where pricing used to be.
 *
 * ── Why the plan cards came off the page ────────────────────────────────────
 *
 * `src/lib/plans.ts` carries display prices for Career and Search, and the
 * Stripe Price objects behind them do not exist yet (CLAUDE.md, "what is not
 * proven"). A visitor who reads a number, decides it is fair, clicks, and finds
 * nothing to buy has been told something untrue by a page whose entire subject
 * is not saying untrue things. Publishing a price you cannot honour is the
 * pricing-page version of a fabricated resume line.
 *
 * So the number comes off until it can be charged. `Pricing.tsx` stays in the
 * tree, still reading from the catalog and still covered by `pricing.test.ts`,
 * so restoring the section is one line in `page.tsx` on the day the Prices are
 * created — not a rebuild.
 *
 * ── Why a bare mailto and not a form ────────────────────────────────────────
 *
 * A contact form here would need a route, validation, a store, and spam
 * handling, and it would collect addresses into a table nobody has agreed to
 * own yet. An address in plain text costs none of that, and at this stage the
 * volume is a person reading their own inbox. When that stops being true, this
 * becomes a form.
 *
 * The address is written once, here, and imported by the footer. Two hand-typed
 * copies of a contact address is the same class of drift the pricing catalog
 * exists to prevent — it is just cheaper to notice.
 */

/** The single published address. Change it here and the footer follows. */
export const CONTACT_EMAIL = 'jaimauryatech@gmail.com';

const SUBJECT = encodeURIComponent('Patronus — pricing');

/**
 * What a reader actually wants to know before they write, answered so the
 * email they send is a decision rather than a first question.
 */
const NOTES = [
    {
        title: 'Logging is free, and stays free',
        body: 'Keeping the record costs nothing and always will. Losing your history is the problem this exists to solve, so putting it behind a card would be self-defeating.',
    },
    {
        title: 'Nothing is deleted if you stop paying',
        body: 'Downgrade and the paid surfaces are hidden. Your wins, evidence and confirmations stay exactly where they are.',
    },
    {
        title: 'Tell us what you need it for',
        body: 'Review packets, level readiness, a search that starts next month — what it costs depends on which of those you actually use.',
    },
];

export function Contact() {
    return (
        <Section id="pricing" tone="raised">
            <SectionIntro
                eyebrow="Pricing · by request"
                title={
                    <>
                        Let’s talk about <span className="text-primary">what it’s worth.</span>
                    </>
                }
                lead={
                    <>
                        We are not publishing a price list yet. Write to us with what you are trying
                        to do and we will tell you plainly what it costs — and whether the free tier
                        already covers it.
                    </>
                }
            />

            <Reveal delay={220} direction="scale" className="mx-auto mt-14 max-w-2xl">
                <div className="mk-card mk-glow p-8 text-center sm:p-10">
                    <span
                        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary"
                        aria-hidden
                    >
                        <Mail className="h-5 w-5" strokeWidth={1.75} />
                    </span>

                    <p className="mt-6 text-sm text-muted-foreground">Mail us at</p>

                    {/*
                      The address is the interface, so it is set at display size
                      rather than hidden inside a button label. Someone reading
                      on a phone should be able to copy it without opening a
                      mail client, and someone on a desktop should be able to
                      click it — the anchor does both.
                    */}
                    <a
                        href={`mailto:${CONTACT_EMAIL}?subject=${SUBJECT}`}
                        className="mk-display mt-2 block break-all text-[clamp(1.25rem,3.4vw,2rem)] text-foreground transition-colors hover:text-primary"
                    >
                        {CONTACT_EMAIL}
                    </a>

                    <a
                        href={`mailto:${CONTACT_EMAIL}?subject=${SUBJECT}`}
                        className="mk-btn group mt-8 w-full sm:w-auto"
                    >
                        Contact us
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </a>

                    <p className="mt-6 text-xs text-muted-foreground/60">
                        A person reads this. Expect a reply, not a sequence.
                    </p>
                </div>
            </Reveal>

            <div className="mt-12 grid gap-5 md:grid-cols-3">
                {NOTES.map((note, index) => (
                    <Reveal key={note.title} delay={index * 100} className="mk-card p-6">
                        <h3 className="font-heading text-[15px] font-semibold leading-snug">
                            {note.title}
                        </h3>
                        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                            {note.body}
                        </p>
                    </Reveal>
                ))}
            </div>
        </Section>
    );
}
