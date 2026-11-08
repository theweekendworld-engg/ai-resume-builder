import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { marketingContainer, marketingType } from './Section';
import { START_FREE_HREF } from './links';
import { Reveal } from './Reveal';

/**
 * The close.
 *
 * Argues from cost of delay rather than urgency theatre: no countdown, no
 * "limited spots", no "first month 50% off" banner. The honest pitch is that a
 * log is worth more the earlier it starts, and the work you cannot remember is
 * already gone — which is a genuinely urgent thing to say and does not need a
 * timer attached to it.
 *
 * Flat paper, like the hero: the page opens and closes on the same sheet,
 * which is what makes the scroll read as one document rather than a stack of
 * sections. The rotating light that used to bookend it is gone (Dossier rules:
 * no glow, motion only for state).
 */
export function ClosingCta() {
    return (
        <section className="mk-cta-bg relative">

            <div className={cn(marketingContainer, 'py-28 text-center lg:py-36')}>
                <Reveal as="span" className="mk-pill">
                    Free to start · No card
                </Reveal>

                <Reveal delay={80}>
                    <h2 className={cn(marketingType.section, 'mx-auto mt-6 max-w-3xl')}>
                        The best time to start{' '}
                        <span className="mk-quiet">was three years ago.</span>
                    </h2>
                </Reveal>

                <Reveal delay={160}>
                    <p className={cn(marketingType.lead, 'mx-auto mt-6 max-w-xl')}>
                        You cannot get those back — but a sentence each is enough to log the ones
                        you remember, and to make sure the next three are never in question. Start
                        with this week.
                    </p>
                </Reveal>

                <Reveal
                    delay={240}
                    className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
                >
                    <Link href={START_FREE_HREF} className="mk-btn w-full sm:w-auto">
                        Start free
                        <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                    <Link href="/score" className="mk-btn-ghost w-full sm:w-auto">
                        Just check a resume
                    </Link>
                </Reveal>
            </div>
        </section>
    );
}
