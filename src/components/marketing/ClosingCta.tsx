import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { marketingContainer, marketingType } from './Section';
import { Ambience, Reveal } from './Reveal';

/**
 * The close.
 *
 * Argues from cost of delay rather than urgency theatre: no countdown, no
 * "limited spots", no "first month 50% off" banner. The honest pitch is that a
 * log is worth more the earlier it starts, and the work you cannot remember is
 * already gone — which is a genuinely urgent thing to say and does not need a
 * timer attached to it.
 *
 * This is the second of the two places allowed the expensive rotating sweep
 * (the hero is the other). Bookending the page with the same light is what
 * makes the scroll feel like one document rather than a stack of sections, and
 * it means the last thing on screen before the footer is the brightest.
 */
export function ClosingCta() {
    return (
        <section className="mk-cta-bg relative isolate overflow-hidden">
            <Ambience sweep />

            <div className={cn(marketingContainer, 'py-28 text-center lg:py-36')}>
                <Reveal as="span" className="mk-pill">
                    Free to start · No card
                </Reveal>

                <Reveal delay={80}>
                    <h2 className={cn(marketingType.section, 'mx-auto mt-7 max-w-3xl')}>
                        The best time to start{' '}
                        <span className="text-primary">was three years ago.</span>
                    </h2>
                </Reveal>

                <Reveal delay={160}>
                    <p className={cn(marketingType.lead, 'mx-auto mt-6 max-w-xl')}>
                        You cannot get those back — but you can reconstruct some of them, and you
                        can make sure the next three are never in question. Start with this week.
                    </p>
                </Reveal>

                <Reveal
                    delay={240}
                    className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
                >
                    <Link href="/sign-up?redirect_url=/build" className="mk-btn group w-full sm:w-auto">
                        Start free
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                    <Link href="/score" className="mk-btn-ghost w-full sm:w-auto">
                        Just check a resume
                    </Link>
                </Reveal>
            </div>
        </section>
    );
}
