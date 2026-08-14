import Link from 'next/link';
import { Clock, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * What a signed-in customer sees instead of a 404.
 *
 * ── The distinction that was missing ────────────────────────────────────────
 *
 * Every gated surface called `notFound()` when its flag was off. For a
 * stranger that is right: a 404 does not disclose that an unreleased feature
 * exists. For a customer who read about the feature on the pricing page thirty
 * seconds ago — and whose landing-page CTA was literally "Start your work log"
 * pointing at `/log` — the same response says the product is broken.
 *
 * Those are two audiences and they were getting one answer. Strangers still
 * get `notFound()`; signed-in users get this.
 *
 * ── And the second conflation ───────────────────────────────────────────────
 *
 * `/home` and `/radar` also called `notFound()` when the *data load* failed,
 * which made an infrastructure error indistinguishable from a feature that
 * does not exist. `reason="error"` separates them: one is worth retrying and
 * the other is not, and only one of them is our fault in a way the customer
 * should hear about.
 */

/**
 * One place for the names and one-liners, so `/log` and `/log/backfill` do not
 * describe the same feature two different ways.
 */
export const FEATURE_COPY = {
    work_log: {
        feature: 'The Work Log',
        blurb: 'The running record of what you have actually done — the thing every resume, packet and review here is built from. It is built and it is coming.',
    },
    github_capture: {
        feature: 'GitHub capture',
        blurb: 'Turns your commits and pull requests into draft entries in your Work Log, so the record keeps itself. It is built and it is coming.',
    },
    review_packet: {
        feature: 'Review packets',
        blurb: 'Your evidence, arranged for a performance review or a promotion case. It is built and it is coming.',
    },
    month_in_review: {
        feature: 'Month in Review',
        blurb: 'A monthly read on what you shipped and what it added up to. It is built and it is coming.',
    },
    backfill: {
        feature: 'Backfill',
        blurb: 'Reconstructs the years before you started keeping a log, one conversation at a time. It is built and it is coming.',
    },
    career_radar: {
        feature: 'Career Radar',
        blurb: 'What the market is asking for in your field, priced and dated, from postings employers actually published. It is built and it is coming.',
    },
    missions: {
        feature: 'Home',
        blurb: 'The one thing you are working toward, paced week by week. It is built and it is coming.',
    },
} as const;

type Props = {
    /** What they were trying to open, in the words the product uses for it. */
    feature: string;
    reason: 'not_enabled' | 'error';
    /** One line on what this feature is, so the visit is not wasted. */
    blurb?: string;
};

export function FeatureUnavailable({ feature, reason, blurb }: Props) {
    const isError = reason === 'error';
    const Icon = isError ? TriangleAlert : Clock;

    return (
        <main className="mx-auto flex min-h-[60vh] w-full max-w-[520px] flex-col justify-center px-4 py-16">
            <div className="rounded-xl border border-border bg-card p-6">
                <Icon
                    className={isError ? 'size-5 text-destructive' : 'size-5 text-muted-foreground'}
                    aria-hidden
                />
                <h1 className="mt-3 font-heading text-xl font-semibold tracking-tight text-foreground">
                    {isError ? `${feature} could not load` : `${feature} is not switched on yet`}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    {isError
                        ? 'Something on our side failed, not something you did. Nothing was lost — try again in a moment.'
                        : (blurb ??
                          'It is built and it is coming. We turn features on in stages so the first people through get a working version rather than an early one.')}
                </p>
                {!isError ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                        Nothing you have recorded is affected, and you will not be charged for it
                        until you can use it.
                    </p>
                ) : null}
                <div className="mt-5 flex flex-wrap gap-2">
                    <Button asChild size="sm">
                        <Link href="/dashboard">Back to your resumes</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                        <Link href="/build">Tailor a resume</Link>
                    </Button>
                </div>
            </div>
        </main>
    );
}
