import Link from 'next/link';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { freeResumeCap } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { START_FREE_HREF } from './links';
import { marketingContainer, marketingType } from './Section';
import { Ambience, Reveal } from './Reveal';
import { ChatDemo } from './ChatDemo';

/**
 * The hero leads with the resume, and lets the record explain why it is good.
 *
 * ── The tension, and how it resolves ────────────────────────────────────────
 *
 * Strategy v3 §12 repositioned the PRODUCT around a permanent need — "I cannot
 * remember what I actually did" — rather than the 5–8% of people job-hunting at
 * any moment. That is right for what to build and right for retention.
 *
 * It was wrong for the top of the funnel. Leading with "keep a work log" asks a
 * stranger to accept a slow-burn thesis before they have seen anything work.
 * The resume is the acute need: urgent, understood in three words, and the
 * thing people actually search for.
 *
 * So the hero sells the resume and the record arrives as the REASON it is
 * better — "assembled from evidence you confirmed" is a claim no other resume
 * tool can make, and it only means something because the log exists. The log
 * is the mechanism, revealed in §How it works; it is not the pitch.
 *
 * ── The composition ─────────────────────────────────────────────────────────
 *
 * Centred, not split. The previous version ran the argument down the left and
 * the artifact down the right, which is the standard SaaS two-column and has
 * one structural flaw: the headline and the proof compete for the same glance,
 * and neither wins. Stacking them makes the page a sequence — claim, then the
 * evidence for it, in the order you would say them out loud.
 *
 * The light behaves the way it does everywhere else on this page: one source,
 * drifting, with the paper as the only bright surface. `Ambience` carries the
 * blobs; `sweep` is on here because the hero is one of two places allowed the
 * expensive rotating layer.
 *
 * The stagger is 80ms per element, top to bottom. Fast enough that the page
 * feels assembled rather than animated, slow enough to read as intentional.
 */

export function Hero() {
    return (
        <section className="mk-hero-bg relative isolate overflow-hidden border-b border-border/60">
            <Ambience sweep />

            <div className={cn(marketingContainer, 'relative pb-24 pt-28 text-center lg:pt-32')}>
                <Reveal as="span" className="mk-pill">
                    Your working life, on the record
                </Reveal>

                {/*
                  The headline itself drifts, which is the reference's move and
                  the reason its hero feels alive rather than composed. It is a
                  10px rise over 6 seconds — far too slow to read as animation
                  while you are reading the words, and unmistakable the moment
                  you stop.
                */}
                <Reveal delay={80}>
                    <h1 className={cn(marketingType.hero, 'mk-float mx-auto mt-8 max-w-4xl')}>
                        The assistant that knows your work,{' '}
                        <span className="text-primary">for your whole career.</span>
                    </h1>
                </Reveal>

                <Reveal delay={160}>
                    <p className={cn(marketingType.lead, 'mx-auto mt-7 max-w-2xl')}>
                        Tell Patronus what you shipped, in a sentence, whenever it happens. It keeps
                        the record, checks any job against it, tailors your resume, drafts the note to
                        the recruiter and gets your next review ready. Every line traces back to
                        something you confirmed, and{' '}
                        <span className="font-semibold text-foreground">nothing is invented.</span>
                    </p>
                </Reveal>

                <Reveal
                    delay={240}
                    className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
                >
                    {/*
                      The instant, no-signup proof goes first. `/score` reads a
                      real resume against a real posting and returns the same
                      coverage analysis the paid product uses, so it
                      demonstrates the thesis instead of asserting it — which is
                      worth more than a shorter path to a signup form.
                    */}
                    {/* The one pulsing element on the page. */}
                    <Link href="/score" className="mk-btn mk-pulse group w-full sm:w-auto">
                        Check your resume — free
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                    <Link href={START_FREE_HREF} className="mk-btn-ghost w-full sm:w-auto">
                        Start free
                    </Link>
                </Reveal>

                <Reveal delay={320}>
                    <p className="mx-auto mt-7 max-w-lg text-[13px] leading-relaxed text-muted-foreground/70">
                        Chat on the web or on Telegram ·{' '}
                        {freeResumeCap()} tailored resumes free · Never sold, never used to train anything
                    </p>
                </Reveal>

                {/*
                  The artifact is the product itself now (redesign 2026-10-02):
                  a conversation that ends in the resume line with its
                  provenance beneath it. The provenance line is still the
                  differentiator; the chat is how you get there.
                */}
                <Reveal delay={400} direction="scale" className="mx-auto mt-20 max-w-2xl">
                    <ChatDemo />
                    <p className="mt-5 text-center text-[13px] text-muted-foreground/60">
                        The figure on the resume is the one you typed. No other resume tool can print the line beneath it.
                    </p>
                </Reveal>
            </div>

            <div
                className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 text-muted-foreground/40"
                aria-hidden
            >
                <ChevronDown className="mk-bob h-5 w-5" />
            </div>
        </section>
    );
}
