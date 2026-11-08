import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { START_FREE_HREF } from './links';
import { marketingContainer, marketingType } from './Section';
import { Reveal } from './Reveal';
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
 * Ink on paper, one teal button. The page used to put a drifting light and a
 * rotating sweep behind this headline and make the headline itself float;
 * Dossier keeps motion for changes of state only, so the hero is still and
 * the type does the work. The stagger on arrival is 80ms per element, top to
 * bottom: content arriving is a state change, and that is all it marks.
 */

export function Hero() {
    return (
        <section className="mk-hero-bg relative isolate overflow-hidden border-b border-border">
            <div className={cn(marketingContainer, 'relative pb-20 pt-20 text-center sm:pt-24 lg:pb-24 lg:pt-28')}>
                <Reveal as="span" className="mk-pill">
                    Your working life, on the record
                </Reveal>

                <Reveal delay={80}>
                    <h1 className={cn(marketingType.hero, 'mx-auto mt-7 max-w-4xl')}>
                        The assistant that knows your work,{' '}
                        <span className="mk-quiet">for your whole career.</span>
                    </h1>
                </Reveal>

                <Reveal delay={160}>
                    <p className={cn(marketingType.lead, 'mx-auto mt-6 max-w-2xl')}>
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
                    <Link href="/score" className="mk-btn w-full sm:w-auto">
                        Check your resume — free
                        <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                    <Link href={START_FREE_HREF} className="mk-btn-ghost w-full sm:w-auto">
                        Start free
                    </Link>
                </Reveal>

                <Reveal delay={320}>
                    <p className="mx-auto mt-7 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
                        Chat on the web or on Telegram · Free while we launch, every feature
                        included · Never sold, never used to train anything
                    </p>
                </Reveal>

                {/*
                  The artifact is the product itself now (redesign 2026-10-02):
                  a conversation that ends in the resume line with its
                  provenance beneath it. The provenance line is still the
                  differentiator; the chat is how you get there.
                */}
                <Reveal delay={400} className="mx-auto mt-16 max-w-2xl">
                    <ChatDemo />
                    <p className="mt-5 text-center text-[13px] text-muted-foreground">
                        The figure on the resume is the one you typed. No other resume tool can print the line beneath it.
                    </p>
                </Reveal>
            </div>
        </section>
    );
}
