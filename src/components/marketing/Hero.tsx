import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, Check, GitPullRequest } from 'lucide-react';

/**
 * The hero states the thesis, not the feature list.
 *
 * The previous version led with "Land more interviews, apply in minutes",
 * which sells the episodic job-search product. Strategy v3 §12 repositioned
 * Patronus around a permanent need — "I cannot remember what I actually did" —
 * and a market that is everyone with a performance review, rather than the
 * 5–8% of knowledge workers hunting at any given moment.
 *
 * The visual is the product's own artifact: Win rows with evidence chips,
 * in the shape they really take. Someone who has tried to keep a brag doc
 * recognises this immediately, and it is more honest than an abstract gradient
 * that could belong to any SaaS.
 */

/** The shape of real logged Wins, arrow metric and all. */
const SAMPLE_WINS = [
    {
        date: 'Jul 19',
        title: 'Cut checkout p95 latency 800ms → 180ms',
        source: 'PR #482',
    },
    {
        date: 'Jun 30',
        title: 'Fixed the duplicate-webhook bug that double-charged 38 accounts',
        source: 'PR #455',
    },
    {
        date: 'Jun 16',
        title: 'Led the payments migration off the legacy queue',
        source: 'PR #431',
    },
];

export function Hero() {
    return (
        <section className="relative isolate overflow-hidden border-b border-border/40">
            <div
                className="pointer-events-none absolute -top-48 left-1/4 -z-10 h-[520px] w-[720px] rounded-full bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.12),transparent_70%)] blur-2xl"
                aria-hidden
            />

            <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-20 pt-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-28 lg:pt-28">
                {/* ── the argument */}
                <div>
                    <p className="animate-fade-in-up inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        The career operating system
                    </p>

                    <h1 className="font-heading animate-fade-in-up animation-delay-100 mt-6 text-4xl font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-[3.4rem]">
                        Your company owns your work history.
                        <span className="mt-2 block text-primary">This one is yours.</span>
                    </h1>

                    <p className="animate-fade-in-up animation-delay-200 mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                        Patronus is the private, evidence-backed record of what you actually did —
                        kept as you go, so review week, a promotion case, and a job search all draw
                        on the same years of proof instead of your memory.
                    </p>

                    <div className="animate-fade-in-up animation-delay-300 mt-8 flex flex-wrap items-center gap-3">
                        <Link href="/sign-up?redirect_url=/log">
                            <Button size="lg" className="group gap-2 px-6">
                                Start your work log
                                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                            </Button>
                        </Link>
                        <Link href="/score">
                            <Button size="lg" variant="outline" className="gap-2 px-6">
                                Check a resume — free
                            </Button>
                        </Link>
                    </div>

                    <p className="animate-fade-in-up animation-delay-400 mt-5 text-xs text-muted-foreground/70">
                        Free forever to keep a record · No credit card · Your log is never sold, and
                        never used to train anything
                    </p>
                </div>

                {/* ── the artifact */}
                <div className="animate-fade-in-up animation-delay-200 relative">
                    <div className="rounded-2xl border border-border/60 bg-card/60 p-1 shadow-2xl backdrop-blur-sm">
                        <div className="rounded-xl border border-border/40 bg-background/60">
                            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
                                <p className="font-heading text-sm font-semibold">Work log</p>
                                <span className="text-[11px] text-muted-foreground">
                                    3 wins · all with evidence
                                </span>
                            </div>

                            <ul className="divide-y divide-border/30">
                                {SAMPLE_WINS.map((win) => (
                                    <li key={win.title} className="px-4 py-3">
                                        <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
                                            <span className="tabular-nums">{win.date}</span>
                                            <span aria-hidden="true">·</span>
                                            <span>Acme</span>
                                        </div>
                                        <p className="mt-1 text-sm leading-snug text-foreground">
                                            {win.title}
                                        </p>
                                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                            <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] text-success">
                                                <Check className="h-3 w-3" strokeWidth={2.5} />
                                                You confirmed this
                                            </span>
                                            <span className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                                                <GitPullRequest className="h-3 w-3" />
                                                {win.source}
                                            </span>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    <p className="mt-3 text-center text-[11px] text-muted-foreground/70">
                        Every claim carries a link back to where it came from.
                    </p>
                </div>
            </div>
        </section>
    );
}
