import { Check, GitPullRequest, NotebookPen } from 'lucide-react';
import { marketingContainer } from './Section';
import { Reveal } from './Reveal';

/**
 * The band under the hero: a page from a record.
 *
 * ── What normally goes here, and why it does not ────────────────────────────
 *
 * This slot — full-bleed strip, directly beneath the fold — is the customer
 * logo wall. Every landing page in this shape has one, and the reference design
 * this page borrows its language from fills it with twelve invented companies
 * under the words "trusted by 100+ businesses worldwide".
 *
 * We cannot do that, and not only because `pricing.test.ts` fails the build on
 * it. This product's entire claim is that a generated line carries a source. A
 * page that opens by asserting customers it does not have has already lost the
 * argument it spends the next six sections making — and it would be the exact
 * failure mode the numeric guard exists to prevent, committed by us, in our own
 * shop window.
 *
 * So the strip shows what the format is genuinely for: the record itself. These
 * are example entries, labelled as example entries.
 *
 * ── Why it stopped scrolling (Dossier, 2026-11-08) ──────────────────────────
 *
 * It was two marquee rows sliding in opposite directions. A claim you cannot
 * stop to read is a poor way to show that every claim carries a source, and
 * moving content that starts on its own is a WCAG 2.2.2 problem before it is a
 * design one. It is now what the product actually produces: a ruled sheet,
 * each line with its source tag beside it, the same shape as an entry in the
 * Work Log. Still, so the eye can check the claim against the source.
 */

type Entry = { claim: string; source: string };

const ROW_ONE: readonly Entry[] = [
    { claim: 'Cut checkout p95 latency 800ms → 180ms', source: 'PR #482' },
    { claim: 'Led the payments migration off the legacy queue', source: 'PR #431' },
    { claim: 'Ran the Thursday incident, wrote the postmortem', source: 'you added this' },
    { claim: 'Fixed the duplicate-webhook double-charge', source: 'PR #455' },
    { claim: 'Mentored two engineers through their first on-call', source: 'you added this' },
    { claim: 'Wave 3 cutover, zero downtime', source: 'PR #418' },
];

const ROW_TWO: readonly Entry[] = [
    { claim: 'Rewrote the ingest retry path, halved the error rate', source: 'PR #506' },
    { claim: 'Turned around the design review in a day', source: 'you added this' },
    { claim: 'Deleted the dead billing cron nobody owned', source: 'PR #470' },
    { claim: 'Took the on-call rotation through the holiday freeze', source: 'you added this' },
    { claim: 'Cut the deploy pipeline from 22 to 9 minutes', source: 'PR #499' },
    { claim: 'Backfilled two years of history from old commits', source: 'PR #388' },
];

/** One line of the record: confirmed mark, the claim, and where it came from. */
function Line({ claim, source }: Entry) {
    const fromNote = source === 'you added this';
    const SourceIcon = fromNote ? NotebookPen : GitPullRequest;
    return (
        <li className="flex items-start gap-3 border-b border-border py-3 last:border-b-0 sm:items-center">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success sm:mt-0" strokeWidth={2.5} aria-label="Confirmed" />
            <span className="min-w-0 flex-1 text-[14px] leading-snug text-foreground">{claim}</span>
            <span className="mk-source shrink-0">
                <SourceIcon className="h-3 w-3" aria-hidden />
                {source}
            </span>
        </li>
    );
}

export function EvidenceTicker() {
    return (
        <section className="mk-band border-b border-border py-16 lg:py-20">
            <div className={marketingContainer}>
                <Reveal>
                    <p className="eyebrow text-center">What a confirmed record looks like</p>
                </Reveal>

                <Reveal delay={80} className="mx-auto mt-8 max-w-5xl">
                    <div className="paper rounded-lg">
                        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
                            <p className="font-display text-[15px] font-semibold text-foreground">Work Log</p>
                            <p className="ledger text-[11px] text-muted-foreground">12 entries · all confirmed</p>
                        </div>
                        <div className="grid px-5 md:grid-cols-2 md:gap-x-10">
                            <ul>
                                {ROW_ONE.map((entry) => (
                                    <Line key={entry.claim} {...entry} />
                                ))}
                            </ul>
                            <ul className="border-t border-border md:border-t-0">
                                {ROW_TWO.map((entry) => (
                                    <Line key={entry.claim} {...entry} />
                                ))}
                            </ul>
                        </div>
                    </div>
                </Reveal>

                <Reveal delay={120}>
                    <p className="mt-6 text-center text-xs text-muted-foreground">
                        Example entries. Yours come from the wins you log.
                    </p>
                </Reveal>
            </div>
        </section>
    );
}
