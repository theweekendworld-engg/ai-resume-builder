import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, Check, GitPullRequest } from 'lucide-react';
import { cn } from '@/lib/utils';
import { marketingContainer, marketingType } from './Section';

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
 * ── The visual idea ─────────────────────────────────────────────────────────
 *
 * The design foundations call the theme "Your best self, in the light". Taken
 * literally: the page is a dark room and the RECORD is the lit thing. The work
 * log renders as warm ivory paper — the only bright surface above the fold —
 * because the record is the product and everything else on this page is
 * argument about it.
 *
 * The previous version put a dark card on a dark ground with a faint border.
 * It read as a screenshot of a UI. This reads as a document, which is what a
 * career record actually is, and it means the eye lands on the artifact rather
 * than on the headline shouting at it.
 */

/**
 * Resume bullets, each with the confirmed win behind it.
 *
 * The artifact has to be the thing the headline promises. This used to render
 * a work log, which made the page argue for the log while the headline argued
 * for the resume — so the visual and the pitch were selling different products.
 *
 * Showing the resume WITH its provenance underneath is the differentiator in
 * one image: any tool can produce the top line, none of them can produce the
 * line beneath it.
 */
const RESUME_LINES = [
    {
        bullet: 'Cut checkout p95 latency from 800ms to 180ms.',
        source: 'PR #482 · 19 Jul',
    },
    {
        bullet: 'Fixed a duplicate-webhook bug that double-charged 38 accounts.',
        source: 'PR #455 · 30 Jun',
    },
    {
        bullet: 'Led the payments migration off the legacy queue.',
        source: 'PR #431 · 16 Jun',
    },
];

export function Hero() {
    return (
        <section className="relative isolate overflow-hidden border-b border-border/40">
            {/*
              One light source, positioned behind the paper. A landing page gets
              exactly one glow; scattering them is how a page stops having a
              subject.
            */}
            <div
                className="pointer-events-none absolute right-[-10%] top-[-18%] -z-10 h-[640px] w-[820px] rounded-full bg-[radial-gradient(ellipse_at_center,hsl(var(--glow)/0.16),transparent_68%)] blur-3xl"
                aria-hidden
            />

            <div
                className={cn(
                    marketingContainer,
                    'grid items-start gap-14 pb-20 pt-20 lg:grid-cols-[1.12fr_0.88fr] lg:gap-14 lg:pb-24 lg:pt-24',
                )}
            >
                {/* ── the argument */}
                <div>
                    <p className="ledger rise text-[11px] uppercase tracking-[0.2em] text-primary/90">
                        Resumes, built from evidence
                    </p>

                    <h1
                        className={cn(
                            marketingType.hero,
                            'rise mt-7 text-foreground [animation-delay:80ms]',
                        )}
                    >
                        {/*
                          Three deliberate lines, each a complete thought. Left
                          to wrap, this broke as "Your company / owns / your
                          work / history." — "owns" stranded on its own line
                          and the full stop dangling, which is the difference
                          between a headline and a paragraph that happens to be
                          large.
                        */}
                        <span className="block">A resume you can</span>
                        <span className="block">defend, line by line.</span>
                        <span className="mt-1.5 block text-primary">Nothing invented.</span>
                    </h1>

                    <p
                        className={cn(
                            marketingType.lead,
                            'rise mt-7 max-w-xl [animation-delay:160ms]',
                        )}
                    >
                        Every other tool writes your resume from a blank page and your memory.
                        This one assembles it from work you logged and confirmed — so each line
                        traces back to something real, and nothing on it is invented.
                    </p>

                    <div className="rise mt-9 flex flex-wrap items-center gap-3 [animation-delay:240ms]">
                        {/*
                          The instant, no-signup proof goes first. `/score`
                          reads a real resume against a real posting and returns
                          the same coverage analysis the paid product uses, so
                          it demonstrates the thesis instead of asserting it —
                          which is worth more than a shorter path to a signup
                          form.
                        */}
                        <Link href="/score">
                            <Button size="lg" className="group h-12 gap-2 px-6 text-[15px]">
                                Check your resume — free
                                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                            </Button>
                        </Link>
                        <Link href="/sign-up?redirect_url=/build">
                            <Button
                                size="lg"
                                variant="ghost"
                                className="h-12 gap-2 px-5 text-[15px] text-muted-foreground hover:text-foreground"
                            >
                                Build one from your work
                            </Button>
                        </Link>
                    </div>

                    <p className="rise mt-7 max-w-md text-[12.5px] leading-relaxed text-muted-foreground/70 [animation-delay:320ms]">
                        No sign-up to check · 10 tailored resumes free · Never sold, never used
                        to train anything
                    </p>
                </div>

                {/* ── the artifact, lit */}
                <div className="rise relative lg:mt-16 [animation-delay:200ms]">
                    <div className="paper rounded-2xl">
                        <div className="paper-rule border-b px-5 py-4">
                            <p className="font-heading text-[15px] font-semibold">
                                Senior Backend Engineer
                            </p>
                            <p className="ledger paper-muted mt-0.5 text-[11px]">
                                Acme · 2021 – present
                            </p>
                        </div>

                        <ul>
                            {RESUME_LINES.map((line, index) => (
                                <li
                                    key={line.source}
                                    className={cn('px-5 py-3.5', index > 0 && 'paper-rule border-t')}
                                >
                                    <p className="flex gap-2.5 text-[14px] leading-snug">
                                        <span className="paper-muted select-none" aria-hidden>
                                            •
                                        </span>
                                        <span>{line.bullet}</span>
                                    </p>
                                    {/* The line beneath is the product. */}
                                    <p className="ledger paper-muted mt-2 flex items-center gap-1.5 pl-[18px] text-[10.5px]">
                                        <Check
                                            className="h-3 w-3 text-success"
                                            strokeWidth={2.5}
                                            aria-hidden
                                        />
                                        <span>you confirmed this</span>
                                        <span aria-hidden>·</span>
                                        <GitPullRequest className="h-3 w-3" aria-hidden />
                                        <span>{line.source}</span>
                                    </p>
                                </li>
                            ))}
                        </ul>

                        <div className="paper-rule flex items-center justify-between border-t px-5 py-3">
                            <span className="ledger paper-muted text-[10.5px]">
                                3 of 3 lines traced to evidence
                            </span>
                            <span className="ledger rounded-full border border-success/30 bg-success/10 px-2 py-[3px] text-[10.5px] text-success">
                                grounded
                            </span>
                        </div>
                    </div>

                    <p className="mt-4 text-center text-[12.5px] text-muted-foreground/60">
                        No other resume tool can print the second line
                    </p>
                </div>
            </div>
        </section>
    );
}
