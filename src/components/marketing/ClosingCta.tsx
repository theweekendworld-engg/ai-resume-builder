import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

/**
 * The close.
 *
 * Argues from cost of delay rather than urgency theatre: no countdown, no
 * "limited spots". The honest pitch is that a log is worth more the earlier it
 * starts, and the work you cannot remember is already gone.
 */
export function ClosingCta() {
    return (
        <section className="relative isolate overflow-hidden">
            <div
                className="pointer-events-none absolute -bottom-40 left-1/2 -z-10 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.10),transparent_70%)] blur-2xl"
                aria-hidden
            />
            <div className="mx-auto w-full max-w-3xl px-4 py-24 text-center sm:px-6 lg:py-28">
                <h2 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
                    The best time to start was three years ago.
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
                    You cannot get those back — but you can reconstruct some of them, and you can
                    make sure the next three are never in question. Start with this week.
                </p>

                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <Link href="/sign-up?redirect_url=/log">
                        <Button size="lg" className="group gap-2 px-6">
                            Start your work log — free
                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </Button>
                    </Link>
                    <Link href="/score">
                        <Button size="lg" variant="ghost" className="text-muted-foreground">
                            Just check a resume
                        </Button>
                    </Link>
                </div>
            </div>
        </section>
    );
}
