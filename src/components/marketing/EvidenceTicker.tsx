import { Check, GitPullRequest } from 'lucide-react';
import { Reveal } from './Reveal';

/**
 * The band under the hero: a record, scrolling.
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
 * are example entries, labelled as example entries. The motion sells the idea
 * better than logos would anyway — the point of the product is that the log
 * keeps accruing whether or not you are thinking about it, and a ticker is that
 * sentence made visual.
 *
 * ── Mechanics ───────────────────────────────────────────────────────────────
 *
 * Each row renders its entries twice and translates -50%, so the second copy
 * lands exactly where the first began and the loop has no seam. `aria-hidden`
 * on the duplicate keeps a screen reader from reading the list twice; the row
 * is decorative in any case, which is why the section carries no heading of its
 * own. Hovering pauses both rows — a moving element you cannot stop to read is
 * an accessibility problem before it is a design one.
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

function Chip({ claim, source }: Entry) {
    return (
        <span className="inline-flex shrink-0 items-center gap-2.5 rounded-full border border-border bg-background px-5 py-3">
            <Check className="h-3.5 w-3.5 shrink-0 text-success" strokeWidth={2.5} aria-hidden />
            <span className="text-[13.5px] font-medium text-foreground">{claim}</span>
            <span className="ledger flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                <GitPullRequest className="h-3 w-3" aria-hidden />
                {source}
            </span>
        </span>
    );
}

function Row({ entries, reverse }: { entries: readonly Entry[]; reverse?: boolean }) {
    return (
        <div className="mk-marquee-mask overflow-hidden">
            <div
                className={`flex w-max gap-3 whitespace-nowrap ${
                    reverse ? 'mk-marquee-rev' : 'mk-marquee'
                }`}
            >
                {entries.map((entry) => (
                    <Chip key={entry.claim} {...entry} />
                ))}
                {entries.map((entry) => (
                    <span key={`${entry.claim}-copy`} className="shrink-0" aria-hidden>
                        <Chip {...entry} />
                    </span>
                ))}
            </div>
        </div>
    );
}

export function EvidenceTicker() {
    return (
        <section className="mk-marquee-hover overflow-hidden border-b border-border/60 bg-card/30 py-16 lg:py-20">
            <Reveal>
                <p className="mb-9 text-center text-[11px] font-bold uppercase tracking-[0.3em] text-muted-foreground/70">
                    What a confirmed record looks like
                </p>
            </Reveal>

            <div className="space-y-3">
                <Row entries={ROW_ONE} />
                <Row entries={ROW_TWO} reverse />
            </div>

            <Reveal delay={120}>
                <p className="mt-9 text-center text-xs text-muted-foreground/50">
                    Example entries. Yours come from the wins you log.
                </p>
            </Reveal>
        </section>
    );
}
