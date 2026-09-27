import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Check, Clock } from 'lucide-react';
import {
    CAREER_PLAN,
    FREE_PLAN,
    SEARCH_PLAN,
    freeResumeCap,
    isUnlimited,
    meteredLimit,
    type PlanDefinition,
} from '@/lib/plans';
import { START_FREE_HREF } from './links';
import { Section, SectionIntro } from './Section';

/**
 * Pricing, read from the catalog rather than retyped.
 *
 * Names, prices and cadences come from `PLAN_CATALOG`, and every limit comes
 * from `meteredLimit` — no numeric limit is written here (plans.ts rule 2).
 *
 * ── What is listed ──────────────────────────────────────────────────────────
 *
 * A highlight is either `live` (a new user can use it today) or `soon` (built,
 * not yet switched on for everyone), and a `soon` item is always labelled as
 * such. The previous version listed packets, rubric readiness, Month in Review
 * and GitHub auto-drafting as plain features while every one of them was off
 * for new users (audit 2026-09-27, "Stop advertising what's off").
 *
 * ── Why paid plans are not buyable here ─────────────────────────────────────
 *
 * Payments are not live yet. The prices are shown because a visitor deciding
 * whether to invest in a record deserves to know what it will cost, and a
 * payment gateway's review needs a visible price list. The buttons say so
 * instead of leading to a plan page that cannot take money.
 */

type Highlight = { text: string; soon?: boolean };

function tailoredLine(plan: PlanDefinition): string {
    if (plan.tier === FREE_PLAN.tier) return `${freeResumeCap()} tailored resumes, free`;
    const limit = meteredLimit(plan.tier, 'tailored_generation');
    return isUnlimited(limit.limit)
        ? 'Unlimited tailored resumes'
        : `${limit.limit} tailored resumes a month`;
}

export function pricingHighlights(): Record<'free' | 'career' | 'search', Highlight[]> {
    return {
        free: [
            { text: 'Free resume check with a prioritised fix list' },
            { text: tailoredLine(FREE_PLAN) },
            { text: 'Tailor to any job by pasting it in' },
            { text: 'Log wins in a sentence; your record is kept forever' },
        ],
        career: [
            { text: 'Everything in Free' },
            { text: tailoredLine(CAREER_PLAN) },
            { text: 'Your full log history, not just recent months' },
            { text: 'Performance-review and promotion packets', soon: true },
            { text: 'Level readiness against your rubric', soon: true },
            { text: 'Month in Review', soon: true },
        ],
        search: [
            { text: 'Everything in Career' },
            { text: tailoredLine(SEARCH_PLAN) },
            { text: 'Job links analysed for fit, pay and interview write-ups', soon: true },
            { text: 'Application autofill in the browser', soon: true },
        ],
    };
}

function headline(plan: PlanDefinition): { amount: string; cadence: string } {
    if (plan.prices.length === 0) return { amount: 'Free', cadence: 'forever' };
    const price = plan.prices.find((p) => p.recommended) ?? plan.prices[0];
    return { amount: price.label, cadence: price.cadence };
}

const COLUMNS: ReadonlyArray<{
    plan: PlanDefinition;
    key: 'free' | 'career' | 'search';
    featured: boolean;
    note?: string;
}> = [
    { plan: FREE_PLAN, key: 'free', featured: true },
    { plan: CAREER_PLAN, key: 'career', featured: false },
    {
        plan: SEARCH_PLAN,
        key: 'search',
        featured: false,
        note: 'Added on top of Career, and billed separately, so switching it off leaves everything else as it was.',
    },
];

export function Pricing({ id = 'pricing' }: { id?: string }) {
    const highlights = pricingHighlights();

    return (
        <Section id={id}>
            <SectionIntro
                eyebrow="Pricing"
                title="Logging is free. We charge for what we do with it."
                lead={
                    <>
                        The free plan works today and has no time limit. Paid plans open soon;
                        these are the prices they will open at.
                    </>
                }
            />

            <div className="mt-12 grid gap-5 lg:grid-cols-3">
                {COLUMNS.map(({ plan, key, featured, note }) => {
                    const { amount, cadence } = headline(plan);
                    const isFree = plan.tier === FREE_PLAN.tier;

                    return (
                        <div
                            key={plan.tier}
                            className={
                                featured
                                    ? 'relative flex flex-col rounded-xl border border-primary/40 bg-background/70 p-6 shadow-lg'
                                    : 'relative flex flex-col rounded-xl border border-border/50 bg-background/40 p-6'
                            }
                        >
                            {featured ? (
                                <span className="absolute -top-2.5 left-6 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                                    Available now
                                </span>
                            ) : null}

                            <div className="flex items-baseline justify-between gap-2">
                                <h3 className="font-heading text-lg font-semibold">{plan.name}</h3>
                                <span className="text-xs text-muted-foreground">{plan.blurb}</span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{plan.audience}</p>

                            <div className="mt-5">
                                <p className="font-heading text-3xl font-semibold tabular-nums">{amount}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{cadence}</p>
                            </div>

                            <ul className="mt-6 flex-1 space-y-2.5">
                                {highlights[key].map((item) => (
                                    <li key={item.text} className="flex gap-2.5 text-sm">
                                        {item.soon ? (
                                            <Clock
                                                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                                                strokeWidth={2.25}
                                                aria-hidden
                                            />
                                        ) : (
                                            <Check
                                                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                                                strokeWidth={2.5}
                                                aria-hidden
                                            />
                                        )}
                                        <span className={item.soon ? 'text-muted-foreground/70' : 'text-muted-foreground'}>
                                            {item.text}
                                            {item.soon ? <span className="ml-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/60">· coming soon</span> : null}
                                        </span>
                                    </li>
                                ))}
                            </ul>

                            {note ? (
                                <p className="mt-4 text-xs leading-relaxed text-muted-foreground/70">{note}</p>
                            ) : null}

                            {isFree ? (
                                <Link href={START_FREE_HREF} className="mt-6">
                                    <Button className="w-full">Start free</Button>
                                </Link>
                            ) : (
                                <Button className="mt-6 w-full" variant="outline" disabled aria-disabled>
                                    Opening soon
                                </Button>
                            )}
                        </div>
                    );
                })}
            </div>

            <p className="mt-8 text-center text-xs text-muted-foreground/70">
                Paid plans open soon. Limits are always shown before you reach them. Downgrade and
                your history is hidden, never deleted. See the{' '}
                <Link href="/refund-policy" className="underline-offset-4 hover:underline">
                    refund and cancellation policy
                </Link>
                .
            </p>
        </Section>
    );
}
