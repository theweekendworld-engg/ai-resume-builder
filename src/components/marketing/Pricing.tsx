import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';
import { CAREER_PLAN, FREE_PLAN, SEARCH_PLAN, type PlanDefinition } from '@/lib/plans';
import { Section, SectionIntro } from './Section';

/**
 * Pricing, read from the catalog rather than retyped.
 *
 * The previous version hardcoded its own perk list and never mentioned a
 * price, while `src/lib/plans.ts` held the real packaging. Two sources of
 * truth for what something costs is a bug that surfaces as a support ticket,
 * so names, prices and cadences now come from `PLAN_CATALOG` — change the
 * catalog and this page follows.
 *
 * The highlight lists are curated here on purpose rather than rendered from
 * `PLAN_COMPARISON`. That table is the authenticated change-plan surface and
 * currently includes rows for capabilities that are not built yet; listing
 * them to a logged-out visitor deciding whether to trust us would be exactly
 * the kind of unearned claim this product refuses to put in a resume.
 */

/** Only capabilities that exist in the product today. */
const HIGHLIGHTS: Record<string, readonly string[]> = {
    free: [
        'Unlimited wins, kept forever',
        'GitHub auto-drafting',
        'Weekly digest',
        '10 tailored resumes',
        'Everything else, a few times over',
    ],
    career: [
        'Everything in Free',
        'Performance-review and promotion packets',
        'Level readiness against your rubric',
        'Month in Review',
        'Reconstruct the years before Patronus',
    ],
    search: [
        'Everything in Career',
        'Unlimited tailored resumes',
        'Application autofill and saved answers',
        'Application tracking',
    ],
};

function headline(plan: PlanDefinition): { amount: string; cadence: string } {
    if (plan.prices.length === 0) return { amount: 'Free', cadence: 'forever' };
    // Prefer the recommended price; otherwise the first listed.
    const price = plan.prices.find((p) => p.recommended) ?? plan.prices[0];
    return { amount: price.label, cadence: price.cadence };
}

/** The monthly alternative, when an annual price is the headline. */
function alternate(plan: PlanDefinition): string | null {
    const shown = plan.prices.find((p) => p.recommended) ?? plan.prices[0];
    const other = plan.prices.find((p) => p !== shown);
    return other ? `or ${other.label}` : null;
}

const COLUMNS: ReadonlyArray<{
    plan: PlanDefinition;
    key: keyof typeof HIGHLIGHTS;
    cta: string;
    href: string;
    featured: boolean;
    note?: string;
}> = [
    {
        plan: FREE_PLAN,
        key: 'free',
        cta: 'Start your work log',
        href: '/sign-up?redirect_url=/log',
        featured: false,
    },
    {
        plan: CAREER_PLAN,
        key: 'career',
        cta: 'Get Career',
        href: '/sign-up?redirect_url=/settings/plan',
        featured: true,
    },
    {
        plan: SEARCH_PLAN,
        key: 'search',
        cta: 'Get Search',
        href: '/sign-up?redirect_url=/settings/plan',
        featured: false,
        note: 'Sits on top of Career and is billed separately, so switching it off leaves everything else as it was.',
    },
];

export function Pricing() {
    return (
        <Section id="pricing">
            <SectionIntro
                eyebrow="Pricing"
                title="Logging is free. We charge for what we do with it."
                lead={
                    <>
                        The record is the part you should never have to pay to keep — losing it is
                        the problem we exist to solve.
                    </>
                }
            />

            <div className="mt-12 grid gap-5 lg:grid-cols-3">
                {COLUMNS.map(({ plan, key, cta, href, featured, note }) => {
                    const { amount, cadence } = headline(plan);
                    const other = alternate(plan);

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
                                    Most people
                                </span>
                            ) : null}

                            <div className="flex items-baseline justify-between gap-2">
                                <h3 className="font-heading text-lg font-semibold">{plan.name}</h3>
                                <span className="text-xs text-muted-foreground">{plan.blurb}</span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{plan.audience}</p>

                            <div className="mt-5">
                                <p className="font-heading text-3xl font-semibold tabular-nums">
                                    {amount}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {cadence}
                                    {other ? ` · ${other}` : ''}
                                </p>
                            </div>

                            <ul className="mt-6 flex-1 space-y-2.5">
                                {HIGHLIGHTS[key].map((item) => (
                                    <li key={item} className="flex gap-2.5 text-sm">
                                        <Check
                                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                                            strokeWidth={2.5}
                                            aria-hidden
                                        />
                                        <span className="text-muted-foreground">{item}</span>
                                    </li>
                                ))}
                            </ul>

                            {note ? (
                                <p className="mt-4 text-xs leading-relaxed text-muted-foreground/70">
                                    {note}
                                </p>
                            ) : null}

                            <Link href={href} className="mt-6">
                                <Button
                                    className="w-full"
                                    variant={featured ? 'default' : 'outline'}
                                >
                                    {cta}
                                </Button>
                            </Link>
                        </div>
                    );
                })}
            </div>

            <p className="mt-8 text-center text-xs text-muted-foreground/70">
                Limits are always shown before you reach them. Downgrade and your history is hidden,
                never deleted.
            </p>
        </Section>
    );
}
