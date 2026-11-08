import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import {
    FREE_PLAN,
    isUnlimited,
    jobWatchCompanyLimit,
    meteredLimit,
    type MeteredAction,
} from '@/lib/plans';
import { START_FREE_HREF } from './links';
import { Section, SectionIntro } from './Section';
import { Reveal } from './Reveal';

/**
 * Pricing during the launch (owner decision, 2026-11-07): free, with every
 * feature included.
 *
 * Nothing can be bought yet; payments wait for a Merchant of Record. The page
 * used to list Career and Search at their future prices with "Opening soon"
 * buttons, and marked shipped features (job-link analysis, packets, Month in
 * Review) as coming soon. Both said the opposite of what an account actually
 * gets, which is everything (`launchOpenAccess` in `src/lib/plans.ts`).
 *
 * Every number comes from the plan catalog (`meteredLimit`,
 * `jobWatchCompanyLimit`), so the page cannot promise more than the code
 * allows. No limit is written here (plans.ts rule 2).
 *
 * When paid plans return, this section is rewritten with them: the catalog
 * still has their names and prices (`PLAN_CATALOG`), and the old three-column
 * layout is in git history.
 */

/** "100 tailored resumes a month", or "Unlimited tailored resumes". */
function perMonth(action: MeteredAction, noun: string, rest = ''): string {
    const { limit } = meteredLimit(FREE_PLAN.tier, action);
    const head = isUnlimited(limit) ? `Unlimited ${noun}` : `${limit} ${noun} a month`;
    return rest ? `${head}${rest}` : head;
}

/** What every account gets during the launch, in the order a job search uses it. */
export function launchHighlights(): string[] {
    const companies = jobWatchCompanyLimit(FREE_PLAN.tier);
    return [
        perMonth('tailored_generation', 'tailored resumes', ', each built from your own record'),
        perMonth('link_analysis', 'job links or posts checked', ': fit, company, pay and people to contact'),
        perMonth('cover_letter', 'application emails and outreach notes', ', opened in your own Gmail'),
        isUnlimited(companies)
            ? 'Nightly Telegram alerts for every company you name'
            : `Nightly Telegram alerts for up to ${companies} companies you name`,
        'Forwarded job email, filed under the right application',
        'The Work Log, review and promotion packets, level readiness and Month in Review',
        'Your whole history, kept, with nothing hidden',
    ];
}

export function Pricing({ id = 'pricing' }: { id?: string }) {
    const highlights = launchHighlights();

    return (
        <Section id={id}>
            <SectionIntro
                eyebrow="Pricing"
                title={
                    <>
                        Free while we launch.{' '}
                        <span className="mk-quiet">Every feature included.</span>
                    </>
                }
                lead="There is nothing to buy yet. Every account gets the whole product, with monthly allowances sized so an active job search does not run into them."
            />

            <Reveal delay={200} className="mx-auto mt-12 max-w-4xl">
                <div className="mk-card mk-rail grid gap-8 p-7 sm:p-9 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-10">
                    <div className="flex flex-col">
                        <h3 className="eyebrow">{FREE_PLAN.name}</h3>
                        <p className="num mt-3 font-display text-5xl font-semibold leading-none tracking-[-0.02em]">$0</p>
                        <p className="mt-1 text-sm text-muted-foreground">while we launch · no card</p>
                        <Link href={START_FREE_HREF} className="mk-btn mt-7 w-full md:mt-auto">
                            Start free
                            <ArrowRight className="h-4 w-4" aria-hidden />
                        </Link>
                    </div>

                    <ul className="divide-y divide-border border-y border-border md:border-t-0" aria-label="Included in every account">
                        {highlights.map((text) => (
                            <li key={text} className="flex gap-3 py-2.5 text-sm leading-relaxed">
                                <Check
                                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                                    strokeWidth={2.5}
                                    aria-hidden
                                />
                                <span className="text-foreground">{text}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </Reveal>

            <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-muted-foreground">
                Paid plans come later, with notice first, and nothing you record is ever deleted. See the{' '}
                <Link
                    href="/refund-policy"
                    className="underline underline-offset-4 hover:text-foreground"
                >
                    refund and cancellation policy
                </Link>
                .
            </p>
        </Section>
    );
}
